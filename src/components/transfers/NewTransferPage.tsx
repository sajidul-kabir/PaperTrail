import { useState, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbQuery, dbTransaction } from '@/lib/ipc'
import { piecesPerSheet, wasteAreaPerSheet } from '@/lib/calculations'
import { sheetsPerUnit, unitLabelPlural } from '@/lib/paper-type'
import type { Category } from '@/lib/paper-type'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatNumber, formatSize, paperTypeLabel, todayISO } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GodownItem {
  paper_type_id: string
  category: Category
  brand_name: string
  gsm_value: number
  width_inches: number
  height_inches: number
  total_sheets: number
}

interface AccessoryItem {
  accessory_id: string
  accessory_name: string
  total_pieces: number
}

interface CostRow { paper_type_id: string; avg_cost_per_sheet_poisha: number }
interface AccessoryCostRow { accessory_id: string; avg_cost_poisha: number }

interface TransferLine {
  id: string
  paper_type_id: string
  accessory_id: string
  quantity_units: string
  cut_size: string
  itemFilter: string
  categoryFilter: string
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const GODOWN_SQL = `
  SELECT pt.id as paper_type_id, pt.category,
    b.name as brand_name, g.value as gsm_value,
    p.width_inches, p.height_inches,
    COALESCE(SUM(sl.quantity_sheets), 0) as total_sheets
  FROM paper_types pt
  JOIN brands b ON pt.brand_id = b.id
  JOIN gsm_options g ON pt.gsm_id = g.id
  JOIN proportions p ON pt.proportion_id = p.id
  LEFT JOIN stock_ledger sl ON sl.paper_type_id = pt.id
  GROUP BY pt.id
  HAVING total_sheets > 0
  ORDER BY pt.category, b.name, g.value
`

const ACCESSORY_GODOWN_SQL = `
  SELECT a.id as accessory_id,
    at.name || ' ' || b.name || ' ' || g.value || 'lb' as accessory_name,
    COALESCE(SUM(sl.quantity_sheets), 0) as total_pieces
  FROM accessories a
  JOIN accessory_types at ON a.accessory_type_id = at.id
  JOIN brands b ON a.brand_id = b.id
  JOIN gsm_options g ON a.gsm_id = g.id
  LEFT JOIN stock_ledger sl ON sl.accessory_id = a.id
  GROUP BY a.id
  HAVING total_pieces > 0
  ORDER BY at.name, b.name
`

const COSTS_SQL = `
  SELECT pu.paper_type_id,
    CASE WHEN SUM(pu.quantity_reams) > 0
      THEN SUM(pu.cost_per_ream_poisha * pu.quantity_reams) / SUM(pu.quantity_reams)
           / CASE WHEN pt.category IN ('CARD','STICKER') THEN 100 ELSE 500 END
      ELSE 0
    END AS avg_cost_per_sheet_poisha
  FROM purchases pu
  JOIN paper_types pt ON pt.id = pu.paper_type_id
  WHERE pu.paper_type_id IS NOT NULL
  GROUP BY pu.paper_type_id
`

const ACCESSORY_COSTS_SQL = `
  SELECT accessory_id,
    CASE WHEN SUM(quantity_reams) > 0
      THEN SUM(cost_per_ream_poisha * quantity_reams) / SUM(quantity_reams)
      ELSE 0
    END as avg_cost_poisha
  FROM purchases WHERE accessory_id IS NOT NULL
  GROUP BY accessory_id
`

// ─── Constants ───────────────────────────────────────────────────────────────

const CUT_SIZE_PRESETS: Record<string, string[]> = {
  PAPER: ['11.5x18', '10x15', '9x14', '9x11.5', '7.5x10', '9x7.5'],
  CARD: ['9.25x11', '11x14', '7x11', '7.25x10.25', '11x17'],
  STICKER: [],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyLine(): TransferLine {
  return {
    id: uuid(),
    paper_type_id: '', accessory_id: '',
    quantity_units: '', cut_size: '',
    itemFilter: '', categoryFilter: '',
  }
}

function parseNum(s: string): number {
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function parseCutSize(s: string): [number, number] | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const a = parseFloat(m[1]), b = parseFloat(m[2])
  if (isNaN(a) || isNaN(b) || a <= 0 || b <= 0) return null
  return [Math.min(a, b), Math.max(a, b)]
}

function itemLabel(item: GodownItem): string {
  return paperTypeLabel(item.brand_name, item.gsm_value, item.width_inches, item.height_inches)
}

function categoryBadgeClass(cat: Category): string {
  if (cat === 'CARD') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  if (cat === 'STICKER') return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
  if (cat === 'ACCESSORY') return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
  return ''
}

async function generateTransferNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const rows = await dbQuery<{ transfer_number: string }>(
    `SELECT transfer_number FROM transfers WHERE transfer_number LIKE ? ORDER BY transfer_number DESC LIMIT 1`,
    [`T${year}-%`]
  )
  let next = 1
  if (rows.length > 0) {
    const parts = rows[0].transfer_number.split('-')
    if (parts.length === 2) {
      const n = parseInt(parts[1], 10)
      if (!isNaN(n)) next = n + 1
    }
  }
  return `T${year}-${String(next).padStart(4, '0')}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NewTransferPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { addToast } = useToast()

  const editTransferId = (location.state as any)?.editTransferId as string | undefined

  const [transferDate, setTransferDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<TransferLine[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [editLoaded, setEditLoaded] = useState(false)

  const { data: godownItems } = useQuery<GodownItem>(GODOWN_SQL, [], [])
  const { data: accessoryItems } = useQuery<AccessoryItem>(ACCESSORY_GODOWN_SQL, [], [])
  const { data: costRows } = useQuery<CostRow>(COSTS_SQL, [], [])
  const { data: accCostRows } = useQuery<AccessoryCostRow>(ACCESSORY_COSTS_SQL, [], [])

  // Load existing transfer for editing
  useEffect(() => {
    if (!editTransferId || editLoaded) return
    async function loadTransfer() {
      try {
        const headers = await dbQuery<{ transfer_date: string; notes: string | null }>(
          `SELECT transfer_date, notes FROM transfers WHERE id = ?`, [editTransferId]
        )
        if (headers.length === 0) return
        setTransferDate(headers[0].transfer_date)
        setNotes(headers[0].notes ?? '')

        const tLines = await dbQuery<{
          paper_type_id: string | null; accessory_id: string | null
          quantity_units: number; cut_width_inches: number | null; cut_height_inches: number | null
        }>(
          `SELECT paper_type_id, accessory_id, quantity_units, cut_width_inches, cut_height_inches FROM transfer_lines WHERE transfer_id = ?`,
          [editTransferId]
        )
        if (tLines.length > 0) {
          setLines(tLines.map(tl => ({
            id: uuid(),
            paper_type_id: tl.paper_type_id ?? '',
            accessory_id: tl.accessory_id ?? '',
            quantity_units: String(tl.quantity_units),
            cut_size: (tl.cut_width_inches && tl.cut_height_inches)
              ? `${Math.min(tl.cut_width_inches, tl.cut_height_inches)}x${Math.max(tl.cut_width_inches, tl.cut_height_inches)}`
              : '',
            itemFilter: '',
          })))
        }
        setEditLoaded(true)
      } catch (err: any) {
        addToast({ title: 'Failed to load transfer', description: err.message, variant: 'destructive' })
      }
    }
    loadTransfer()
  }, [editTransferId, editLoaded])

  const godownMap = new Map(godownItems.map(i => [i.paper_type_id, i]))
  const accMap = new Map(accessoryItems.map(a => [a.accessory_id, a]))
  const costMap = new Map(costRows.map(c => [c.paper_type_id, c.avg_cost_per_sheet_poisha]))
  const accCostMap = new Map(accCostRows.map(c => [c.accessory_id, c.avg_cost_poisha]))

  const updateLine = useCallback((id: string, patch: Partial<TransferLine>) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const next = { ...l, ...patch }
      if ('paper_type_id' in patch && patch.paper_type_id) next.accessory_id = ''
      if ('accessory_id' in patch && patch.accessory_id) { next.paper_type_id = ''; next.cut_size = '' }
      return next
    }))
  }, [])

  const addLine = () => setLines(prev => [...prev, emptyLine()])
  const removeLine = (id: string) => setLines(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev)

  // Calculate transfer line result
  function calcTransferLine(line: TransferLine) {
    const isAcc = !!line.accessory_id
    const item = line.paper_type_id ? godownMap.get(line.paper_type_id) : undefined
    const acc = line.accessory_id ? accMap.get(line.accessory_id) : undefined

    if (!item && !acc) return null

    const qtyUnits = parseNum(line.quantity_units)
    if (qtyUnits <= 0) return null

    if (isAcc && acc) {
      // Accessories: 1:1, no cutting
      const pieces = Math.round(qtyUnits)
      const costPerPiece = accCostMap.get(line.accessory_id) ?? 0
      return {
        isAccessory: true,
        quantitySheets: pieces,
        pps: 1,
        totalPieces: pieces,
        wasteArea: 0,
        costPerPiece,
        availableSheets: acc.total_pieces,
        label: acc.accessory_name,
        cutW: 0, cutH: 0,
      }
    }

    if (!item) return null
    const cat = item.category as Category
    const spu = sheetsPerUnit(cat)
    const totalSheets = Math.round(qtyUnits * spu)

    const parsed = parseCutSize(line.cut_size)
    if (!parsed) return null
    const [cutW, cutH] = parsed

    const pps = piecesPerSheet(cutW, cutH, item.width_inches, item.height_inches)
    if (pps <= 0) return null

    const totalPieces = totalSheets * pps
    const waste = wasteAreaPerSheet(cutW, cutH, item.width_inches, item.height_inches)
    const costPerSheet = costMap.get(line.paper_type_id) ?? 0
    const costPerPiece = pps > 0 ? costPerSheet / pps : 0

    return {
      isAccessory: false,
      quantitySheets: totalSheets,
      pps,
      totalPieces,
      wasteArea: waste,
      costPerPiece,
      availableSheets: item.total_sheets,
      label: itemLabel(item),
      cutW, cutH,
    }
  }

  const lineResults = lines.map(l => ({ line: l, result: calcTransferLine(l) }))
  const validLines = lineResults.filter(lr => lr.result !== null)
  const canSave = transferDate !== '' && validLines.length > 0

  async function handleSave() {
    if (!canSave) return
    setSaving(true)

    try {
      const statements: { sql: string; params: any[] }[] = []

      // If editing, reverse the old transfer first
      if (editTransferId) {
        // Reverse cutting_stock TRANSFER_IN entries
        const oldCuttingEntries = await dbQuery<{
          paper_type_id: string | null; accessory_id: string | null
          cut_width_inches: number | null; cut_height_inches: number | null
          quantity_pieces: number; cost_per_piece_poisha: number
        }>(
          `SELECT paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, cost_per_piece_poisha
           FROM cutting_stock WHERE reference_id = ? AND transaction_type = 'TRANSFER_IN'`,
          [editTransferId]
        )
        for (const entry of oldCuttingEntries) {
          statements.push({
            sql: `INSERT INTO cutting_stock (id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, transaction_type, reference_id, cost_per_piece_poisha, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'ADJUSTMENT', ?, ?, datetime('now'))`,
            params: [uuid(), entry.paper_type_id, entry.accessory_id, entry.cut_width_inches, entry.cut_height_inches,
              -entry.quantity_pieces, editTransferId, entry.cost_per_piece_poisha],
          })
        }

        // Reverse stock_ledger TRANSFER_OUT entries (return sheets to godown)
        const oldStockEntries = await dbQuery<{
          paper_type_id: string | null; accessory_id: string | null; quantity_sheets: number
        }>(
          `SELECT paper_type_id, accessory_id, quantity_sheets FROM stock_ledger WHERE reference_id = ? AND transaction_type = 'TRANSFER_OUT'`,
          [editTransferId]
        )
        for (const entry of oldStockEntries) {
          statements.push({
            sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at)
                  VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, datetime('now'))`,
            params: [uuid(), entry.paper_type_id, entry.accessory_id, -entry.quantity_sheets, editTransferId],
          })
        }

        // Delete old transfer lines and header
        statements.push({ sql: `DELETE FROM transfer_lines WHERE transfer_id = ?`, params: [editTransferId] })
        statements.push({ sql: `DELETE FROM transfers WHERE id = ?`, params: [editTransferId] })
      }

      // Create new transfer
      const transferId = uuid()
      const transferNumber = await generateTransferNumber()

      statements.push({
        sql: `INSERT INTO transfers (id, transfer_number, transfer_date, notes, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
        params: [transferId, transferNumber, transferDate, notes || null],
      })

      for (const { line, result } of validLines) {
        if (!result) continue
        const isAcc = !!line.accessory_id
        const lineId = uuid()

        // Insert transfer_line
        statements.push({
          sql: `INSERT INTO transfer_lines (id, transfer_id, paper_type_id, accessory_id, quantity_units, quantity_sheets, cut_width_inches, cut_height_inches, pieces_per_sheet, total_cut_pieces, waste_area_per_sheet, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          params: [
            lineId, transferId,
            isAcc ? null : line.paper_type_id,
            isAcc ? line.accessory_id : null,
            parseNum(line.quantity_units),
            result.quantitySheets,
            isAcc ? null : result.cutW,
            isAcc ? null : result.cutH,
            result.pps,
            result.totalPieces,
            result.wasteArea,
          ],
        })

        // Deduct from godown stock_ledger (TRANSFER_OUT)
        statements.push({
          sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at)
                VALUES (?, ?, ?, 'TRANSFER_OUT', ?, ?, datetime('now'))`,
          params: [
            uuid(),
            isAcc ? null : line.paper_type_id,
            isAcc ? line.accessory_id : null,
            -result.quantitySheets,
            transferId,
          ],
        })

        // Add to cutting_stock (TRANSFER_IN)
        statements.push({
          sql: `INSERT INTO cutting_stock (id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, transaction_type, reference_id, cost_per_piece_poisha, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'TRANSFER_IN', ?, ?, datetime('now'))`,
          params: [
            uuid(),
            isAcc ? null : line.paper_type_id,
            isAcc ? line.accessory_id : null,
            isAcc ? null : result.cutW,
            isAcc ? null : result.cutH,
            result.totalPieces,
            transferId,
            Math.round(result.costPerPiece),
          ],
        })
      }

      await dbTransaction(statements)
      addToast({ title: 'Transfer saved', description: `Transfer ${transferNumber} completed.` })
      navigate('/transfers')
    } catch (err: any) {
      addToast({ title: 'Transfer failed', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // Combined dropdown items
  type DropdownItem = { type: 'item'; data: GodownItem } | { type: 'accessory'; data: AccessoryItem }
  const allItems: DropdownItem[] = [
    ...godownItems.map(i => ({ type: 'item' as const, data: i })),
    ...accessoryItems.map(a => ({ type: 'accessory' as const, data: a })),
  ]

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{editTransferId ? 'Edit Transfer' : 'New Transfer'} (Godown → Cutting)</h1>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Transfer Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Transfer Date</Label>
              <Input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Morning cutting batch" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Transfer Lines</h2>
        <Button variant="outline" size="sm" onClick={addLine}>Add Row</Button>
      </div>

      {lines.map((line, idx) => {
        const r = calcTransferLine(line)
        const selectedItem = line.paper_type_id ? godownMap.get(line.paper_type_id) : undefined
        const selectedAcc = line.accessory_id ? accMap.get(line.accessory_id) : undefined
        const isAcc = !!line.accessory_id
        const cat: Category = selectedItem ? selectedItem.category as Category : isAcc ? 'ACCESSORY' : 'PAPER'

        const categoryTabs = ['', 'PAPER', 'CARD', 'STICKER', 'ACCESSORY'] as const
        const catFiltered = line.categoryFilter
          ? allItems.filter(di => {
              if (di.type === 'accessory') return line.categoryFilter === 'ACCESSORY'
              return di.data.category === line.categoryFilter
            })
          : allItems
        const filteredItems = line.itemFilter
          ? catFiltered.filter(di => {
              if (di.type === 'item') {
                return `${di.data.category} ${di.data.brand_name} ${di.data.gsm_value} ${formatSize(di.data.width_inches, di.data.height_inches)}`.toLowerCase().includes(line.itemFilter.toLowerCase())
              }
              return `accessory ${di.data.accessory_name}`.toLowerCase().includes(line.itemFilter.toLowerCase())
            })
          : catFiltered

        return (
          <Card key={line.id}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground">#{idx + 1}</span>
                {(selectedItem || selectedAcc) && (
                  <div className="flex items-center gap-2">
                    <Badge variant={cat === 'PAPER' ? 'secondary' : 'outline'}
                      className={`text-[10px] px-1.5 py-0 ${categoryBadgeClass(cat)}`}>{cat}</Badge>
                    <span className="text-sm font-medium text-primary">
                      {isAcc ? selectedAcc?.accessory_name : (selectedItem ? itemLabel(selectedItem) : '')}
                    </span>
                  </div>
                )}
                <button type="button" className="text-muted-foreground hover:text-destructive transition-colors text-lg leading-none"
                  onClick={() => removeLine(line.id)} disabled={lines.length === 1} title="Remove">×</button>
              </div>

              {/* Item dropdown */}
              <div className="mb-3">
                <Label className="text-xs">Select Item from Godown</Label>
                <Select value={line.paper_type_id || line.accessory_id || ''} onValueChange={v => {
                  if (accMap.has(v)) {
                    updateLine(line.id, { accessory_id: v, paper_type_id: '', cut_size: '' })
                  } else {
                    updateLine(line.id, { paper_type_id: v, accessory_id: '' })
                  }
                }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select item..." /></SelectTrigger>
                  <SelectContent className="max-h-72" header={
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-1">
                        {categoryTabs.map(t => (
                          <button key={t || 'ALL'} type="button"
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded ${line.categoryFilter === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                            onPointerDown={e => { e.preventDefault(); e.stopPropagation(); updateLine(line.id, { categoryFilter: t }) }}>
                            {t || 'All'}
                          </button>
                        ))}
                      </div>
                      <Input placeholder="Search godown..." value={line.itemFilter}
                        onChange={e => updateLine(line.id, { itemFilter: e.target.value })}
                        onKeyDown={e => e.stopPropagation()}
                        className="h-8 text-sm" />
                    </div>
                  }>
                    {filteredItems.length === 0 ? (
                      <div className="py-3 text-center text-sm text-muted-foreground">No items found</div>
                    ) : filteredItems.map(di => {
                      if (di.type === 'accessory') {
                        return (
                          <SelectItem key={`acc-${di.data.accessory_id}`} value={di.data.accessory_id}>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-semibold px-1 rounded bg-amber-100 text-amber-800">A</span>
                              <span>{di.data.accessory_name}</span>
                              <span className="text-muted-foreground text-xs ml-auto">{di.data.total_pieces} pcs</span>
                            </div>
                          </SelectItem>
                        )
                      }
                      const i = di.data
                      const spu = sheetsPerUnit(i.category as Category)
                      const units = i.total_sheets / spu
                      return (
                        <SelectItem key={i.paper_type_id} value={i.paper_type_id}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-semibold px-1 rounded ${categoryBadgeClass(i.category as Category)} ${i.category === 'PAPER' ? 'bg-secondary text-secondary-foreground' : ''}`}>
                              {i.category.charAt(0)}
                            </span>
                            <span>{itemLabel(i)}</span>
                            <span className="text-muted-foreground text-xs ml-auto">
                              {formatNumber(units, 1)} {unitLabelPlural(i.category as Category)}
                            </span>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Inputs */}
              {isAcc ? (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Qty (pieces)</Label>
                    <Input className="h-9" type="number" min="0" step="1" placeholder="10"
                      value={line.quantity_units} onChange={e => updateLine(line.id, { quantity_units: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Available</Label>
                    <div className="h-9 flex items-center text-sm text-muted-foreground">
                      {selectedAcc ? `${selectedAcc.total_pieces} pcs in godown` : '—'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Qty ({selectedItem ? unitLabelPlural(cat) : 'units'})</Label>
                    <Input className="h-9" type="number" min="0" step="0.5" placeholder="3"
                      value={line.quantity_units} onChange={e => updateLine(line.id, { quantity_units: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Cut Size</Label>
                    {(CUT_SIZE_PRESETS[cat]?.length ?? 0) > 0 ? (
                      <>
                        <Select value={CUT_SIZE_PRESETS[cat]!.includes(line.cut_size) ? line.cut_size : '__custom'} onValueChange={v => {
                          if (v !== '__custom') updateLine(line.id, { cut_size: v })
                        }}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder={line.cut_size || 'Select or type...'} />
                          </SelectTrigger>
                          <SelectContent>
                            {CUT_SIZE_PRESETS[cat]!.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            <SelectItem value="__custom">Custom...</SelectItem>
                          </SelectContent>
                        </Select>
                        {(!CUT_SIZE_PRESETS[cat]!.includes(line.cut_size) || line.cut_size === '') && (
                          <Input className="h-8 mt-1 text-xs" type="text" placeholder="e.g. 20x30"
                            value={line.cut_size} onChange={e => updateLine(line.id, { cut_size: e.target.value })} />
                        )}
                      </>
                    ) : (
                      <Input className="h-9" type="text" placeholder="e.g. 20x30"
                        value={line.cut_size} onChange={e => updateLine(line.id, { cut_size: e.target.value })} />
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Available</Label>
                    <div className="h-9 flex items-center text-sm text-muted-foreground">
                      {selectedItem ? `${formatNumber(selectedItem.total_sheets / sheetsPerUnit(cat), 1)} ${unitLabelPlural(cat)}` : '—'}
                    </div>
                  </div>
                </div>
              )}

              {/* Calculated results */}
              {r && (
                <div className="flex items-center gap-6 pt-3 border-t text-sm">
                  {!r.isAccessory && (
                    <>
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground uppercase">Sheets</div>
                        <div className="tabular-nums font-medium">{formatNumber(r.quantitySheets)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground uppercase">Pieces/Sheet</div>
                        <div className="tabular-nums font-medium">{r.pps}</div>
                      </div>
                    </>
                  )}
                  <div className="text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Total Pieces</div>
                    <div className="tabular-nums font-bold text-primary">{formatNumber(r.totalPieces)}</div>
                  </div>
                  {!r.isAccessory && r.wasteArea > 0 && (
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Waste/Sheet</div>
                      <div className="tabular-nums text-muted-foreground">{r.wasteArea.toFixed(1)} sq.in</div>
                    </div>
                  )}
                  {r.quantitySheets > r.availableSheets && (
                    <div className="text-xs text-destructive font-semibold ml-auto">
                      Exceeds godown stock!
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Summary */}
      {validLines.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              {validLines.length} line{validLines.length !== 1 ? 's' : ''}, {formatNumber(validLines.reduce((a, { result }) => a + (result?.totalPieces ?? 0), 0))} total pieces to transfer
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate('/transfers')}>Cancel</Button>
        <Button onClick={handleSave} disabled={!canSave || saving}>
          {saving ? 'Saving...' : editTransferId ? 'Update Transfer' : 'Confirm Transfer'}
        </Button>
      </div>
    </div>
  )
}
