import { useState } from 'react'
import { useQuery } from '@/hooks/useQuery'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatBDT, formatDate, profitColor, formatNumber } from '@/lib/utils'

// ── Sales Report ─────────────────────────────────────────────────────────────

interface SalesReportRow {
  invoice_date: string
  invoice_count: number
  total_sales: number
  total_profit: number
}

const SALES_REPORT_SQL = `
SELECT
  i.invoice_date,
  COUNT(DISTINCT i.id) as invoice_count,
  SUM(i.total_poisha) as total_sales,
  SUM(il.profit_poisha) as total_profit
FROM invoices i
LEFT JOIN invoice_lines il ON il.invoice_id = i.id
WHERE i.status = 'ACTIVE' AND i.invoice_date >= date('now', '-30 days')
GROUP BY i.invoice_date
ORDER BY i.invoice_date DESC
`

function SalesReportTab() {
  const [filter, setFilter] = useState('')
  const { data, loading, error } = useQuery<SalesReportRow>(SALES_REPORT_SQL, [], [])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Sales Report — Last 30 Days</CardTitle>
        <Input
          placeholder="Search by date..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="max-w-xs mt-2"
        />
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center py-10 text-sm text-destructive">{error}</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">No sales data for the last 30 days.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Total Sales (BDT)</TableHead>
                <TableHead className="text-right">Total Profit (BDT)</TableHead>
                <TableHead className="text-right">Avg Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.filter(row => row.invoice_date.toLowerCase().includes(filter.toLowerCase())).map((row) => {
                const margin =
                  row.total_sales > 0
                    ? (row.total_profit * 100) / row.total_sales
                    : 0
                return (
                  <TableRow key={row.invoice_date}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(row.invoice_date)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatNumber(row.invoice_count)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatBDT(row.total_sales)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-sm font-medium ${profitColor(margin)}`}>
                      {formatBDT(row.total_profit)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-sm ${profitColor(margin)}`}>
                      {margin.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Profit by Paper Type ──────────────────────────────────────────────────────

interface ProfitByPaperRow {
  paper_type_label: string
  revenue: number
  cost: number
  profit: number
  avg_margin: number
}

const PROFIT_BY_PAPER_SQL = `
SELECT
  b.name || CASE WHEN pt.variant != '' THEN CASE WHEN pt.variant LIKE 'CB %' OR pt.variant LIKE 'CFB %' OR pt.variant LIKE 'CF %' THEN ' Carbon Paper' ELSE ' Color Paper' END ELSE '' END || ' ' || g.value || 'gsm ' || MIN(p.width_inches, p.height_inches) || 'x' || MAX(p.width_inches, p.height_inches) || CASE WHEN pt.variant != '' THEN ' ' || pt.variant ELSE '' END as paper_type_label,
  SUM(il.line_total_poisha) as revenue,
  SUM(il.cost_total_poisha) as cost,
  SUM(il.profit_poisha) as profit,
  CASE WHEN SUM(il.line_total_poisha) > 0
    THEN SUM(il.profit_poisha) * 100.0 / SUM(il.line_total_poisha)
    ELSE 0 END as avg_margin
FROM invoice_lines il
JOIN invoices i ON il.invoice_id = i.id AND i.status = 'ACTIVE'
JOIN paper_types pt ON il.paper_type_id = pt.id
JOIN brands b ON pt.brand_id = b.id
JOIN gsm_options g ON pt.gsm_id = g.id
JOIN proportions p ON pt.proportion_id = p.id
GROUP BY il.paper_type_id
ORDER BY profit DESC
`

function ProfitByPaperTab() {
  const [filter, setFilter] = useState('')
  const { data, loading, error } = useQuery<ProfitByPaperRow>(PROFIT_BY_PAPER_SQL, [], [])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Profit by Paper Type</CardTitle>
        <Input
          placeholder="Search by paper type..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="max-w-xs mt-2"
        />
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center py-10 text-sm text-destructive">{error}</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">No data available.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paper Type</TableHead>
                <TableHead className="text-right">Revenue (BDT)</TableHead>
                <TableHead className="text-right">Cost (BDT)</TableHead>
                <TableHead className="text-right">Profit (BDT)</TableHead>
                <TableHead className="text-right">Avg Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.filter(row => row.paper_type_label.toLowerCase().includes(filter.toLowerCase())).map((row) => (
                <TableRow key={row.paper_type_label}>
                  <TableCell className="text-sm">{row.paper_type_label}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatBDT(row.revenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {formatBDT(row.cost)}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums text-sm font-medium ${profitColor(row.avg_margin)}`}>
                    {formatBDT(row.profit)}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums text-sm ${profitColor(row.avg_margin)}`}>
                    {row.avg_margin.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Customer Balances ─────────────────────────────────────────────────────────

interface CustomerBalanceRow {
  name: string
  organization: string | null
  phone: string | null
  total_invoiced: number
  total_paid: number
  balance: number
}

const CUSTOMER_BALANCES_SQL = `
SELECT c.name, c.organization, c.phone,
  COALESCE((SELECT SUM(total_poisha) FROM invoices WHERE customer_id = c.id AND status = 'ACTIVE'), 0) as total_invoiced,
  COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE customer_id = c.id), 0) as total_paid,
  COALESCE((SELECT SUM(total_poisha) FROM invoices WHERE customer_id = c.id AND status = 'ACTIVE'), 0) -
  COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE customer_id = c.id), 0) as balance
FROM customers c
WHERE c.is_walk_in = 0 AND (
  COALESCE((SELECT SUM(total_poisha) FROM invoices WHERE customer_id = c.id AND status = 'ACTIVE'), 0) -
  COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE customer_id = c.id), 0)
) != 0
ORDER BY balance DESC
`

function CustomerBalancesTab() {
  const [filter, setFilter] = useState('')
  const { data, loading, error } = useQuery<CustomerBalanceRow>(CUSTOMER_BALANCES_SQL, [], [])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Customer Balances</CardTitle>
        <Input
          placeholder="Search by customer..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="max-w-xs mt-2"
        />
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center py-10 text-sm text-destructive">{error}</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">No outstanding balances.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Total Ordered (BDT)</TableHead>
                <TableHead className="text-right">Total Paid (BDT)</TableHead>
                <TableHead className="text-right">Outstanding (BDT)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.filter(row => `${row.name} ${row.organization ?? ''} ${row.phone ?? ''}`.toLowerCase().includes(filter.toLowerCase())).map((row) => (
                <TableRow key={row.name + (row.phone ?? '')}>
                  <TableCell>
                    <div className="text-sm font-medium">{row.name}</div>
                    {row.organization && (
                      <div className="text-xs text-muted-foreground">{row.organization}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {row.phone ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatBDT(row.total_invoiced)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatBDT(row.total_paid)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums text-sm font-semibold ${
                      row.balance > 0 ? 'text-profit-loss' : 'text-profit-good'
                    }`}
                  >
                    {formatBDT(row.balance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── ReportsPage ───────────────────────────────────────────────────────────────

export function ReportsPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Reports</h1>
      </div>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales Report</TabsTrigger>
          <TabsTrigger value="paper">Profit by Paper Type</TabsTrigger>
          <TabsTrigger value="balances">Customer Balances</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <SalesReportTab />
        </TabsContent>

        <TabsContent value="paper">
          <ProfitByPaperTab />
        </TabsContent>

        <TabsContent value="balances">
          <CustomerBalancesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
