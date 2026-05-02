import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@/hooks/useQuery'
import { dbQuery } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Calendar } from '@/components/ui/calendar'
import * as Popover from '@radix-ui/react-popover'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, todayISO, profitColor } from '@/lib/utils'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dateToISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isoToDate(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

interface CustomerWithOrders {
  customer_id: string; customer_name: string; customer_organization: string | null
  order_count: number; total_poisha: number; total_profit: number
}

interface BillRow {
  id: string; invoice_number: string; invoice_date: string
  customer_name: string; customer_organization: string | null
  total_poisha: number; total_profit: number; status: 'ACTIVE' | 'VOID'
}

const PENDING_CUSTOMERS_SQL = `
  SELECT o.customer_id, c.name as customer_name, c.organization as customer_organization,
    COUNT(DISTINCT o.id) as order_count,
    COALESCE(SUM(ol.line_total_poisha), 0) as total_poisha,
    COALESCE(SUM(ol.profit_poisha), 0) as total_profit
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_lines ol ON ol.order_id = o.id
  WHERE o.order_date = ? AND o.status = 'PENDING'
  GROUP BY o.customer_id
  ORDER BY customer_organization, customer_name
`

const BILLS_SQL = `
  SELECT i.id, i.invoice_number, i.invoice_date,
    c.name as customer_name, c.organization as customer_organization,
    i.total_poisha,
    COALESCE(SUM(il.profit_poisha), 0) as total_profit,
    i.status
  FROM invoices i
  JOIN customers c ON c.id = i.customer_id
  LEFT JOIN invoice_lines il ON il.invoice_id = i.id
  WHERE i.invoice_date = ?
  GROUP BY i.id
  ORDER BY i.created_at DESC
`

export function BillsPage() {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const today = todayISO()
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  const { data: pendingCustomers } = useQuery<CustomerWithOrders>(PENDING_CUSTOMERS_SQL, [selectedDate], [selectedDate])
  const { data: bills } = useQuery<BillRow>(BILLS_SQL, [selectedDate], [selectedDate])

  async function handleGenerateBill(customer: CustomerWithOrders) {
    setLoading(customer.customer_id)
    try {
      const orderRows = await dbQuery<{ id: string }>(
        `SELECT id FROM orders WHERE customer_id = ? AND order_date = ? AND status = 'PENDING'`,
        [customer.customer_id, selectedDate]
      )
      if (orderRows.length === 0) { addToast({ title: 'No pending orders' }); return }

      const orderIds = orderRows.map(r => r.id)
      const placeholders = orderIds.map(() => '?').join(',')
      const orderLines = await dbQuery<{
        id: string; paper_type_id: string | null; accessory_id: string | null
        cut_width_inches: number | null; cut_height_inches: number | null
        quantity_pieces: number; selling_price_per_piece_poisha: number
        line_total_poisha: number; cost_per_piece_poisha: number
        cost_total_poisha: number; profit_poisha: number; profit_margin_pct: number
        label: string | null
      }>(
        `SELECT id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, selling_price_per_piece_poisha, line_total_poisha, cost_per_piece_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, label
         FROM order_lines WHERE order_id IN (${placeholders})`,
        orderIds
      )

      // Fetch outstanding balance
      const balanceRows = await dbQuery<{ outstanding: number }>(
        `SELECT
          COALESCE(c.previous_balance_poisha, 0) +
          COALESCE((SELECT SUM(total_poisha) FROM invoices WHERE customer_id = c.id AND status = 'ACTIVE'), 0) -
          COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE customer_id = c.id), 0) as outstanding
        FROM customers c WHERE c.id = ?`,
        [customer.customer_id]
      )
      const outstanding = balanceRows[0]?.outstanding ?? 0

      // Store memo data in sessionStorage
      sessionStorage.setItem('memoData', JSON.stringify({
        customer_id: customer.customer_id,
        customer_name: customer.customer_name,
        customer_organization: customer.customer_organization,
        bill_date: selectedDate,
        order_ids: orderIds,
        lines: orderLines,
        outstanding_poisha: outstanding,
      }))

      navigate('/bills/memo')
    } catch (err: any) {
      addToast({ title: 'Failed', description: err.message, variant: 'destructive' })
    } finally { setLoading(null) }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Bills</h1>
      </div>

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
        {selectedDate !== today && <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedDate(today)}>Today</Button>}
      </div>

      {pendingCustomers.length > 0 ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Unbilled Orders</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingCustomers.map(c => {
                  const margin = c.total_poisha > 0 ? (c.total_profit / c.total_poisha) * 100 : 0
                  const isLoading = loading === c.customer_id
                  return (
                    <TableRow key={c.customer_id}>
                      <TableCell className="font-medium">{c.customer_organization || c.customer_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.order_count}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatBDT(c.total_poisha)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${profitColor(margin)}`}>{formatBDT(c.total_profit)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="default" className="h-7 text-xs" disabled={!!loading}
                          onClick={() => handleGenerateBill(c)}>
                          {isLoading ? 'Loading...' : 'Generate Bill'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
          No unbilled orders for {formatDate(selectedDate)}.
        </div>
      )}

      {bills.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Generated Bills</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map(b => {
                  const margin = b.total_poisha > 0 ? (b.total_profit / b.total_poisha) * 100 : 0
                  const isVoid = b.status === 'VOID'
                  return (
                    <TableRow key={b.id} className="cursor-pointer" tabIndex={0} onClick={() => navigate(`/bills/${b.id}`)} onKeyDown={e => e.key === 'Enter' && navigate(`/bills/${b.id}`)}>
                      <TableCell className="font-mono text-xs font-medium">{b.invoice_number}</TableCell>
                      <TableCell className="font-medium">{b.customer_organization || b.customer_name}</TableCell>
                      <TableCell className={`text-right tabular-nums ${isVoid ? 'line-through text-muted-foreground' : ''}`}>{formatBDT(b.total_poisha)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${isVoid ? 'text-muted-foreground' : profitColor(margin)}`}>{formatBDT(b.total_profit)}</TableCell>
                      <TableCell>
                        <Badge variant={isVoid ? 'destructive' : 'secondary'} className="text-[10px] px-1.5 py-0">{b.status}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
