import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbTransaction } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { piecesPerSheet } from '@/lib/calculations'
import { paperDisplayType } from '@/lib/paper-type'
import type { Category } from '@/lib/paper-type'
import { formatBDT, formatNumber, todayISO, bdtToPoisha, profitColor, paperTypeLabel, poishaToBdt } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerRow { id: string; name: string; organization: string | null }

interface GodownItem {
  paper_type_id: string
  category: Category
  brand_name: string
  gsm_value: number
  width_inches: number
  height_inches: number
  variant: string
  total_sheets: number
}

interface AccessoryItem {
  accessory_id: string
  accessory_name: string
  total_pieces: number
}

interface CostRow { paper_type_id: string; avg_cost_per_sheet_poisha: number }
interface AccessoryCostRow { accessory_id: string; avg_cost_poisha: number }

interface LineItem {
  id: string
  paper_type_id: string
  accessory_id: string
  quantity_pieces: string
  cut_size: string
  sheetsOverride: string
  selling_price: string
  totalOverride: string
  itemFilter: string
  categoryFilter: string
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const CUSTOMERS_SQL = `SELECT id, name, organization FROM customers ORDER BY COALESCE(organization, name)`

const GODOWN_SQL = `
  SELECT pt.id as paper_type_id, pt.category,
    b.name as brand_name, g.value as gsm_value,
    p.width_inches, p.height_inches,
    COALESCE(pt.variant, '') as variant,
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
    at.name || ' ' || b.name || ' ' || g.value || COALESCE(g.unit, 'lb') as accessory_name,
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
  PAPER: ['7.5x9', '7.5x10', '9x11.5', '9x14', '10x15', '11.5x18'],
  CARD: ['7x11', '7.25x10.25', '9.25x11', '11x14', '11x17'],
  STICKER: [],
}

const CUTTING_FEE_POISHA = 2000 // ৳20 flat per line

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyLine(): LineItem {
  return {
    id: uuid(),
    paper_type_id: '', accessory_id: '',
    quantity_pieces: '', cut_size: '',
    sheetsOverride: '', selling_price: '', totalOverride: '',
    itemFilter: '', categoryFilter: '',
  }
}

function parseNum(s: string): number { const n = parseFloat(s); return isNaN(n) ? 0 : n }

function parseCutSize(s: string): [number, number] | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const a = parseFloat(m[1]), b = parseFloat(m[2])
  if (isNaN(a) || isNaN(b) || a <= 0 || b <= 0) return null
  return [Math.min(a, b), Math.max(a, b)]
}

function itemLabel(item: GodownItem): string {
  return paperTypeLabel(item.brand_name, item.gsm_value, item.width_inches, item.height_inches, item.variant)
}

function categoryBadgeClass(cat: string): string {
  if (cat === 'CARD') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  if (cat === 'STICKER') return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
  if (cat === 'ACCESSORY') return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
  return ''
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NewOrderPage() {
  const navigate = useNavigate()
  const { addToast } = useToast()

  const [customerId, setCustomerId] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [orderDate, setOrderDate] = useState(todayISO())
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)

  const { data: customers, loading: customersLoading } = useQuery<CustomerRow>(CUSTOMERS_SQL, [], [])
  const { data: godownItems } = useQuery<GodownItem>(GODOWN_SQL, [], [])
  const { data: accessoryItems } = useQuery<AccessoryItem>(ACCESSORY_GODOWN_SQL, [], [])
  const { data: costRows } = useQuery<CostRow>(COSTS_SQL, [], [])
  const { data: accCostRows } = useQuery<AccessoryCostRow>(ACCESSORY_COSTS_SQL, [], [])

  const godownMap = new Map(godownItems.map(i => [i.paper_type_id, i]))
  const accMap = new Map(accessoryItems.map(a => [a.accessory_id, a]))
  const costMap = new Map(costRows.map(c => [c.paper_type_id, c.avg_cost_per_sheet_poisha]))
  const accCostMap = new Map(accCostRows.map(c => [c.accessory_id, c.avg_cost_poisha]))

  // Compute sheets consumed by a single line (for availability tracking)
  function calcSheetsForLine(l: LineItem): number {
    const pieces = parseNum(l.quantity_pieces)
    if (pieces <= 0) return 0
    const isAcc = !!l.accessory_id
    if (isAcc) return pieces // accessories: 1 piece = 1 unit
    const item = l.paper_type_id ? godownMap.get(l.paper_type_id) : undefined
    if (!item) return 0
    const parsed = l.cut_size.trim() ? parseCutSize(l.cut_size) : null
    let pps = 1
    if (parsed) {
      pps = piecesPerSheet(parsed[0], parsed[1], item.width_inches, item.height_inches)
      if (pps <= 0) pps = 1
    }
    const sheetsOvr = parseNum(l.sheetsOverride)
    return sheetsOvr > 0 ? sheetsOvr : Math.ceil(pieces / pps)
  }

  // Compute sheets already claimed by other lines in this form
  function usedByOtherLines(currentLineId: string, paperTypeId: string, accessoryId: string): number {
    let used = 0
    for (const l of lines) {
      if (l.id === currentLineId) continue
      if (paperTypeId && l.paper_type_id === paperTypeId) used += calcSheetsForLine(l)
      if (accessoryId && l.accessory_id === accessoryId) used += calcSheetsForLine(l)
    }
    return used
  }

  const updateLine = useCallback((id: string, patch: Partial<LineItem>) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const next = { ...l, ...patch }
      if ('paper_type_id' in patch && patch.paper_type_id) next.accessory_id = ''
      if ('accessory_id' in patch && patch.accessory_id) { next.paper_type_id = ''; next.cut_size = ''; next.sheetsOverride = '' }
      if ('cut_size' in patch) next.sheetsOverride = ''
      if ('quantity_pieces' in patch || 'selling_price' in patch || 'cut_size' in patch || 'sheetsOverride' in patch) next.totalOverride = ''
      return next
    }))
  }, [])

  const addLine = () => setLines(prev => [...prev, emptyLine()])
  const removeLine = (id: string) => setLines(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev)

  function calcLine(line: LineItem) {
    const isAcc = !!line.accessory_id
    const item = line.paper_type_id ? godownMap.get(line.paper_type_id) : undefined
    const acc = line.accessory_id ? accMap.get(line.accessory_id) : undefined
    if (!item && !acc) return null

    const totalPieces = parseNum(line.quantity_pieces)
    if (totalPieces <= 0) return null
    const price = parseNum(line.selling_price)
    const pricePoisha = bdtToPoisha(price)

    if (isAcc && acc) {
      // Accessory: per piece pricing, no cut size
      const sheets = totalPieces // 1:1 for accessories
      const rawTotal = totalPieces * pricePoisha
      const lineTotal = line.totalOverride ? bdtToPoisha(parseNum(line.totalOverride)) : price > 0 ? Math.ceil(rawTotal / 100) * 100 : 0
      const costPerPiece = accCostMap.get(line.accessory_id) ?? 0
      const costTotal = Math.round(totalPieces * costPerPiece)
      const profit = lineTotal - costTotal
      const margin = lineTotal > 0 ? (profit / lineTotal) * 100 : 0
      const available = acc.total_pieces - usedByOtherLines(line.id, '', line.accessory_id)
      return {
        lineTotal, costTotal, profit, margin, sheets,
        pps: 1, totalPieces, hasCut: false,
        costPerSheet: costPerPiece, availableSheets: available,
        isAccessory: true, cutW: 0, cutH: 0,
        label: acc.accessory_name,
        paper_type_id: null as string | null, accessory_id: line.accessory_id,
      }
    }

    if (!item) return null
    const costPerSheet = costMap.get(line.paper_type_id) ?? 0

    // Parse optional cut size; blank = full sheet (1 piece = 1 sheet)
    const parsed = line.cut_size.trim() ? parseCutSize(line.cut_size) : null
    const hasCut = parsed !== null
    const cutW = parsed ? parsed[0] : Math.min(item.width_inches, item.height_inches)
    const cutH = parsed ? parsed[1] : Math.max(item.width_inches, item.height_inches)

    // Pieces per sheet
    let pps = 1
    if (hasCut) {
      pps = piecesPerSheet(cutW, cutH, item.width_inches, item.height_inches)
      if (pps <= 0) pps = 1
    }

    // Sheets needed = ceil(pieces / pps), user can override
    const sheetsOvr = parseNum(line.sheetsOverride)
    const sheets = sheetsOvr > 0 ? sheetsOvr : Math.ceil(totalPieces / pps)

    // Price is always per sheet for paper/card/sticker
    const rawTotal = sheets * pricePoisha
    const cuttingFee = hasCut ? CUTTING_FEE_POISHA : 0
    const lineTotal = line.totalOverride
      ? bdtToPoisha(parseNum(line.totalOverride))
      : price > 0 ? Math.ceil(rawTotal / 100) * 100 + cuttingFee : 0
    const costTotal = Math.round(sheets * costPerSheet)
    const profit = lineTotal - costTotal
    const margin = lineTotal > 0 ? (profit / lineTotal) * 100 : 0

    const available = item.total_sheets - usedByOtherLines(line.id, line.paper_type_id, '')
    return {
      lineTotal, costTotal, profit, margin, sheets,
      pps, totalPieces, hasCut,
      costPerSheet, availableSheets: available,
      isAccessory: false, cutW, cutH,
      label: itemLabel(item),
      paper_type_id: line.paper_type_id as string | null, accessory_id: null as string | null,
    }
  }

  const calcs = lines.map(l => ({ line: l, result: calcLine(l) }))
  const validCalcs = calcs.filter(c => c.result !== null)
  const hasExceeding = validCalcs.some(({ result }) => result !== null && result.sheets > result.availableSheets)
  const grandTotal = calcs.reduce((a, { result }) => a + (result?.lineTotal ?? 0), 0)
  const grandCost = calcs.reduce((a, { result }) => a + (result?.costTotal ?? 0), 0)
  const grandProfit = grandTotal - grandCost
  const grandMargin = grandTotal > 0 ? (grandProfit / grandTotal) * 100 : 0
  const hasPricedLines = validCalcs.some(({ result }) => result !== null && result.lineTotal > 0)
  const canSave = customerId !== '' && orderDate !== '' && hasPricedLines && !hasExceeding

  const customerDisplayName = (c: CustomerRow) => c.organization || c.name
  const filteredCustomers = customerFilter
    ? customers.filter(c => customerDisplayName(c).toLowerCase().includes(customerFilter.toLowerCase()) || c.name.toLowerCase().includes(customerFilter.toLowerCase()))
    : customers

  // Combined dropdown items
  type DropdownItem = { type: 'item'; data: GodownItem } | { type: 'accessory'; data: AccessoryItem }
  const allItems: DropdownItem[] = [
    ...godownItems.map(i => ({ type: 'item' as const, data: i })),
    ...accessoryItems.map(a => ({ type: 'accessory' as const, data: a })),
  ]

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const orderId = uuid()
      const statements: { sql: string; params: any[] }[] = []

      statements.push({
        sql: `INSERT INTO orders (id, customer_id, order_date, status, notes, created_at) VALUES (?, ?, ?, 'PENDING', NULL, datetime('now'))`,
        params: [orderId, customerId, orderDate],
      })

      for (const { line, result } of calcs) {
        if (!result) continue

        // Selling price per piece for record-keeping
        const sellingPerPiece = result.isAccessory
          ? bdtToPoisha(parseNum(line.selling_price))
          : (result.sheets > 0 ? Math.round(result.lineTotal / result.totalPieces) : 0)

        const costPerPiece = result.isAccessory
          ? (accCostMap.get(line.accessory_id) ?? 0)
          : (result.pps > 0 ? result.costPerSheet / result.pps : 0)

        // Order line
        statements.push({
          sql: `INSERT INTO order_lines (id, order_id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, quantity_sheets, selling_price_per_piece_poisha, line_total_poisha, cost_per_piece_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, label, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          params: [uuid(), orderId, result.paper_type_id, result.accessory_id,
            result.cutW || null, result.cutH || null,
            result.totalPieces, result.sheets,
            sellingPerPiece, result.lineTotal,
            Math.round(costPerPiece), result.costTotal,
            result.profit, result.margin,
            result.label],
        })

        // Deduct from godown stock_ledger (SALE)
        statements.push({
          sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at)
                VALUES (?, ?, ?, 'SALE', ?, ?, datetime('now'))`,
          params: [uuid(),
            result.isAccessory ? null : result.paper_type_id,
            result.isAccessory ? result.accessory_id : null,
            -result.sheets, orderId],
        })
      }

      await dbTransaction(statements)
      addToast({ title: 'Order saved', description: `Order created with ${validCalcs.length} items.` })
      navigate('/orders')
    } catch (err: any) {
      addToast({ title: 'Save failed', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto w-full">
      <h1 className="text-lg font-semibold">New Order</h1>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Order Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Customer</Label>
              {customersLoading ? <div className="h-9 animate-pulse rounded bg-muted" /> : (
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
                  <SelectContent className="max-h-60" header={
                    <Input placeholder="Search customers..." value={customerFilter}
                      onChange={e => setCustomerFilter(e.target.value)}
                      className="h-8 text-sm" />
                  }>
                    {filteredCustomers.length === 0 ? <div className="py-3 text-center text-sm text-muted-foreground">No customers found</div>
                     : filteredCustomers.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.organization ? <>{c.organization} <span className="text-muted-foreground text-xs">({c.name})</span></> : c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Order Date</Label>
              <DatePicker value={orderDate} onChange={setOrderDate} />
            </div>
          </div>
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold">Items (from Godown)</h2>

      {lines.map((line, idx) => {
        const r = calcLine(line)
        const selectedItem = line.paper_type_id ? godownMap.get(line.paper_type_id) : undefined
        const selectedAcc = line.accessory_id ? accMap.get(line.accessory_id) : undefined
        const isAcc = !!line.accessory_id
        const cat: string = selectedItem ? selectedItem.category : isAcc ? 'ACCESSORY' : 'PAPER'

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
                return `${di.data.category} ${itemLabel(di.data)}`.toLowerCase().includes(line.itemFilter.toLowerCase())
              }
              return `accessory ${di.data.accessory_name}`.toLowerCase().includes(line.itemFilter.toLowerCase())
            })
          : catFiltered

        const parsed = line.cut_size.trim() ? parseCutSize(line.cut_size) : null
        const hasCut = parsed !== null

        return (
          <Card key={line.id}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground">#{idx + 1}</span>
                {(selectedItem || selectedAcc) && (
                  <div className="flex items-center gap-2">
                    {(() => {
                      const displayType = cat === 'PAPER' && selectedItem ? paperDisplayType(selectedItem.variant) : cat
                      const isCarbon = displayType === 'Carbon Paper'
                      const isColor = displayType === 'Color Paper'
                      return <Badge variant={cat === 'PAPER' && !isCarbon && !isColor ? 'secondary' : 'outline'}
                        className={`text-[10px] px-1.5 py-0 ${isCarbon ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' : isColor ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' : categoryBadgeClass(cat)}`}>{displayType}</Badge>
                    })()}
                    <span className="text-sm font-medium text-primary">
                      {isAcc ? selectedAcc?.accessory_name : (selectedItem ? itemLabel(selectedItem) : '')}
                    </span>
                    {!isAcc && selectedItem && (() => {
                      const cps = costMap.get(line.paper_type_id) ?? 0
                      if (cps <= 0) return <span className="text-xs text-muted-foreground">(no cost)</span>
                      return <span className="text-xs text-muted-foreground">(৳{(cps / 100).toFixed(2)}/sheet)</span>
                    })()}
                    {isAcc && selectedAcc && (() => {
                      const cpp = accCostMap.get(line.accessory_id) ?? 0
                      if (cpp <= 0) return <span className="text-xs text-muted-foreground">(no cost)</span>
                      return <span className="text-xs text-muted-foreground">(৳{(cpp / 100).toFixed(2)}/pc)</span>
                    })()}
                  </div>
                )}
                <button className="text-muted-foreground hover:text-destructive text-lg leading-none" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>×</button>
              </div>

              {/* Item dropdown */}
              <div className="mb-3">
                <Label className="text-xs">Select Item from Godown</Label>
                <Select value={line.paper_type_id || line.accessory_id || ''} onValueChange={v => {
                  if (accMap.has(v)) {
                    updateLine(line.id, { accessory_id: v, paper_type_id: '', cut_size: '', ppsOverride: '' })
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
                      return (
                        <SelectItem key={i.paper_type_id} value={i.paper_type_id}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-semibold px-1 rounded ${categoryBadgeClass(i.category)} ${i.category === 'PAPER' ? 'bg-secondary text-secondary-foreground' : ''}`}>
                              {i.category.charAt(0)}
                            </span>
                            <span>{itemLabel(i)}</span>
                            <span className="text-muted-foreground text-xs ml-auto">{formatNumber(i.total_sheets)} sheets</span>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Available stock */}
              {(selectedItem || selectedAcc) && (() => {
                const rawStock = isAcc ? selectedAcc!.total_pieces : selectedItem!.total_sheets
                const adjusted = rawStock - usedByOtherLines(line.id, line.paper_type_id, line.accessory_id)
                const sheetsNeeded = r?.sheets ?? 0
                return (
                  <div className="text-xs text-muted-foreground mb-2">
                    Available: <span className={`font-semibold ${sheetsNeeded > adjusted && sheetsNeeded > 0 ? 'text-destructive' : 'text-foreground'}`}>
                      {formatNumber(adjusted)} {isAcc ? 'pcs' : 'sheets'}
                    </span>
                    {adjusted < rawStock && (
                      <span className="text-muted-foreground ml-1">(of {formatNumber(rawStock)} in godown)</span>
                    )}
                    {sheetsNeeded > adjusted && sheetsNeeded > 0 && (
                      <span className="text-destructive font-semibold ml-2">Exceeds stock!</span>
                    )}
                  </div>
                )
              })()}

              {/* Inputs */}
              {isAcc ? (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Qty (pieces)</Label>
                    <Input className="h-9" type="number" min="0" step="1" value={line.quantity_pieces}
                      onChange={e => updateLine(line.id, { quantity_pieces: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Price / piece (৳)</Label>
                    <Input className="h-9" type="number" min="0" step="1" value={line.selling_price}
                      onChange={e => updateLine(line.id, { selling_price: e.target.value })} />
                  </div>
                </div>
              ) : (
                <>
                  {/* Row 1: Cut Size */}
                  <div className="mb-3">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Cut Size (optional — blank = full sheet)</Label>
                      <Input className="h-9" type="text" placeholder="e.g. 9x11.5"
                        value={line.cut_size} onChange={e => updateLine(line.id, { cut_size: e.target.value })} />
                      {(CUT_SIZE_PRESETS[cat]?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {CUT_SIZE_PRESETS[cat]!.map(s => (
                            <button key={s} type="button"
                              className={`px-1.5 py-0.5 text-[10px] rounded border ${line.cut_size === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'}`}
                              onClick={() => updateLine(line.id, { cut_size: line.cut_size === s ? '' : s })}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Pieces to sell, Price */}
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Pieces to sell</Label>
                      <Input className="h-9" type="number" min="0" step="1" value={line.quantity_pieces}
                        onChange={e => updateLine(line.id, { quantity_pieces: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Price / sheet (৳)</Label>
                      <Input className="h-9" type="number" min="0" step="0.01" value={line.selling_price}
                        onChange={e => updateLine(line.id, { selling_price: e.target.value })} />
                    </div>
                  </div>

                  {/* Sheets needed + cutting badge */}
                  {r && (
                    <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        Sheets needed:
                        <Input className="h-6 w-14 text-center text-xs font-semibold p-0"
                          type="number" min="1" step="1"
                          value={line.sheetsOverride || String(r.sheets)}
                          onChange={e => updateLine(line.id, { sheetsOverride: e.target.value })} />
                      </span>
                      {hasCut && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-50 text-orange-700 dark:bg-orange-900 dark:text-orange-200">
                          +৳20 cutting
                        </Badge>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Line total */}
              {r && (
                <div className="flex items-center gap-4 pt-3 border-t">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground uppercase">Total</span>
                    <Input className="h-8 text-base tabular-nums text-center w-24 font-bold" type="number" min="0"
                      value={line.totalOverride || String(poishaToBdt(r.lineTotal))}
                      onChange={e => updateLine(line.id, { totalOverride: e.target.value })} />
                  </div>
                  <div className="ml-auto flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Profit</div>
                      <div className={`text-sm tabular-nums font-semibold ${profitColor(r.margin)}`}>{formatBDT(r.profit)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Margin</div>
                      <div className={`text-sm tabular-nums font-semibold ${profitColor(r.margin)}`}>{r.margin.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      <Button variant="outline" size="sm" onClick={addLine} className="w-full">+ Add Row</Button>

      {/* Summary */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><span className="text-xs text-muted-foreground uppercase">Total</span><div className="text-xl font-bold tabular-nums">{formatBDT(grandTotal)}</div></div>
            <div><span className="text-xs text-muted-foreground uppercase">Cost</span><div className="text-xl font-bold tabular-nums text-muted-foreground">{formatBDT(grandCost)}</div></div>
            <div><span className="text-xs text-muted-foreground uppercase">Profit</span><div className={`text-xl font-bold tabular-nums ${profitColor(grandMargin)}`}>{formatBDT(grandProfit)}</div></div>
            <div><span className="text-xs text-muted-foreground uppercase">Margin</span><div className={`text-xl font-bold tabular-nums ${profitColor(grandMargin)}`}>{grandMargin.toFixed(1)}%</div></div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate('/orders')}>Cancel</Button>
        <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? 'Saving...' : 'Save Order'}</Button>
      </div>
    </div>
  )
}
