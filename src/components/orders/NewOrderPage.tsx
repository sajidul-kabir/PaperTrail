import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbTransaction } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { piecesPerSheet } from '@/lib/calculations'
import { formatBDT, formatNumber, todayISO, bdtToPoisha, profitColor, formatSize, poishaToBdt } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerRow { id: string; name: string; organization: string | null }

interface CuttingStockItem {
  paper_type_id: string | null; accessory_id: string | null
  cut_width_inches: number | null; cut_height_inches: number | null
  total_pieces: number; avg_cost_per_piece_poisha: number
  label: string; category: string
  brand_name: string; gsm_value: number
  sheet_width: number | null; sheet_height: number | null
}

interface LineItem {
  id: string; stockKey: string; quantity: string; selling_price: string; itemFilter: string; totalOverride: string; categoryFilter: string
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const CUSTOMERS_SQL = `SELECT id, name, organization FROM customers ORDER BY COALESCE(organization, name)`

const CUTTING_STOCK_SQL = `
  SELECT cs.paper_type_id, cs.accessory_id, cs.cut_width_inches, cs.cut_height_inches,
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
    COALESCE(b.name, at.name, '') as brand_name,
    COALESCE(g.value, ag.value, 0) as gsm_value,
    p.width_inches as sheet_width,
    p.height_inches as sheet_height
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
  ORDER BY category, label
`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stockKey(item: CuttingStockItem): string {
  return `${item.paper_type_id || ''}|${item.accessory_id || ''}|${item.cut_width_inches ?? ''}|${item.cut_height_inches ?? ''}`
}
function emptyLine(): LineItem {
  return { id: uuid(), stockKey: '', quantity: '', selling_price: '', itemFilter: '', totalOverride: '', categoryFilter: '' }
}
function parseNum(s: string): number { const n = parseFloat(s); return isNaN(n) ? 0 : n }
function categoryBadgeClass(cat: string): string {
  if (cat === 'CARD') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  if (cat === 'STICKER') return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
  if (cat === 'ACCESSORY') return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
  return ''
}
function dropdownLabel(item: CuttingStockItem): string {
  const cutLabel = (item.cut_width_inches && item.cut_height_inches) ? ` ${formatSize(item.cut_width_inches, item.cut_height_inches)}` : ''
  return `${item.label}${cutLabel}`
}
function cleanNum(n: number): string {
  return n % 1 === 0 ? String(Math.round(n)) : String(n)
}
function cleanSize(w: number, h: number): string {
  const s = Math.min(w, h), l = Math.max(w, h)
  return `${cleanNum(s)}x${cleanNum(l)}`
}
function shortLabel(item: CuttingStockItem): string {
  const fullSize = item.label.match(/(\d+\.?\d*)\s*x\s*(\d+\.?\d*)/)
  const full = fullSize ? cleanSize(parseFloat(fullSize[1]), parseFloat(fullSize[2])) : ''
  const cut = (item.cut_width_inches && item.cut_height_inches) ? cleanSize(item.cut_width_inches, item.cut_height_inches) : ''
  const gsm = item.gsm_value > 0 ? `${item.gsm_value}` : ''
  return `${item.brand_name} ${gsm} ${full} ${cut}`.replace(/\s+/g, ' ').trim()
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
  const { data: cuttingStock } = useQuery<CuttingStockItem>(CUTTING_STOCK_SQL, [], [])

  const stockMap = new Map<string, CuttingStockItem>()
  for (const item of cuttingStock) stockMap.set(stockKey(item), item)

  const updateLine = useCallback((id: string, patch: Partial<LineItem>) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const next = { ...l, ...patch }
      if ('stockKey' in patch || 'quantity' in patch) next.totalOverride = ''
      return next
    }))
  }, [])

  const addLine = () => setLines(prev => [...prev, emptyLine()])
  const removeLine = (id: string) => setLines(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev)

  function calcLine(line: LineItem) {
    const item = stockMap.get(line.stockKey)
    if (!item) return null
    const qty = parseNum(line.quantity)
    const price = parseNum(line.selling_price)
    if (qty <= 0 || price <= 0) return null
    const pricePoisha = bdtToPoisha(price)
    const pps = (item.category === 'CARD' || item.category === 'STICKER') && item.cut_width_inches && item.cut_height_inches && item.sheet_width && item.sheet_height
      ? piecesPerSheet(Math.min(item.cut_width_inches, item.cut_height_inches), Math.max(item.cut_width_inches, item.cut_height_inches), item.sheet_width, item.sheet_height)
      : 0
    const sellingPerPiece = item.category === 'PAPER' ? pricePoisha / 1000
      : (item.category === 'CARD' || item.category === 'STICKER') && pps > 0 ? pricePoisha / pps
      : pricePoisha
    const rawTotal = qty * sellingPerPiece
    const lineTotal = line.totalOverride ? bdtToPoisha(parseNum(line.totalOverride)) : Math.ceil(rawTotal / 100) * 100
    const costPerPiece = item.avg_cost_per_piece_poisha
    const costTotal = Math.round(qty * costPerPiece)
    const profit = lineTotal - costTotal
    const margin = lineTotal > 0 ? (profit / lineTotal) * 100 : 0
    return { lineTotal, costTotal, profit, margin, qty, costPerPiece, sellingPerPiece: Math.round(sellingPerPiece), item }
  }

  const calcs = lines.map(l => ({ line: l, result: calcLine(l) }))
  const grandTotal = calcs.reduce((a, { result }) => a + (result?.lineTotal ?? 0), 0)
  const grandCost = calcs.reduce((a, { result }) => a + (result?.costTotal ?? 0), 0)
  const grandProfit = grandTotal - grandCost
  const grandMargin = grandTotal > 0 ? (grandProfit / grandTotal) * 100 : 0
  const canSave = customerId !== '' && orderDate !== '' && calcs.some(({ result }) => result !== null)

  const customerDisplayName = (c: CustomerRow) => c.organization || c.name
  const filteredCustomers = customerFilter
    ? customers.filter(c => customerDisplayName(c).toLowerCase().includes(customerFilter.toLowerCase()) || c.name.toLowerCase().includes(customerFilter.toLowerCase()))
    : customers

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
        const item = result.item

        // Order line
        statements.push({
          sql: `INSERT INTO order_lines (id, order_id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, selling_price_per_piece_poisha, line_total_poisha, cost_per_piece_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, label, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          params: [uuid(), orderId, item.paper_type_id, item.accessory_id, item.cut_width_inches, item.cut_height_inches, result.qty, result.sellingPerPiece, result.lineTotal, Math.round(result.costPerPiece), result.costTotal, result.profit, result.margin, dropdownLabel(item)],
        })

        // Deduct from cutting_stock
        statements.push({
          sql: `INSERT INTO cutting_stock (id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, transaction_type, reference_id, cost_per_piece_poisha, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'SALE', ?, ?, datetime('now'))`,
          params: [uuid(), item.paper_type_id, item.accessory_id, item.cut_width_inches, item.cut_height_inches, -result.qty, orderId, Math.round(result.costPerPiece)],
        })
      }

      await dbTransaction(statements)
      addToast({ title: 'Order saved', description: `Order created with ${calcs.filter(c => c.result).length} items.` })
      navigate('/orders')
    } catch (err: any) {
      addToast({ title: 'Save failed', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
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
                      onKeyDown={e => e.stopPropagation()} className="h-8 text-sm" />
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
              <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Items (from Cutting Stock)</h2>
        <Button variant="outline" size="sm" onClick={addLine}>Add Row</Button>
      </div>

      {lines.map((line, idx) => {
        const r = calcLine(line)
        const selected = stockMap.get(line.stockKey)
        const cat = selected?.category ?? 'PAPER'
        const catFiltered = line.categoryFilter
          ? cuttingStock.filter(item => item.category === line.categoryFilter)
          : cuttingStock
        const filteredItems = line.itemFilter
          ? catFiltered.filter(item => `${item.category} ${dropdownLabel(item)}`.toLowerCase().includes(line.itemFilter.toLowerCase()))
          : catFiltered
        const categoryTabs = ['', 'PAPER', 'CARD', 'STICKER', 'ACCESSORY'] as const

        return (
          <Card key={line.id}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground">#{idx + 1}</span>
                {selected && (
                  <div className="flex items-center gap-2">
                    <Badge variant={cat === 'PAPER' ? 'secondary' : 'outline'} className={`text-[10px] px-1.5 py-0 ${categoryBadgeClass(cat)}`}>{cat}</Badge>
                    <span className="text-sm font-medium text-primary">{dropdownLabel(selected)}</span>
                    <span className="text-xs text-muted-foreground">
                      ({selected.avg_cost_per_piece_poisha > 0 ? (() => {
                        const costPc = formatBDT(Math.round(selected.avg_cost_per_piece_poisha))
                        if ((cat === 'CARD' || cat === 'STICKER') && selected.cut_width_inches && selected.cut_height_inches && selected.sheet_width && selected.sheet_height) {
                          const pps = piecesPerSheet(Math.min(selected.cut_width_inches, selected.cut_height_inches), Math.max(selected.cut_width_inches, selected.cut_height_inches), selected.sheet_width, selected.sheet_height)
                          if (pps > 0) return `${formatBDT(Math.round(selected.avg_cost_per_piece_poisha * pps))}/sheet, ${costPc}/pc`
                        }
                        return `${costPc}/pc`
                      })() : 'no cost'})
                    </span>
                  </div>
                )}
                <button className="text-muted-foreground hover:text-destructive text-lg leading-none" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>×</button>
              </div>

              <div className="mb-3">
                <Label className="text-xs">Select Item</Label>
                <Select value={line.stockKey} onValueChange={v => updateLine(line.id, { stockKey: v })}>
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
                      <Input placeholder="Search..." value={line.itemFilter} onChange={e => updateLine(line.id, { itemFilter: e.target.value })} onKeyDown={e => e.stopPropagation()} className="h-8 text-sm" />
                    </div>
                  }>
                    {filteredItems.length === 0 ? <div className="py-3 text-center text-sm text-muted-foreground">No items</div>
                     : filteredItems.map(item => {
                      const key = stockKey(item)
                      return (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-semibold px-1 rounded ${categoryBadgeClass(item.category)} ${item.category === 'PAPER' ? 'bg-secondary text-secondary-foreground' : ''}`}>
                              {item.category.charAt(0)}
                            </span>
                            <span>{shortLabel(item)}</span>
                            <span className="text-muted-foreground text-xs ml-auto">{formatNumber(item.total_pieces)} pcs</span>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              {selected && (
                <div className="text-xs text-muted-foreground mb-2">Available: <span className="font-semibold text-foreground">{formatNumber(selected.total_pieces)} pcs</span></div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Qty (pieces)</Label>
                  <Input className="h-9" type="number" min="0" step="1" value={line.quantity} onChange={e => updateLine(line.id, { quantity: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">{cat === 'PAPER' ? 'Price / 1000 pcs (৳)' : (cat === 'CARD' || cat === 'STICKER') ? 'Price / sheet (৳)' : 'Price / piece (৳)'}</Label>
                  <Input className="h-9" type="number" min="0" step="1" value={line.selling_price} onChange={e => updateLine(line.id, { selling_price: e.target.value })} />
                </div>
              </div>

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
