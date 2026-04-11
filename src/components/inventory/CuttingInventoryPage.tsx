import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbTransaction } from '@/lib/ipc'
import { piecesPerSheet } from '@/lib/calculations'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatNumber, formatSize, bdtToPoisha, paperTypeLabel } from '@/lib/utils'
import { cn } from '@/lib/utils'

// ─── SQL ──────────────────────────────────────────────────────────────────────

const CUTTING_STOCK_SQL = `
SELECT
  cs.paper_type_id,
  cs.accessory_id,
  cs.cut_width_inches,
  cs.cut_height_inches,
  SUM(cs.quantity_pieces) as total_pieces,
  CASE WHEN SUM(cs.quantity_pieces) > 0
    THEN SUM(cs.cost_per_piece_poisha * cs.quantity_pieces) / SUM(cs.quantity_pieces)
    ELSE 0
  END as avg_cost_per_piece_poisha,
  COALESCE(
    b.name || ' ' || g.value || 'gsm ' || MIN(p.width_inches, p.height_inches) || 'x' || MAX(p.width_inches, p.height_inches),
    at.name || ' ' || ab.name || ' ' || ag.value || 'lb',
    'Unknown'
  ) as label,
  COALESCE(pt.category, 'ACCESSORY') as category,
  COALESCE(g.value, ag.value, 0) as gsm_value,
  COALESCE(p.width_inches, 0) as full_width_inches,
  COALESCE(p.height_inches, 0) as full_height_inches
FROM cutting_stock cs
LEFT JOIN paper_types pt ON pt.id = cs.paper_type_id
LEFT JOIN brands b ON b.id = pt.brand_id
LEFT JOIN gsm_options g ON g.id = pt.gsm_id
LEFT JOIN proportions p ON p.id = pt.proportion_id
LEFT JOIN accessories ac ON ac.id = cs.accessory_id
LEFT JOIN accessory_types at ON at.id = ac.accessory_type_id
LEFT JOIN brands ab ON ab.id = ac.brand_id
LEFT JOIN gsm_options ag ON ag.id = ac.gsm_id
GROUP BY cs.paper_type_id, cs.accessory_id, cs.cut_width_inches, cs.cut_height_inches
HAVING total_pieces > 0
ORDER BY category, label, cs.cut_width_inches, cs.cut_height_inches
`

const PAPER_TYPES_SQL = `
  SELECT pt.id, pt.category,
    b.name as brand_name, g.value as gsm_value,
    p.width_inches, p.height_inches
  FROM paper_types pt
  JOIN brands b ON b.id = pt.brand_id
  JOIN gsm_options g ON g.id = pt.gsm_id
  JOIN proportions p ON p.id = pt.proportion_id
  ORDER BY pt.category, b.name, g.value
`

// ─── Types ────────────────────────────────────────────────────────────────────

interface CuttingRow {
  paper_type_id: string | null
  accessory_id: string | null
  cut_width_inches: number | null
  cut_height_inches: number | null
  total_pieces: number
  avg_cost_per_piece_poisha: number
  label: string
  category: string
  gsm_value: number
  full_width_inches: number
  full_height_inches: number
}

interface PaperTypeRow {
  id: string
  category: string
  brand_name: string
  gsm_value: number
  width_inches: number
  height_inches: number
}

interface AddForm {
  paperTypeId: string
  cutWidth: string
  cutHeight: string
  pieces: string
  costPerPiece: string
  ptFilter: string
}

const emptyAddForm: AddForm = { paperTypeId: '', cutWidth: '', cutHeight: '', pieces: '', costPerPiece: '', ptFilter: '' }

// ─── Component ────────────────────────────────────────────────────────────────

export function CuttingInventoryPage() {
  const [filter, setFilter] = useState('')
  const [gsmTab, setGsmTab] = useState<string>('ALL')
  const [deleteTarget, setDeleteTarget] = useState<CuttingRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>(emptyAddForm)
  const [addSaving, setAddSaving] = useState(false)
  const { data: rows, loading, error, refetch } = useQuery<CuttingRow>(CUTTING_STOCK_SQL)
  const { data: paperTypes } = useQuery<PaperTypeRow>(PAPER_TYPES_SQL)
  const { addToast } = useToast()

  const gsmValues = Array.from(new Set(rows.filter(r => r.gsm_value > 0).map(r => r.gsm_value))).sort((a, b) => a - b)

  const filtered = rows
    .filter(row => gsmTab === 'ALL' || (row.gsm_value > 0 && String(row.gsm_value) === gsmTab) || (gsmTab === 'OTHER' && row.gsm_value === 0))
    .filter(row => {
      const searchStr = `${row.label} ${row.cut_width_inches ?? ''}x${row.cut_height_inches ?? ''} ${row.category}`.toLowerCase()
      return searchStr.includes(filter.toLowerCase())
    })

  const totalValue = filtered.reduce((sum, row) => sum + Math.round(row.avg_cost_per_piece_poisha * row.total_pieces), 0)

  // ── Delete handler ──────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const isAcc = !!deleteTarget.accessory_id
      const statements: { sql: string; params: any[] }[] = []

      statements.push({
        sql: `INSERT INTO cutting_stock (id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, transaction_type, reference_id, cost_per_piece_poisha, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'ADJUSTMENT', NULL, ?, datetime('now'))`,
        params: [uuid(), deleteTarget.paper_type_id, deleteTarget.accessory_id,
          deleteTarget.cut_width_inches, deleteTarget.cut_height_inches,
          -deleteTarget.total_pieces, deleteTarget.avg_cost_per_piece_poisha],
      })

      let sheetsToReturn: number
      if (isAcc) {
        sheetsToReturn = deleteTarget.total_pieces
      } else {
        const pps = piecesPerSheet(
          deleteTarget.cut_width_inches!, deleteTarget.cut_height_inches!,
          deleteTarget.full_width_inches, deleteTarget.full_height_inches
        )
        sheetsToReturn = pps > 0 ? Math.ceil(deleteTarget.total_pieces / pps) : deleteTarget.total_pieces
      }

      statements.push({
        sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at)
              VALUES (?, ?, ?, 'ADJUSTMENT', ?, NULL, datetime('now'))`,
        params: [uuid(), deleteTarget.paper_type_id, deleteTarget.accessory_id, sheetsToReturn],
      })

      await dbTransaction(statements)
      addToast({ title: 'Stock returned to godown', description: `${deleteTarget.label}: ${deleteTarget.total_pieces} pieces removed, ${sheetsToReturn} sheets returned to godown.` })
      setDeleteTarget(null)
      refetch()
    } catch (err: any) {
      addToast({ title: 'Delete failed', description: err.message, variant: 'destructive' })
    } finally { setDeleting(false) }
  }

  // ── Add custom stock handler ────────────────────────────────────────────────

  async function handleAddCustom() {
    const cw = parseFloat(addForm.cutWidth)
    const ch = parseFloat(addForm.cutHeight)
    const pcs = parseInt(addForm.pieces)

    if (!addForm.paperTypeId) { addToast({ title: 'Select a product', variant: 'destructive' }); return }
    if (isNaN(cw) || cw <= 0 || isNaN(ch) || ch <= 0) { addToast({ title: 'Enter valid cut size', variant: 'destructive' }); return }
    if (isNaN(pcs) || pcs <= 0) { addToast({ title: 'Enter valid pieces count', variant: 'destructive' }); return }

    const costBdt = parseFloat(addForm.costPerPiece)
    const costPoisha = !isNaN(costBdt) && costBdt > 0 ? bdtToPoisha(costBdt) : 0
    const cutW = Math.min(cw, ch)
    const cutH = Math.max(cw, ch)

    setAddSaving(true)
    try {
      await dbTransaction([{
        sql: `INSERT INTO cutting_stock (id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, transaction_type, reference_id, cost_per_piece_poisha, created_at)
              VALUES (?, ?, NULL, ?, ?, ?, 'ADJUSTMENT', NULL, ?, datetime('now'))`,
        params: [uuid(), addForm.paperTypeId, cutW, cutH, pcs, costPoisha],
      }])

      const pt = paperTypes.find(p => p.id === addForm.paperTypeId)
      addToast({ title: 'Custom stock added', description: `${pcs} pieces of ${pt ? paperTypeLabel(pt.brand_name, pt.gsm_value, pt.width_inches, pt.height_inches) : 'item'} ${cutW}x${cutH} added.` })
      setAddOpen(false)
      setAddForm(emptyAddForm)
      refetch()
    } catch (err: any) {
      addToast({ title: 'Failed', description: err.message, variant: 'destructive' })
    } finally { setAddSaving(false) }
  }

  function categoryBadgeClass(cat: string): string {
    if (cat === 'CARD') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    if (cat === 'STICKER') return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
    if (cat === 'ACCESSORY') return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
    return ''
  }

  // Filter paper types for the add dialog
  const filteredPaperTypes = addForm.ptFilter
    ? paperTypes.filter(pt => `${pt.category} ${pt.brand_name} ${pt.gsm_value} ${formatSize(pt.width_inches, pt.height_inches)}`.toLowerCase().includes(addForm.ptFilter.toLowerCase()))
    : paperTypes

  const selectedPt = paperTypes.find(p => p.id === addForm.paperTypeId)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Cutting Stock</h1>
        {!loading && !error && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {filtered.length} item{filtered.length !== 1 ? 's' : ''}
            </span>
            <span className="text-sm font-medium">
              Total Value: {formatBDT(totalValue)}
            </span>
            <Button size="sm" onClick={() => setAddOpen(true)}>+ Add Custom</Button>
          </div>
        )}
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading cutting stock...</div>}
      {error && <div className="text-sm text-destructive">Error: {error}</div>}

      {!loading && !error && (
        <>
          <div className="flex items-center gap-4 flex-wrap">
            {gsmValues.length > 0 && (
              <Tabs value={gsmTab} onValueChange={setGsmTab}>
                <TabsList>
                  <TabsTrigger value="ALL">All</TabsTrigger>
                  {gsmValues.map(g => (
                    <TabsTrigger key={g} value={String(g)}>{g} gsm</TabsTrigger>
                  ))}
                  {rows.some(r => r.gsm_value === 0) && <TabsTrigger value="OTHER">Accessories</TabsTrigger>}
                </TabsList>
              </Tabs>
            )}
            <Input placeholder="Search cutting stock..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Cut Size</TableHead>
                  <TableHead className="text-right">Stock (pieces)</TableHead>
                  <TableHead className="text-right">Avg Cost / Piece</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No cutting stock. Transfer items from godown first.
                    </TableCell>
                  </TableRow>
                ) : filtered.map((row, i) => {
                  const isLow = row.total_pieces < 100
                  const isAcc = row.category === 'ACCESSORY'
                  const cat = row.category
                  const value = Math.round(row.avg_cost_per_piece_poisha * row.total_pieces)

                  return (
                    <TableRow key={i} className={cn(isLow && 'bg-destructive/10 hover:bg-destructive/15')}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell>
                        <Badge variant={cat === 'PAPER' ? 'secondary' : 'outline'}
                          className={`text-[10px] px-1.5 py-0 ${categoryBadgeClass(cat)}`}>{cat}</Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {isAcc ? '—' : (row.cut_width_inches && row.cut_height_inches
                          ? formatSize(row.cut_width_inches, row.cut_height_inches)
                          : '—')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatNumber(row.total_pieces)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.avg_cost_per_piece_poisha > 0 ? formatBDT(Math.round(row.avg_cost_per_piece_poisha)) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {value > 0 ? formatBDT(value) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {isLow ? <Badge variant="destructive">Low</Badge> : <Badge variant="secondary">OK</Badge>}
                      </TableCell>
                      <TableCell>
                        <button onClick={() => setDeleteTarget(row)} className="text-xs text-destructive hover:underline whitespace-nowrap">Delete</button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Cutting Stock</DialogTitle></DialogHeader>
          {deleteTarget && (
            <div className="flex flex-col gap-3 pt-2">
              <p className="text-sm text-muted-foreground">
                This will remove <span className="font-semibold text-foreground">{formatNumber(deleteTarget.total_pieces)} pieces</span> of{' '}
                <span className="font-semibold text-foreground">{deleteTarget.label}</span>
                {deleteTarget.cut_width_inches && deleteTarget.cut_height_inches
                  ? ` (${formatSize(deleteTarget.cut_width_inches, deleteTarget.cut_height_inches)})`
                  : ''}{' '}
                from cutting stock and return the equivalent sheets back to godown storage.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <DialogClose asChild><Button variant="outline" disabled={deleting}>Cancel</Button></DialogClose>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Custom Stock dialog */}
      <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) setAddForm(emptyAddForm) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Custom Cut Stock</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">Add pieces from waste or custom cuts. This does not affect godown.</p>

          <div className="grid gap-4 py-2">
            {/* Product selector */}
            <div className="grid gap-1.5">
              <Label>Product *</Label>
              <Select value={addForm.paperTypeId} onValueChange={v => setAddForm(f => ({ ...f, paperTypeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select paper type..." /></SelectTrigger>
                <SelectContent className="max-h-72" header={
                  <Input placeholder="Search..." value={addForm.ptFilter}
                    onChange={e => setAddForm(f => ({ ...f, ptFilter: e.target.value }))}
                    onKeyDown={e => e.stopPropagation()} className="h-8 text-sm" />
                }>
                  {filteredPaperTypes.length === 0 ? (
                    <div className="py-3 text-center text-sm text-muted-foreground">No products found</div>
                  ) : filteredPaperTypes.map(pt => (
                    <SelectItem key={pt.id} value={pt.id}>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-semibold px-1 rounded ${categoryBadgeClass(pt.category)} ${pt.category === 'PAPER' ? 'bg-secondary text-secondary-foreground' : ''}`}>
                          {pt.category.charAt(0)}
                        </span>
                        <span>{paperTypeLabel(pt.brand_name, pt.gsm_value, pt.width_inches, pt.height_inches)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPt && (
                <p className="text-xs text-primary font-medium">
                  {paperTypeLabel(selectedPt.brand_name, selectedPt.gsm_value, selectedPt.width_inches, selectedPt.height_inches)}
                  <span className="text-muted-foreground ml-1">({selectedPt.category})</span>
                </p>
              )}
            </div>

            {/* Cut size */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Cut Width (inches) *</Label>
                <Input type="number" min="0.1" step="0.5" placeholder="e.g. 7.5"
                  value={addForm.cutWidth} onChange={e => setAddForm(f => ({ ...f, cutWidth: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Cut Height (inches) *</Label>
                <Input type="number" min="0.1" step="0.5" placeholder="e.g. 10"
                  value={addForm.cutHeight} onChange={e => setAddForm(f => ({ ...f, cutHeight: e.target.value }))} />
              </div>
            </div>

            {/* Pieces + cost */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Pieces *</Label>
                <Input type="number" min="1" step="1" placeholder="e.g. 200"
                  value={addForm.pieces} onChange={e => setAddForm(f => ({ ...f, pieces: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Cost / Piece (BDT) <span className="text-muted-foreground font-normal">optional</span></Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00"
                  value={addForm.costPerPiece} onChange={e => setAddForm(f => ({ ...f, costPerPiece: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setAddOpen(false); setAddForm(emptyAddForm) }} disabled={addSaving}>Cancel</Button>
            <Button onClick={handleAddCustom} disabled={addSaving}>
              {addSaving ? 'Adding...' : 'Add Stock'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
