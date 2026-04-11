import { useState, useCallback } from 'react'
import { dbTransaction } from '@/lib/ipc'
import { findOrCreatePaperType, findOrCreateAccessory, sheetsPerUnit, unitLabel, unitLabelPlural } from '@/lib/paper-type'
import type { Category } from '@/lib/paper-type'
import { useQuery } from '@/hooks/useQuery'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, bdtToPoisha, poishaToBdt, todayISO, formatSize } from '@/lib/utils'

// ─── SQL ──────────────────────────────────────────────────────────────────────

const SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(total_cost_poisha), 0) as total_all,
    COALESCE(SUM(CASE WHEN purchase_date = ? THEN total_cost_poisha ELSE 0 END), 0) as total_today,
    COALESCE(SUM(CASE WHEN purchase_date >= ? THEN total_cost_poisha ELSE 0 END), 0) as total_week,
    COALESCE(SUM(CASE WHEN purchase_date >= ? THEN total_cost_poisha ELSE 0 END), 0) as total_month,
    COALESCE(SUM(CASE WHEN category = 'PAPER' THEN total_cost_poisha ELSE 0 END), 0) as total_paper,
    COALESCE(SUM(CASE WHEN category = 'CARD' THEN total_cost_poisha ELSE 0 END), 0) as total_card,
    COALESCE(SUM(CASE WHEN category = 'STICKER' THEN total_cost_poisha ELSE 0 END), 0) as total_sticker,
    COALESCE(SUM(CASE WHEN category = 'ACCESSORY' THEN total_cost_poisha ELSE 0 END), 0) as total_accessory
  FROM purchases
`

const PURCHASES_SQL = `
  SELECT pu.id, pu.purchase_date, pu.category,
    COALESCE(b.name, ab.name, '') as brand_name,
    COALESCE(g.value, ag.value, 0) as gsm_value,
    COALESCE(p.width_inches, 0) as width_inches,
    COALESCE(p.height_inches, 0) as height_inches,
    COALESCE(at.name, '') as accessory_name,
    pu.quantity_reams, pu.cost_per_ream_poisha,
    pu.supplier_name, pu.notes,
    pu.paper_type_id, pu.accessory_id,
    pt.brand_id, pt.gsm_id, pt.proportion_id,
    ac.brand_id as acc_brand_id, ac.gsm_id as acc_gsm_id, ac.accessory_type_id as acc_type_id,
    pu.supplier_id,
    COALESCE(s.name, pu.supplier_name) as display_supplier_name
  FROM purchases pu
  LEFT JOIN paper_types pt ON pu.paper_type_id = pt.id
  LEFT JOIN brands b ON pt.brand_id = b.id
  LEFT JOIN gsm_options g ON pt.gsm_id = g.id
  LEFT JOIN proportions p ON pt.proportion_id = p.id
  LEFT JOIN accessories ac ON pu.accessory_id = ac.id
  LEFT JOIN accessory_types at ON ac.accessory_type_id = at.id
  LEFT JOIN brands ab ON ac.brand_id = ab.id
  LEFT JOIN gsm_options ag ON ac.gsm_id = ag.id
  LEFT JOIN suppliers s ON pu.supplier_id = s.id
  ORDER BY pu.purchase_date DESC, pu.created_at DESC
`

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SummaryRow { total_all: number; total_today: number; total_week: number; total_month: number; total_paper: number; total_card: number; total_sticker: number; total_accessory: number }
interface Brand { id: string; name: string }
interface Gsm { id: string; value: number }
interface Proportion { id: string; width_inches: number; height_inches: number }
interface AccessoryType { id: string; name: string }
interface SupplierOption { id: string; name: string }

interface Purchase {
  id: string; purchase_date: string; category: Category
  brand_name: string; gsm_value: number; width_inches: number; height_inches: number
  accessory_name: string; quantity_reams: number; cost_per_ream_poisha: number
  supplier_name: string | null; notes: string | null
  paper_type_id: string | null; accessory_id: string | null
  brand_id: string | null; gsm_id: string | null; proportion_id: string | null
  acc_brand_id: string | null; acc_gsm_id: string | null; acc_type_id: string | null
  supplier_id: string | null; display_supplier_name: string | null
}

function getWeekStart(): string {
  const d = new Date(); const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const mon = new Date(d.setDate(diff))
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
}
function getMonthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── Form types ───────────────────────────────────────────────────────────────

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'PAPER', label: 'Paper' },
  { value: 'CARD', label: 'Card' },
  { value: 'STICKER', label: 'Sticker' },
  { value: 'ACCESSORY', label: 'Accessories' },
]

interface PurchaseLine {
  id: string
  category: Category
  brandId: string; gsmId: string; proportionId: string; accessoryId: string
  quantity: string; costPerUnit: string
}

function emptyLine(): PurchaseLine {
  return { id: uuid(), category: 'PAPER', brandId: '', gsmId: '', proportionId: '', accessoryId: '', quantity: '', costPerUnit: '' }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PurchasesPage() {
  const { addToast } = useToast()
  const [open, setOpen] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [viewCategory, setViewCategory] = useState<'ALL' | Category>('ALL')
  const [summaryView, setSummaryView] = useState<'today' | 'week' | 'month' | 'all' | 'paper' | 'card' | 'sticker' | 'accessory'>('today')

  // Multi-line form state
  const [purchaseDate, setPurchaseDate] = useState(todayISO())
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PurchaseLine[]>([emptyLine()])

  // The "active" category for catalog lookups (from first line or editing line)
  const activeCat = lines[0]?.category ?? 'PAPER'

  const { data: brands } = useQuery<Brand>(`SELECT id, name FROM brands WHERE category = ? ORDER BY name`, [activeCat], [activeCat])
  const { data: gsmOptions } = useQuery<Gsm>(`SELECT id, value FROM gsm_options WHERE category = ? ORDER BY value`, [activeCat], [activeCat])
  const { data: proportions } = useQuery<Proportion>(`SELECT id, width_inches, height_inches FROM proportions WHERE category = ? ORDER BY width_inches`, [activeCat], [activeCat])
  const { data: accessoryTypes } = useQuery<AccessoryType>('SELECT id, name FROM accessory_types ORDER BY name')
  const { data: supplierOptions } = useQuery<SupplierOption>('SELECT id, name FROM suppliers ORDER BY name')
  const { data: purchases, loading, error, refetch } = useQuery<Purchase>(PURCHASES_SQL)

  const today = todayISO()
  const { data: summaryRows, loading: summaryLoading, refetch: refetchSummary } = useQuery<SummaryRow>(SUMMARY_SQL, [today, getWeekStart(), getMonthStart()], [today])
  const summary = summaryRows[0] ?? { total_all: 0, total_today: 0, total_week: 0, total_month: 0, total_paper: 0, total_card: 0, total_sticker: 0, total_accessory: 0 }

  function resetForm() {
    setPurchaseDate(todayISO()); setSupplierId(''); setNotes('')
    setLines([emptyLine()]); setEditingPurchase(null)
  }

  function openNew() { resetForm(); setOpen(true) }

  function openEdit(p: Purchase) {
    setEditingPurchase(p)
    setPurchaseDate(p.purchase_date)
    setSupplierId(p.supplier_id ?? '')
    setNotes(p.notes ?? '')
    setLines([{
      id: uuid(), category: p.category,
      brandId: p.category === 'ACCESSORY' ? (p.acc_brand_id ?? '') : (p.brand_id ?? ''),
      gsmId: p.category === 'ACCESSORY' ? (p.acc_gsm_id ?? '') : (p.gsm_id ?? ''),
      proportionId: p.proportion_id ?? '',
      accessoryId: p.category === 'ACCESSORY' ? (p.acc_type_id ?? '') : '',
      quantity: String(p.quantity_reams), costPerUnit: String(poishaToBdt(p.cost_per_ream_poisha)),
    }])
    setOpen(true)
  }

  const updateLine = useCallback((id: string, patch: Partial<PurchaseLine>) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const next = { ...l, ...patch }
      if ('category' in patch) { next.brandId = ''; next.gsmId = ''; next.proportionId = ''; next.accessoryId = '' }
      return next
    }))
  }, [])

  const addLine = () => setLines(prev => [...prev, emptyLine()])
  const removeLine = (id: string) => setLines(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev)

  async function handleSave() {
    if (!purchaseDate) { addToast({ title: 'Select a date', variant: 'destructive' }); return }

    // Validate lines
    for (const line of lines) {
      const cat = line.category
      if (cat === 'ACCESSORY') {
        if (!line.accessoryId || !line.brandId || !line.gsmId) { addToast({ title: 'Select name, brand, and pound for accessories', variant: 'destructive' }); return }
      } else {
        if (!line.brandId || !line.gsmId || !line.proportionId) { addToast({ title: 'Select brand, GSM, and size for all lines', variant: 'destructive' }); return }
      }
      const qty = parseFloat(line.quantity)
      if (!line.quantity || isNaN(qty) || qty <= 0) { addToast({ title: 'Enter valid quantity', variant: 'destructive' }); return }
      const cost = parseFloat(line.costPerUnit)
      if (!line.costPerUnit || isNaN(cost) || cost <= 0) { addToast({ title: 'Enter valid cost', variant: 'destructive' }); return }
    }

    setSaving(true)
    try {
      if (editingPurchase && lines.length === 1) {
        // EDIT single purchase
        const line = lines[0]
        const cat = line.category
        const spu = sheetsPerUnit(cat)
        let paperTypeId: string | null = null
        let accessoryId: string | null = null

        if (cat !== 'ACCESSORY') {
          paperTypeId = await findOrCreatePaperType(line.brandId, line.gsmId, line.proportionId, cat)
        } else {
          accessoryId = await findOrCreateAccessory(line.accessoryId, line.brandId, line.gsmId)
        }

        const qty = parseFloat(line.quantity)
        const costPoisha = bdtToPoisha(parseFloat(line.costPerUnit))
        const quantitySheets = Math.round(qty * spu)

        await dbTransaction([
          { sql: `UPDATE purchases SET paper_type_id = ?, accessory_id = ?, category = ?, purchase_date = ?, quantity_reams = ?, cost_per_ream_poisha = ?, total_cost_poisha = ?, supplier_id = ?, supplier_name = ?, notes = ? WHERE id = ?`,
            params: [paperTypeId, accessoryId, cat, purchaseDate, qty, costPoisha, Math.round(qty * costPoisha), supplierId || null, null, notes.trim() || null, editingPurchase.id] },
          { sql: `UPDATE stock_ledger SET paper_type_id = ?, accessory_id = ?, quantity_sheets = ? WHERE reference_id = ? AND transaction_type = 'PURCHASE'`,
            params: [paperTypeId, accessoryId, quantitySheets, editingPurchase.id] },
        ])
        addToast({ title: 'Purchase updated' })
      } else {
        // CREATE new purchases (multi-line)
        const statements: { sql: string; params: any[] }[] = []
        const now = new Date().toISOString()

        for (const line of lines) {
          const cat = line.category
          const spu = sheetsPerUnit(cat)
          let paperTypeId: string | null = null
          let accessoryId: string | null = null

          if (cat !== 'ACCESSORY') {
            paperTypeId = await findOrCreatePaperType(line.brandId, line.gsmId, line.proportionId, cat)
          } else {
            accessoryId = await findOrCreateAccessory(line.accessoryId, line.brandId, line.gsmId)
          }

          const qty = parseFloat(line.quantity)
          const costPoisha = bdtToPoisha(parseFloat(line.costPerUnit))
          const quantitySheets = Math.round(qty * spu)
          const purchaseId = uuid()

          statements.push({
            sql: `INSERT INTO purchases (id, paper_type_id, accessory_id, category, purchase_date, quantity_reams, cost_per_ream_poisha, total_cost_poisha, supplier_id, supplier_name, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [purchaseId, paperTypeId, accessoryId, cat, purchaseDate, qty, costPoisha, Math.round(qty * costPoisha), supplierId || null, null, notes.trim() || null, now],
          })
          statements.push({
            sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at) VALUES (?, ?, ?, 'PURCHASE', ?, ?, ?)`,
            params: [uuid(), paperTypeId, accessoryId, quantitySheets, purchaseId, now],
          })
        }
        await dbTransaction(statements)
        addToast({ title: 'Purchases recorded', description: `${lines.length} item${lines.length > 1 ? 's' : ''} added to stock.` })
      }
      setOpen(false); resetForm(); refetch(); refetchSummary()
    } catch (err: any) {
      addToast({ title: 'Failed to save', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const filteredPurchases = purchases
    .filter(p => viewCategory === 'ALL' || p.category === viewCategory)
    .filter(p => `${p.brand_name} ${p.gsm_value} ${formatSize(p.width_inches, p.height_inches)} ${p.accessory_name} ${p.display_supplier_name ?? ''}`.toLowerCase().includes(filter.toLowerCase()))

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchases</h1>
          <p className="text-sm text-muted-foreground mt-1">Record purchases and track stock additions.</p>
        </div>
        {!summaryLoading && (
          <div className="flex items-center gap-2">
            <Select value={summaryView} onValueChange={v => setSummaryView(v as any)}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="paper">Paper (all)</SelectItem>
                <SelectItem value="card">Card (all)</SelectItem>
                <SelectItem value="sticker">Sticker (all)</SelectItem>
                <SelectItem value="accessory">Accessory (all)</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-lg font-bold tabular-nums whitespace-nowrap">
              {formatBDT(summaryView === 'today' ? summary.total_today : summaryView === 'week' ? summary.total_week : summaryView === 'month' ? summary.total_month : summaryView === 'all' ? summary.total_all : summaryView === 'paper' ? summary.total_paper : summaryView === 'card' ? summary.total_card : summaryView === 'sticker' ? summary.total_sticker : summary.total_accessory)}
            </span>
          </div>
        )}
      </div>

      {/* ── Purchase Dialog ──────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingPurchase ? 'Edit Purchase' : 'Record Purchases'}</DialogTitle></DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Header: date + supplier */}
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>Purchase Date *</Label>
                <Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Supplier</Label>
                <Select value={supplierId} onValueChange={v => setSupplierId(v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Optional..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {supplierOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Notes</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            {/* Lines */}
            {!editingPurchase && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Items</span>
                <Button variant="outline" size="sm" onClick={addLine}>Add Row</Button>
              </div>
            )}

            {lines.map((line, idx) => {
              const cat = line.category
              const spu = sheetsPerUnit(cat)
              const uLbl = unitLabel(cat)
              const uLblP = unitLabelPlural(cat)
              const qty = parseFloat(line.quantity) || 0
              const cost = parseFloat(line.costPerUnit) || 0

              return (
                <Card key={line.id}>
                  <CardContent className="pt-3 pb-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-muted-foreground">#{idx + 1}</span>
                      {!editingPurchase && lines.length > 1 && (
                        <button className="text-muted-foreground hover:text-destructive text-lg leading-none" onClick={() => removeLine(line.id)}>×</button>
                      )}
                    </div>

                    {/* Category */}
                    <div className="flex gap-1.5 mb-2">
                      {CATEGORIES.map(c => (
                        <Button key={c.value} size="sm" variant={cat === c.value ? 'default' : 'outline'}
                          onClick={() => updateLine(line.id, { category: c.value })} className="text-xs h-7 px-2">{c.label}</Button>
                      ))}
                    </div>

                    {/* Item selection */}
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {cat === 'ACCESSORY' ? (
                        <>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Name</Label>
                            <Select value={line.accessoryId} onValueChange={v => updateLine(line.id, { accessoryId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Name" /></SelectTrigger>
                              <SelectContent>{accessoryTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Brand</Label>
                            <Select value={line.brandId} onValueChange={v => updateLine(line.id, { brandId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Brand" /></SelectTrigger>
                              <SelectContent>{brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Pound</Label>
                            <Select value={line.gsmId} onValueChange={v => updateLine(line.id, { gsmId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Pound" /></SelectTrigger>
                              <SelectContent>{gsmOptions.map(g => <SelectItem key={g.id} value={g.id}>{g.value}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Brand</Label>
                            <Select value={line.brandId} onValueChange={v => updateLine(line.id, { brandId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Brand" /></SelectTrigger>
                              <SelectContent>{brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">GSM</Label>
                            <Select value={line.gsmId} onValueChange={v => updateLine(line.id, { gsmId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="GSM" /></SelectTrigger>
                              <SelectContent>{gsmOptions.map(g => <SelectItem key={g.id} value={g.id}>{g.value}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Size</Label>
                            <Select value={line.proportionId} onValueChange={v => updateLine(line.id, { proportionId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Size" /></SelectTrigger>
                              <SelectContent>{proportions.map(p => <SelectItem key={p.id} value={p.id}>{formatSize(p.width_inches, p.height_inches)}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Qty + Cost */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1">
                        <Label className="text-xs">Qty ({uLblP})</Label>
                        <Input className="h-8" type="number" min="0.01" step="0.01" value={line.quantity} onChange={e => updateLine(line.id, { quantity: e.target.value })} />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Cost/{uLbl} (BDT)</Label>
                        <Input className="h-8" type="number" min="0.01" step="0.01" value={line.costPerUnit} onChange={e => updateLine(line.id, { costPerUnit: e.target.value })} />
                      </div>
                    </div>

                    {qty > 0 && cost > 0 && (
                      <div className="text-xs text-muted-foreground mt-2 border-t pt-2 space-y-1">
                        <div className="flex justify-between">
                          <span>Purchasing:</span>
                          <span className="font-semibold text-foreground">
                            {cat === 'ACCESSORY' ? (
                              <>
                                {accessoryTypes.find(t => t.id === line.accessoryId)?.name || '...'} {' '}
                                {brands.find(b => b.id === line.brandId)?.name || '...'} {' '}
                                {gsmOptions.find(g => g.id === line.gsmId)?.value || '...'}lb
                              </>
                            ) : (
                              <>
                                {brands.find(b => b.id === line.brandId)?.name || '...'} {' '}
                                {gsmOptions.find(g => g.id === line.gsmId)?.value || '...'}gsm {' '}
                                {proportions.find(p => p.id === line.proportionId) ? formatSize(proportions.find(p => p.id === line.proportionId)!.width_inches, proportions.find(p => p.id === line.proportionId)!.height_inches) : '...'}
                              </>
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total: <span className="font-medium text-foreground">{formatBDT(bdtToPoisha(cost * qty))}</span></span>
                          <span>{Math.round(qty * spu).toLocaleString()} sheets</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setOpen(false); resetForm() }} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingPurchase ? 'Update Purchase' : `Save ${lines.length > 1 ? `${lines.length} Purchases` : 'Purchase'}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Filter + search + button */}
      <div className="flex items-center gap-4">
        <Tabs value={viewCategory} onValueChange={v => setViewCategory(v as any)}>
          <TabsList>
            <TabsTrigger value="ALL">All</TabsTrigger>
            <TabsTrigger value="PAPER">Paper</TabsTrigger>
            <TabsTrigger value="CARD">Card</TabsTrigger>
            <TabsTrigger value="STICKER">Sticker</TabsTrigger>
            <TabsTrigger value="ACCESSORY">Accessories</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input placeholder="Search purchases..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" />
        <div className="flex-1" />
        <Button onClick={openNew}>+ New Purchase</Button>
      </div>

      {/* Table */}
      {loading ? <p className="text-sm text-muted-foreground">Loading...</p>
       : error ? <p className="text-sm text-destructive">Error: {error}</p>
       : filteredPurchases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium text-muted-foreground">No purchases found.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Cost / Unit</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPurchases.map(p => {
                const pCat = (p.category || 'PAPER') as Category
                const productLabel = pCat === 'ACCESSORY' 
                  ? `${p.accessory_name} ${p.brand_name} ${p.gsm_value}lb`
                  : `${p.brand_name} ${p.gsm_value}gsm ${formatSize(p.width_inches, p.height_inches)}`
                
                return (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(p.purchase_date)}</TableCell>
                    <TableCell>{productLabel}</TableCell>
                    <TableCell>
                      <Badge variant={pCat === 'PAPER' ? 'secondary' : 'outline'} className={`text-[10px] px-1.5 py-0 ${pCat === 'CARD' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : pCat === 'STICKER' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : pCat === 'ACCESSORY' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' : ''}`}>{pCat}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.quantity_reams} {unitLabelPlural(pCat)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBDT(p.cost_per_ream_poisha)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatBDT(p.cost_per_ream_poisha * p.quantity_reams)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.display_supplier_name ?? '—'}</TableCell>
                    <TableCell><button onClick={() => openEdit(p)} className="text-xs text-primary hover:underline">Edit</button></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
