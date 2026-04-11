import { useState } from 'react'
import { useQuery } from '@/hooks/useQuery'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import * as Popover from '@radix-ui/react-popover'
import { formatBDT, formatDate, profitColor, todayISO } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

interface DaySummaryRow {
  day_sales_poisha: number
  day_profit_poisha: number
  day_avg_margin: number
  day_invoice_count: number
}

interface DayInvoiceRow {
  id: string
  invoice_number: string
  invoice_date: string
  customer_name: string
  total_poisha: number
  profit_poisha: number
  avg_margin_pct: number
  status: 'ACTIVE' | 'VOID'
}

interface LowStockRow {
  paper_type_id: string
  paper_type_label: string
  total_reams: number
  threshold_reams: number
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateToISO(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isoToDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function DashboardPage() {
  const navigate = useNavigate()
  const today = todayISO()
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendarOpen, setCalendarOpen] = useState(false)

  const isToday = selectedDate === today

  const { data: summaryRows, loading: summaryLoading } = useQuery<DaySummaryRow>(
    `SELECT
       COALESCE(SUM(CASE WHEN i.status = 'ACTIVE' THEN i.total_poisha ELSE 0 END), 0) AS day_sales_poisha,
       COALESCE(SUM(CASE WHEN i.status = 'ACTIVE' THEN il_agg.profit_poisha ELSE 0 END), 0) AS day_profit_poisha,
       COALESCE(AVG(CASE WHEN i.status = 'ACTIVE' THEN il_agg.avg_margin_pct END), 0) AS day_avg_margin,
       COUNT(CASE WHEN i.status = 'ACTIVE' THEN 1 END) AS day_invoice_count
     FROM invoices i
     LEFT JOIN (
       SELECT invoice_id,
              SUM(profit_poisha) AS profit_poisha,
              AVG(profit_margin_pct) AS avg_margin_pct
       FROM invoice_lines
       GROUP BY invoice_id
     ) il_agg ON il_agg.invoice_id = i.id
     WHERE i.invoice_date = ?`,
    [selectedDate],
    [selectedDate]
  )

  const { data: dayInvoices, loading: invoicesLoading } = useQuery<DayInvoiceRow>(
    `SELECT
       i.id,
       i.invoice_number,
       i.invoice_date,
       c.name AS customer_name,
       i.total_poisha,
       COALESCE(il_agg.profit_poisha, 0) AS profit_poisha,
       COALESCE(il_agg.avg_margin_pct, 0) AS avg_margin_pct,
       i.status
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN (
       SELECT invoice_id,
              SUM(profit_poisha) AS profit_poisha,
              AVG(profit_margin_pct) AS avg_margin_pct
       FROM invoice_lines
       GROUP BY invoice_id
     ) il_agg ON il_agg.invoice_id = i.id
     WHERE i.invoice_date = ?
     ORDER BY i.created_at DESC`,
    [selectedDate],
    [selectedDate]
  )

  const { data: lowStockRows, loading: stockLoading } = useQuery<LowStockRow>(
    `WITH threshold AS (
       SELECT COALESCE(CAST(value AS REAL), 10) AS threshold_reams
       FROM settings WHERE key = 'low_stock_threshold_reams'
       UNION ALL SELECT 10 LIMIT 1
     ),
     stock AS (
       SELECT
         sl.paper_type_id,
         (b.name || ' ' || g.value || 'gsm ' || MIN(p.width_inches, p.height_inches) || 'x' || MAX(p.width_inches, p.height_inches)) AS paper_type_label,
         ROUND(SUM(sl.quantity_sheets) / 500.0, 2) AS total_reams
       FROM stock_ledger sl
       JOIN paper_types pt ON pt.id = sl.paper_type_id
       JOIN brands b ON b.id = pt.brand_id
       JOIN gsm_options g ON g.id = pt.gsm_id
       JOIN proportions p ON p.id = pt.proportion_id
       GROUP BY sl.paper_type_id
     )
     SELECT s.paper_type_id, s.paper_type_label, s.total_reams, t.threshold_reams
     FROM stock s, threshold t
     WHERE s.total_reams < t.threshold_reams
     ORDER BY s.total_reams ASC`,
    [],
    []
  )

  const summary = summaryRows[0] ?? {
    day_sales_poisha: 0,
    day_profit_poisha: 0,
    day_avg_margin: 0,
    day_invoice_count: 0,
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Page header with date navigation */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
            title="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover.Root open={calendarOpen} onOpenChange={setCalendarOpen}>
            <Popover.Trigger asChild>
              <Button variant="outline" className="h-8 gap-2 px-3 text-sm font-medium">
                <CalendarDays className="h-4 w-4" />
                {formatDate(selectedDate)}
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="z-50 rounded-lg border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
                sideOffset={4}
                align="center"
              >
                <Calendar
                  selected={isoToDate(selectedDate)}
                  maxDate={isoToDate(today)}
                  onSelect={(d) => {
                    setSelectedDate(dateToISO(d))
                    setCalendarOpen(false)
                  }}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
            disabled={selectedDate >= today}
            title="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setSelectedDate(today)}
            >
              Today
            </Button>
          )}
        </div>
      </div>

      {/* Day label */}
      <div className="text-sm text-muted-foreground">
        {isToday ? "Today's Summary" : `Summary for ${formatDate(selectedDate)}`}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Sales</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="h-7 w-24 animate-pulse rounded bg-muted" />
            ) : (
              <p className="text-xl font-bold tabular-nums">{formatBDT(summary.day_sales_poisha)}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Profit</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="h-7 w-24 animate-pulse rounded bg-muted" />
            ) : (
              <p className={`text-xl font-bold tabular-nums ${profitColor(summary.day_avg_margin)}`}>
                {formatBDT(summary.day_profit_poisha)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Avg Margin</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="h-7 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <p className={`text-xl font-bold tabular-nums ${profitColor(summary.day_avg_margin)}`}>
                {summary.day_avg_margin.toFixed(1)}%
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="h-7 w-10 animate-pulse rounded bg-muted" />
            ) : (
              <p className="text-xl font-bold tabular-nums">{summary.day_invoice_count}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Day's invoices table */}
        <div className="xl:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>{isToday ? "Today's Orders" : `Orders on ${formatDate(selectedDate)}`}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {invoicesLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading...</div>
              ) : dayInvoices.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  No orders on this date.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dayInvoices.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/bills/${inv.id}`)}
                      >
                        <TableCell className="font-mono text-xs font-medium">{inv.invoice_number}</TableCell>
                        <TableCell className="max-w-[160px] truncate text-sm">{inv.customer_name}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{formatBDT(inv.total_poisha)}</TableCell>
                        <TableCell className={`text-right tabular-nums text-sm ${inv.status === 'VOID' ? 'text-muted-foreground line-through' : profitColor(inv.avg_margin_pct)}`}>
                          {formatBDT(inv.profit_poisha)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums text-sm ${inv.status === 'VOID' ? 'text-muted-foreground' : profitColor(inv.avg_margin_pct)}`}>
                          {inv.status === 'VOID' ? '—' : `${inv.avg_margin_pct.toFixed(1)}%`}
                        </TableCell>
                        <TableCell>
                          {inv.status === 'VOID' ? (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">VOID</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Active</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Low stock alerts */}
        <div className="xl:col-span-1">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Low Stock Alerts</CardTitle>
                {!stockLoading && lowStockRows.length > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                    {lowStockRows.length}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {stockLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading...</div>
              ) : lowStockRows.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">All stock levels OK.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paper Type</TableHead>
                      <TableHead className="text-right">Reams</TableHead>
                      <TableHead className="text-right">Min</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStockRows.map((row) => (
                      <TableRow
                        key={row.paper_type_id}
                        className="cursor-pointer"
                        onClick={() => navigate('/godown')}
                      >
                        <TableCell className="text-xs leading-tight">{row.paper_type_label}</TableCell>
                        <TableCell className={`text-right tabular-nums text-sm font-semibold ${row.total_reams <= 0 ? 'text-profit-loss' : 'text-profit-thin'}`}>
                          {row.total_reams <= 0 ? 'Out' : row.total_reams.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {row.threshold_reams}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
