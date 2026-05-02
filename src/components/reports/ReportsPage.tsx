import { useState, useMemo } from 'react'
import { useQuery } from '@/hooks/useQuery'
import { dbQuery } from '@/lib/ipc'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatBDT, formatDate, profitColor, formatNumber, formatSize } from '@/lib/utils'
import { sheetsPerUnit, unitLabelPlural, paperDisplayType, isPacketVariant } from '@/lib/paper-type'
import type { Category } from '@/lib/paper-type'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'

// ── Date helpers ──────────────────────────────────────────────────────────────

function getWeekRange(date: Date): [string, string] {
  const d = new Date(date)
  const day = d.getDay()
  // Saturday = start of week. day: 0=Sun,1=Mon,...,5=Fri,6=Sat
  const diff = day >= 6 ? 0 : day + 1 // how many days back to Saturday
  const sat = new Date(d)
  sat.setDate(d.getDate() - diff)
  const fri = new Date(sat)
  fri.setDate(sat.getDate() + 6)
  return [isoDate(sat), isoDate(fri)]
}

function getMonthRange(date: Date): [string, string] {
  const y = date.getFullYear(), m = date.getMonth()
  const first = new Date(y, m, 1)
  const last = new Date(y, m + 1, 0)
  return [isoDate(first), isoDate(last)]
}

function shiftWeek(date: Date, dir: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + dir * 7)
  return d
}

function shiftMonth(date: Date, dir: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + dir)
  return d
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatPeriodLabel(mode: 'week' | 'month', date: Date): string {
  if (mode === 'month') {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  const [start, end] = getWeekRange(date)
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(s)} – ${fmt(e)}, ${e.getFullYear()}`
}

function poishaToBdt(p: number): number {
  return p / 100
}

// ── Period Navigation ─────────────────────────────────────────────────────────

function PeriodNav({ mode, setMode, date, setDate }: {
  mode: 'week' | 'month'
  setMode: (m: 'week' | 'month') => void
  date: Date
  setDate: (d: Date) => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-md border">
        <Button
          variant={mode === 'week' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-r-none h-8"
          onClick={() => setMode('week')}
        >Weekly</Button>
        <Button
          variant={mode === 'month' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-l-none h-8"
          onClick={() => setMode('month')}
        >Monthly</Button>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline" size="icon" className="h-8 w-8"
          onClick={() => setDate(mode === 'week' ? shiftWeek(date, -1) : shiftMonth(date, -1))}
        ><ChevronLeft className="h-4 w-4" /></Button>
        <span className="text-sm font-medium min-w-[180px] text-center">
          {formatPeriodLabel(mode, date)}
        </span>
        <Button
          variant="outline" size="icon" className="h-8 w-8"
          onClick={() => setDate(mode === 'week' ? shiftWeek(date, 1) : shiftMonth(date, 1))}
        ><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function statusMessage(loading: boolean, error: string | null, empty: boolean) {
  if (loading) return <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading…</div>
  if (error) return <div className="flex items-center justify-center py-10 text-sm text-destructive">{error}</div>
  if (empty) return <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">No data for this period.</div>
  return null
}

function CategoryBadge({ category, variant }: { category: string; variant?: string }) {
  const cat = category as Category
  if (cat === 'ACCESSORY') {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Accessory</Badge>
  }
  if (cat === 'CARD') {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Card</Badge>
  }
  if (cat === 'STICKER') {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">Sticker</Badge>
  }
  // PAPER with subtypes
  const displayType = paperDisplayType(variant || '')
  if (displayType === 'Carbon Paper') {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200">Carbon Paper</Badge>
  }
  if (displayType === 'Color Paper') {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200">Color Paper</Badge>
  }
  if (displayType === 'Packet Paper') {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">Packet Paper</Badge>
  }
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Paper</Badge>
}

function CategoryFilterTabs({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="ALL">All</TabsTrigger>
        <TabsTrigger value="PAPER">Paper</TabsTrigger>
        <TabsTrigger value="CARD">Card</TabsTrigger>
        <TabsTrigger value="STICKER">Sticker</TabsTrigger>
        <TabsTrigger value="ACCESSORY">Accessory</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1']

// ── Tab 1: Sales ──────────────────────────────────────────────────────────────

interface SalesRow {
  order_date: string
  order_count: number
  revenue: number
  cost: number
  profit: number
}

function SalesTab({ start, end }: { start: string; end: string }) {
  const SALES_SQL = `
    SELECT o.order_date,
      COUNT(DISTINCT o.id) as order_count,
      COALESCE(SUM(ol.line_total_poisha), 0) as revenue,
      COALESCE(SUM(ol.cost_total_poisha), 0) as cost,
      COALESCE(SUM(ol.profit_poisha), 0) as profit
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    WHERE o.status != 'VOID' AND o.order_date BETWEEN ? AND ?
    GROUP BY o.order_date ORDER BY o.order_date
  `
  const { data, loading, error } = useQuery<SalesRow>(SALES_SQL, [start, end], [start, end])

  const totals = useMemo(() => {
    const t = { revenue: 0, cost: 0, profit: 0, orders: 0 }
    for (const r of data) {
      t.revenue += r.revenue
      t.cost += r.cost
      t.profit += r.profit
      t.orders += r.order_count
    }
    return t
  }, [data])

  const margin = totals.revenue > 0 ? (totals.profit * 100) / totals.revenue : 0

  const chartData = useMemo(() =>
    data.map(r => ({
      date: new Date(r.order_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      Revenue: poishaToBdt(r.revenue),
      Profit: poishaToBdt(r.profit),
    })), [data])

  const status = statusMessage(loading, error, data.length === 0)
  if (status) return status

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <SummaryCard label="Revenue" value={formatBDT(totals.revenue)} />
        <SummaryCard label="Cost" value={formatBDT(totals.cost)} className="text-muted-foreground" />
        <SummaryCard label="Profit" value={formatBDT(totals.profit)} className={profitColor(margin)} />
        <SummaryCard label="Margin" value={`${margin.toFixed(1)}%`} className={profitColor(margin)} />
        <SummaryCard label="Orders" value={formatNumber(totals.orders)} />
      </div>

      <Card>
        <CardContent className="pt-4 pb-2">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" fontSize={12} tickLine={false} />
              <YAxis fontSize={12} tickLine={false} tickFormatter={v => `৳${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
              <Tooltip formatter={(v: number) => `৳${formatNumber(v, 2)}`} />
              <Bar dataKey="Revenue" fill="#2563eb" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Profit" fill="#16a34a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(row => {
                const m = row.revenue > 0 ? (row.profit * 100) / row.revenue : 0
                return (
                  <TableRow key={row.order_date}>
                    <TableCell className="text-sm whitespace-nowrap">{formatDate(row.order_date)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{formatNumber(row.order_count)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">{formatBDT(row.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatBDT(row.cost)}</TableCell>
                    <TableCell className={`text-right tabular-nums text-sm font-medium ${profitColor(m)}`}>{formatBDT(row.profit)}</TableCell>
                    <TableCell className={`text-right tabular-nums text-sm ${profitColor(m)}`}>{m.toFixed(1)}%</TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="font-semibold border-t-2">
                <TableCell className="text-sm">Total</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{formatNumber(totals.orders)}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{formatBDT(totals.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatBDT(totals.cost)}</TableCell>
                <TableCell className={`text-right tabular-nums text-sm ${profitColor(margin)}`}>{formatBDT(totals.profit)}</TableCell>
                <TableCell className={`text-right tabular-nums text-sm ${profitColor(margin)}`}>{margin.toFixed(1)}%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Tab 2: Item Breakdown ─────────────────────────────────────────────────────

interface ItemRow {
  paper_type_id: string | null
  accessory_id: string | null
  label: string
  category: string
  variant: string
  total_sheets: number
  revenue: number
  cost: number
  profit: number
}

interface ItemDetailRow {
  order_date: string
  customer_name: string
  organization: string | null
  quantity_pieces: number
  cut_width_inches: number | null
  cut_height_inches: number | null
  selling_price_per_piece_poisha: number
  line_total_poisha: number
}

function ItemBreakdownTab({ start, end }: { start: string; end: string }) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [detailRows, setDetailRows] = useState<ItemDetailRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [catFilter, setCatFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  const ITEMS_SQL = `
    SELECT ol.paper_type_id, ol.accessory_id, ol.label,
      COALESCE(pt.category, 'ACCESSORY') as category,
      COALESCE(pt.variant, '') as variant,
      COALESCE(SUM(ol.quantity_sheets), 0) as total_sheets,
      COALESCE(SUM(ol.line_total_poisha), 0) as revenue,
      COALESCE(SUM(ol.cost_total_poisha), 0) as cost,
      COALESCE(SUM(ol.profit_poisha), 0) as profit
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    LEFT JOIN paper_types pt ON ol.paper_type_id = pt.id
    WHERE o.status != 'VOID' AND o.order_date BETWEEN ? AND ?
    GROUP BY COALESCE(ol.paper_type_id, ''), COALESCE(ol.accessory_id, ''), ol.label
    ORDER BY revenue DESC
  `
  const { data, loading, error } = useQuery<ItemRow>(ITEMS_SQL, [start, end], [start, end])

  const filtered = useMemo(() =>
    data
      .filter(r => catFilter === 'ALL' || r.category === catFilter)
      .filter(r => !search || r.label.toLowerCase().includes(search.toLowerCase())),
    [data, catFilter, search])

  const chartData = useMemo(() =>
    filtered.slice(0, 10).map(r => ({
      name: r.label.length > 25 ? r.label.slice(0, 22) + '...' : r.label,
      Revenue: poishaToBdt(r.revenue),
    })), [filtered])

  async function toggleExpand(row: ItemRow) {
    const key = itemKey(row)
    if (expandedItem === key) {
      setExpandedItem(null)
      return
    }
    setExpandedItem(key)
    setDetailLoading(true)
    try {
      const condition = row.paper_type_id
        ? 'ol.paper_type_id = ?'
        : 'ol.accessory_id = ?'
      const param = row.paper_type_id || row.accessory_id
      const sql = `
        SELECT o.order_date, c.name as customer_name, c.organization,
          ol.quantity_pieces, ol.cut_width_inches, ol.cut_height_inches,
          ol.selling_price_per_piece_poisha, ol.line_total_poisha
        FROM order_lines ol
        JOIN orders o ON o.id = ol.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE o.status != 'VOID' AND o.order_date BETWEEN ? AND ?
          AND ${condition} AND ol.label = ?
        ORDER BY o.order_date DESC
      `
      const rows = await dbQuery<ItemDetailRow>(sql, [start, end, param, row.label])
      setDetailRows(rows)
    } catch {
      setDetailRows([])
    } finally {
      setDetailLoading(false)
    }
  }

  const status = statusMessage(loading, error, data.length === 0)
  if (status) return status

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 flex-wrap">
        <CategoryFilterTabs value={catFilter} onChange={setCatFilter} />
        <Input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top 10 Items by Revenue</CardTitle>
          </CardHeader>
          <CardContent className="pt-2 pb-2">
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 35)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={12} tickFormatter={v => `৳${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <YAxis type="category" dataKey="name" fontSize={11} width={160} tickLine={false} />
                <Tooltip formatter={(v: number) => `৳${formatNumber(v, 2)}`} />
                <Bar dataKey="Revenue" fill="#2563eb" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Sheets</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No items found.</TableCell></TableRow>
              )}
              {filtered.map(row => {
                const key = itemKey(row)
                const m = row.revenue > 0 ? (row.profit * 100) / row.revenue : 0
                const isExpanded = expandedItem === key
                return (
                  <>
                    <TableRow
                      key={key}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleExpand(row)}
                    >
                      <TableCell className="w-8 px-2">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{row.label}</TableCell>
                      <TableCell><CategoryBadge category={row.category} variant={row.variant} /></TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatNumber(row.total_sheets)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">{formatBDT(row.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatBDT(row.cost)}</TableCell>
                      <TableCell className={`text-right tabular-nums text-sm font-medium ${profitColor(m)}`}>{formatBDT(row.profit)}</TableCell>
                      <TableCell className={`text-right tabular-nums text-sm ${profitColor(m)}`}>{m.toFixed(1)}%</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={key + '-detail'}>
                        <TableCell colSpan={8} className="p-0 bg-muted/30">
                          {detailLoading ? (
                            <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
                          ) : detailRows.length === 0 ? (
                            <div className="py-4 text-center text-sm text-muted-foreground">No order lines found.</div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="pl-10">Date</TableHead>
                                  <TableHead>Customer</TableHead>
                                  <TableHead className="text-right">Qty (Size)</TableHead>
                                  <TableHead className="text-right">Rate</TableHead>
                                  <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {detailRows.map((d, i) => (
                                  <TableRow key={i}>
                                    <TableCell className="text-sm pl-10 whitespace-nowrap">{formatDate(d.order_date)}</TableCell>
                                    <TableCell className="text-sm">
                                      {d.customer_name}
                                      {d.organization && <span className="text-muted-foreground text-xs ml-1">({d.organization})</span>}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums text-sm">
                                      {formatNumber(d.quantity_pieces)}
                                      {d.cut_width_inches && d.cut_height_inches
                                        ? <span className="text-muted-foreground text-xs ml-1">({formatSize(d.cut_width_inches, d.cut_height_inches)})</span>
                                        : null}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums text-sm">{formatBDT(d.selling_price_per_piece_poisha)}</TableCell>
                                    <TableCell className="text-right tabular-nums text-sm font-medium">{formatBDT(d.line_total_poisha)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function itemKey(row: { paper_type_id: string | null; accessory_id: string | null; label: string }): string {
  return `${row.paper_type_id || ''}_${row.accessory_id || ''}_${row.label}`
}

// ── Tab 3: Godown Movement ───────────────────────────────────────────────────

interface GodownRow {
  paper_type_id: string
  accessory_id: string
  label: string
  category: string
  variant: string
  opening_sheets: number
  purchased_sheets: number
  sold_sheets: number
  closing_sheets: number
}

function GodownTab({ start, end }: { start: string; end: string }) {
  const [catFilter, setCatFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  const endNext = useMemo(() => {
    const d = new Date(end + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    return isoDate(d)
  }, [end])

  const GODOWN_SQL = `
    SELECT
      COALESCE(sl.paper_type_id, '') as paper_type_id,
      COALESCE(sl.accessory_id, '') as accessory_id,
      COALESCE(
        CASE WHEN sl.paper_type_id IS NOT NULL THEN
          b.name || CASE WHEN pt.variant != '' THEN CASE WHEN pt.variant LIKE 'CB %' OR pt.variant LIKE 'CFB %' OR pt.variant LIKE 'CF %' THEN ' Carbon Paper' ELSE ' Color Paper' END ELSE '' END || ' ' || g.value || 'gsm ' || MIN(p.width_inches, p.height_inches) || 'x' || MAX(p.width_inches, p.height_inches) || CASE WHEN pt.variant != '' THEN ' ' || pt.variant ELSE '' END
        ELSE at2.name || ' ' || ab.name END,
        'Unknown'
      ) as label,
      COALESCE(pt.category, CASE WHEN sl.accessory_id != '' THEN 'ACCESSORY' ELSE 'PAPER' END) as category,
      COALESCE(pt.variant, '') as variant,
      COALESCE(SUM(CASE WHEN sl.created_at < ? THEN sl.quantity_sheets ELSE 0 END), 0) as opening_sheets,
      COALESCE(SUM(CASE WHEN sl.created_at >= ? AND sl.created_at < ? AND sl.transaction_type = 'PURCHASE' THEN sl.quantity_sheets ELSE 0 END), 0) as purchased_sheets,
      COALESCE(-SUM(CASE WHEN sl.created_at >= ? AND sl.created_at < ? AND sl.transaction_type != 'PURCHASE' THEN sl.quantity_sheets ELSE 0 END), 0) as sold_sheets,
      COALESCE(SUM(CASE WHEN sl.created_at < ? THEN sl.quantity_sheets ELSE 0 END), 0) as closing_sheets
    FROM stock_ledger sl
    LEFT JOIN paper_types pt ON sl.paper_type_id = pt.id
    LEFT JOIN brands b ON pt.brand_id = b.id
    LEFT JOIN gsm_options g ON pt.gsm_id = g.id
    LEFT JOIN proportions p ON pt.proportion_id = p.id
    LEFT JOIN accessories a ON sl.accessory_id = a.id
    LEFT JOIN accessory_types at2 ON a.accessory_type_id = at2.id
    LEFT JOIN brands ab ON a.brand_id = ab.id
    GROUP BY COALESCE(sl.paper_type_id, ''), COALESCE(sl.accessory_id, '')
    HAVING opening_sheets != 0 OR purchased_sheets != 0 OR sold_sheets != 0
    ORDER BY label
  `

  const { data, loading, error } = useQuery<GodownRow>(
    GODOWN_SQL,
    [start, start, endNext, start, endNext, endNext],
    [start, endNext]
  )

  const filtered = useMemo(() =>
    data
      .filter(r => catFilter === 'ALL' || r.category === catFilter)
      .filter(r => !search || r.label.toLowerCase().includes(search.toLowerCase())),
    [data, catFilter, search])

  const status = statusMessage(loading, error, data.length === 0)
  if (status) return status

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 flex-wrap">
        <CategoryFilterTabs value={catFilter} onChange={setCatFilter} />
        <Input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Opening (units)</TableHead>
                <TableHead className="text-right">Opening (sheets)</TableHead>
                <TableHead className="text-right">Purchased</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Sold (sheets)</TableHead>
                <TableHead className="text-right">Closing (units)</TableHead>
                <TableHead className="text-right">Closing (sheets)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No items found.</TableCell></TableRow>
              )}
              {filtered.map(row => {
                const cat = (row.category || 'PAPER') as Category
                const isAcc = cat === 'ACCESSORY'
                const isPacket = !isAcc && isPacketVariant(row.variant)
                const spu = isAcc ? 1 : isPacket ? 1 : sheetsPerUnit(cat)

                const fmtUnits = (sheets: number) => {
                  if (isAcc) return `${formatNumber(sheets)} pcs`
                  if (isPacket) return `${formatNumber(sheets)} pkts`
                  return `${formatNumber(sheets / spu, 1)} ${unitLabelPlural(cat)}`
                }
                const fmtSheets = (sheets: number) => {
                  if (isAcc || isPacket) return <span className="text-muted-foreground">—</span>
                  return formatNumber(sheets)
                }

                return (
                  <TableRow key={`${row.paper_type_id}_${row.accessory_id}`}>
                    <TableCell className="text-sm font-medium">{row.label}</TableCell>
                    <TableCell><CategoryBadge category={row.category} variant={row.variant} /></TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{fmtUnits(row.opening_sheets)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{fmtSheets(row.opening_sheets)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-blue-600">{fmtUnits(row.purchased_sheets)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-orange-600">{fmtUnits(row.sold_sheets)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-orange-600">{fmtSheets(row.sold_sheets)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-semibold">{fmtUnits(row.closing_sheets)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-semibold">{fmtSheets(row.closing_sheets)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Tab 4: Customers ──────────────────────────────────────────────────────────

interface CustomerRow {
  id: string
  name: string
  organization: string | null
  order_count: number
  revenue: number
  profit: number
}

interface CustomerBalanceRow {
  id: string
  balance: number
}

function CustomersTab({ start, end }: { start: string; end: string }) {
  const CUSTOMERS_SQL = `
    SELECT c.id, c.name, c.organization,
      COUNT(DISTINCT o.id) as order_count,
      COALESCE(SUM(ol.line_total_poisha), 0) as revenue,
      COALESCE(SUM(ol.profit_poisha), 0) as profit
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    JOIN customers c ON c.id = o.customer_id
    WHERE o.status != 'VOID' AND o.order_date BETWEEN ? AND ?
    GROUP BY c.id ORDER BY revenue DESC
  `

  const BALANCES_SQL = `
    SELECT c.id,
      COALESCE(c.previous_balance_poisha, 0) +
      COALESCE((SELECT SUM(total_poisha) FROM invoices WHERE customer_id = c.id AND status = 'ACTIVE'), 0) -
      COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE customer_id = c.id), 0) as balance
    FROM customers c
    WHERE c.is_walk_in = 0
  `

  const { data, loading, error } = useQuery<CustomerRow>(CUSTOMERS_SQL, [start, end], [start, end])
  const { data: balanceData } = useQuery<CustomerBalanceRow>(BALANCES_SQL)

  const balanceMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of balanceData) m.set(b.id, b.balance)
    return m
  }, [balanceData])

  const pieData = useMemo(() =>
    data.slice(0, 5).map(r => ({
      name: r.organization || r.name,
      value: poishaToBdt(r.revenue),
    })), [data])

  const status = statusMessage(loading, error, data.length === 0)
  if (status) return status

  return (
    <div className="flex flex-col gap-4">
      {pieData.length > 0 && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top 5 Customers by Revenue</CardTitle>
          </CardHeader>
          <CardContent className="pt-2 pb-2 flex justify-center">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  labelLine={true}
                  fontSize={12}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `৳${formatNumber(v, 2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(row => {
                const balance = balanceMap.get(row.id) ?? 0
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{row.name}</div>
                      {row.organization && (
                        <div className="text-xs text-muted-foreground">{row.organization}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{formatNumber(row.order_count)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">{formatBDT(row.revenue)}</TableCell>
                    <TableCell className={`text-right tabular-nums text-sm font-medium ${profitColor(row.revenue > 0 ? (row.profit * 100) / row.revenue : 0)}`}>
                      {formatBDT(row.profit)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-sm font-semibold ${balance > 0 ? 'text-profit-loss' : balance < 0 ? 'text-profit-good' : ''}`}>
                      {formatBDT(balance)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-lg font-semibold tabular-nums ${className || ''}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

// ── ReportsPage ───────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [mode, setMode] = useState<'week' | 'month'>('week')
  const [date, setDate] = useState(() => new Date())

  const [start, end] = mode === 'week' ? getWeekRange(date) : getMonthRange(date)

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">Reports</h1>
        <PeriodNav mode={mode} setMode={setMode} date={date} setDate={setDate} />
      </div>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="items">Item Breakdown</TabsTrigger>
          <TabsTrigger value="godown">Godown Movement</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <SalesTab start={start} end={end} />
        </TabsContent>

        <TabsContent value="items">
          <ItemBreakdownTab start={start} end={end} />
        </TabsContent>

        <TabsContent value="godown">
          <GodownTab start={start} end={end} />
        </TabsContent>

        <TabsContent value="customers">
          <CustomersTab start={start} end={end} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
