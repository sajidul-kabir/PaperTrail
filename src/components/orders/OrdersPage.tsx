import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@/hooks/useQuery'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import * as Popover from '@radix-ui/react-popover'
import { formatBDT, formatDate, todayISO, profitColor } from '@/lib/utils'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

interface OrderRow {
  id: string
  order_date: string
  customer_name: string
  customer_organization: string | null
  status: 'PENDING' | 'BILLED' | 'VOID'
  total_poisha: number
  total_profit: number
  line_count: number
}

interface CustomerOption { id: string; name: string; organization: string | null }

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dateToISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isoToDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const ORDERS_SQL = `
  SELECT o.id, o.order_date,
    c.name as customer_name,
    c.organization as customer_organization,
    o.status,
    COALESCE(SUM(ol.line_total_poisha), 0) as total_poisha,
    COALESCE(SUM(ol.profit_poisha), 0) as total_profit,
    COUNT(ol.id) as line_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_lines ol ON ol.order_id = o.id
  WHERE o.order_date = ?
  GROUP BY o.id
  ORDER BY o.created_at DESC
`

const SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN o.status != 'VOID' THEN ol.line_total_poisha ELSE 0 END), 0) as day_total,
    COALESCE(SUM(CASE WHEN o.status != 'VOID' THEN ol.profit_poisha ELSE 0 END), 0) as day_profit,
    COUNT(DISTINCT CASE WHEN o.status != 'VOID' THEN o.id END) as day_count
  FROM orders o
  LEFT JOIN order_lines ol ON ol.order_id = o.id
  WHERE o.order_date = ?
`

export function OrdersPage() {
  const navigate = useNavigate()
  const today = todayISO()
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [customerFilter, setCustomerFilter] = useState('')

  const { data: orders, loading } = useQuery<OrderRow>(ORDERS_SQL, [selectedDate], [selectedDate])
  const { data: summaryRows } = useQuery<{ day_total: number; day_profit: number; day_count: number }>(SUMMARY_SQL, [selectedDate], [selectedDate])
  const summary = summaryRows[0] ?? { day_total: 0, day_profit: 0, day_count: 0 }

  const filtered = orders.filter(o => {
    const display = o.customer_organization || o.customer_name
    return display.toLowerCase().includes(customerFilter.toLowerCase())
  })

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Orders</h1>
        <Button asChild size="sm"><Link to="/orders/new">+ New Order</Link></Button>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Popover.Root open={calendarOpen} onOpenChange={setCalendarOpen}>
            <Popover.Trigger asChild>
              <Button variant="outline" className="h-8 gap-2 px-3 text-sm font-medium">
                <CalendarDays className="h-4 w-4" />{formatDate(selectedDate)}
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="z-50 rounded-lg border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95" sideOffset={4} align="center">
                <Calendar selected={isoToDate(selectedDate)} onSelect={(d) => { setSelectedDate(dateToISO(d)); setCalendarOpen(false) }} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}><ChevronRight className="h-4 w-4" /></Button>
          {selectedDate !== today && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedDate(today)}>Today</Button>
          )}
        </div>
        <Input placeholder="Filter by customer..." value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} className="max-w-xs h-8" />
      </div>

      {/* Day summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[10px] text-muted-foreground uppercase">Orders</div>
          <div className="text-xl font-bold tabular-nums">{summary.day_count}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[10px] text-muted-foreground uppercase">Sales</div>
          <div className="text-xl font-bold tabular-nums">{formatBDT(summary.day_total)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[10px] text-muted-foreground uppercase">Profit</div>
          <div className={`text-xl font-bold tabular-nums ${profitColor(summary.day_total > 0 ? (summary.day_profit / summary.day_total) * 100 : 0)}`}>{formatBDT(summary.day_profit)}</div>
        </CardContent></Card>
      </div>

      {/* Orders table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              No orders for {formatDate(selectedDate)}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o, i) => {
                  const isVoid = o.status === 'VOID'
                  const margin = o.total_poisha > 0 ? (o.total_profit / o.total_poisha) * 100 : 0
                  return (
                    <TableRow key={o.id} className="cursor-pointer" tabIndex={0} onClick={() => navigate(`/orders/${o.id}`)} onKeyDown={e => e.key === 'Enter' && navigate(`/orders/${o.id}`)}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">{o.customer_organization || o.customer_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(o.order_date)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{o.line_count}</TableCell>
                      <TableCell className={`text-right tabular-nums text-sm ${isVoid ? 'text-muted-foreground line-through' : ''}`}>{formatBDT(o.total_poisha)}</TableCell>
                      <TableCell className={`text-right tabular-nums text-sm ${isVoid ? 'text-muted-foreground line-through' : profitColor(margin)}`}>{formatBDT(o.total_profit)}</TableCell>
                      <TableCell>
                        <Badge variant={o.status === 'PENDING' ? 'secondary' : o.status === 'BILLED' ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">{o.status}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
