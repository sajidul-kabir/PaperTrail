import { useState, useMemo } from 'react'
import { dbRun } from '@/lib/ipc'
import { useQuery } from '@/hooks/useQuery'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, bdtToPoisha, todayISO } from '@/lib/utils'
import { useNavigate, useParams, Link } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomerDetail {
  id: string
  name: string
  organization: string | null
  phone: string | null
  address: string | null
  previous_balance_poisha: number
  balance_poisha: number
}

interface InvoiceRow {
  id: string
  invoice_number: string
  invoice_date: string
  total_poisha: number
  status: 'ACTIVE' | 'VOID'
}

interface PaymentRow {
  id: string
  payment_date: string
  amount_poisha: number
  payment_method: string
  notes: string | null
}

// History: a day where the customer had invoices and/or payments
interface HistoryBilledRow {
  the_date: string
  billed: number
}
interface HistoryPaidRow {
  the_date: string
  paid: number
}

type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'OTHER'

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  CHECK: 'Check',
  OTHER: 'Other',
}

// ---------------------------------------------------------------------------
// CustomerDetailPage
// ---------------------------------------------------------------------------

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()

  // Customer header data
  const {
    data: customerRows,
    loading: customerLoading,
    refetch: refetchCustomer,
  } = useQuery<CustomerDetail>(
    `SELECT c.*,
       COALESCE(c.previous_balance_poisha, 0) +
       COALESCE((SELECT SUM(total_poisha) FROM invoices WHERE customer_id = c.id AND status = 'ACTIVE'), 0) -
       COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE customer_id = c.id), 0) as balance_poisha
     FROM customers c
     WHERE c.id = ?`,
    [id],
    [id]
  )

  // Invoices tab
  const {
    data: invoices,
    loading: invoicesLoading,
  } = useQuery<InvoiceRow>(
    `SELECT id, invoice_number, invoice_date, total_poisha, status
     FROM invoices
     WHERE customer_id = ?
     ORDER BY invoice_date DESC, created_at DESC`,
    [id],
    [id]
  )

  // Payments tab
  const {
    data: payments,
    loading: paymentsLoading,
    refetch: refetchPayments,
  } = useQuery<PaymentRow>(
    `SELECT id, payment_date, amount_poisha, payment_method, notes
     FROM payments
     WHERE customer_id = ?
     ORDER BY payment_date DESC, created_at DESC`,
    [id],
    [id]
  )

  // History tab: daily billed amounts
  const { data: historyBilled, loading: historyBilledLoading } = useQuery<HistoryBilledRow>(
    `SELECT i.invoice_date as the_date, SUM(i.total_poisha) as billed
     FROM invoices i
     WHERE i.customer_id = ? AND i.status = 'ACTIVE'
     GROUP BY i.invoice_date`,
    [id], [id]
  )

  // History tab: daily paid amounts
  const { data: historyPaid, loading: historyPaidLoading } = useQuery<HistoryPaidRow>(
    `SELECT p.payment_date as the_date, SUM(p.amount_poisha) as paid
     FROM payments p
     WHERE p.customer_id = ?
     GROUP BY p.payment_date`,
    [id], [id]
  )

  // All-time totals for the summary card
  const allTimeBilled = useMemo(() => invoices.reduce((s, i) => s + (i.status === 'ACTIVE' ? i.total_poisha : 0), 0), [invoices])
  const allTimePaid = useMemo(() => payments.reduce((s, p) => s + p.amount_poisha, 0), [payments])

  // Merge billed + paid into a single day-by-day history sorted DESC, with running balance
  const historyRows = useMemo(() => {
    const customer = customerRows[0]
    if (!customer) return []

    const dayMap = new Map<string, { billed: number; paid: number }>()
    for (const r of historyBilled) {
      const e = dayMap.get(r.the_date) ?? { billed: 0, paid: 0 }
      e.billed += r.billed
      dayMap.set(r.the_date, e)
    }
    for (const r of historyPaid) {
      const e = dayMap.get(r.the_date) ?? { billed: 0, paid: 0 }
      e.paid += r.paid
      dayMap.set(r.the_date, e)
    }

    // Sort ascending by date for running balance calculation
    const sorted = Array.from(dayMap.entries())
      .map(([date, v]) => ({ date, billed: v.billed, paid: v.paid }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Running balance: start from previous_balance, add billed, subtract paid
    let running = customer.previous_balance_poisha ?? 0
    const rows = sorted.map(r => {
      running += r.billed - r.paid
      return { ...r, balance: running }
    })

    // Return descending (latest first)
    return rows.reverse()
  }, [customerRows, historyBilled, historyPaid])

  const historyLoading = historyBilledLoading || historyPaidLoading

  // Payment dialog state
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [payForm, setPayForm] = useState({
    amount: '',
    date: todayISO(),
    method: 'CASH' as PaymentMethod,
    notes: '',
  })

  function resetPayForm() {
    setPayForm({ amount: '', date: todayISO(), method: 'CASH', notes: '' })
  }

  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amountBDT = parseFloat(payForm.amount)
    if (!payForm.amount || isNaN(amountBDT) || amountBDT <= 0) {
      addToast({ title: 'Enter a valid amount', variant: 'destructive' })
      return
    }
    if (!payForm.date) {
      addToast({ title: 'Date is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await dbRun(
        `INSERT INTO payments (id, customer_id, amount_poisha, payment_date, payment_method, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          id,
          bdtToPoisha(amountBDT),
          payForm.date,
          payForm.method,
          payForm.notes.trim() || null,
        ]
      )
      addToast({ title: 'Payment recorded', description: `${formatBDT(bdtToPoisha(amountBDT))} on ${formatDate(payForm.date)}` })
      setPayDialogOpen(false)
      resetPayForm()
      refetchPayments()
      refetchCustomer()
    } catch (err: any) {
      addToast({ title: 'Failed to record payment', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (customerLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const customer = customerRows[0]

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <p className="text-sm text-muted-foreground">Customer not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/customers')}>
          Back to Customers
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/customers" className="hover:text-foreground transition-colors">
          Customers
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{customer.name}</span>
      </div>

      {/* Customer header card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <CardTitle className="text-xl">{customer.name}</CardTitle>
              {customer.organization && (
                <p className="text-sm text-muted-foreground">{customer.organization}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Outstanding Balance
              </span>
              <span
                className={`text-xl font-bold tabular-nums ${
                  customer.balance_poisha > 0
                    ? 'text-profit-loss'
                    : customer.balance_poisha < 0
                    ? 'text-profit-good'
                    : 'text-muted-foreground'
                }`}
              >
                {customer.balance_poisha === 0
                  ? '৳0.00'
                  : formatBDT(Math.abs(customer.balance_poisha))}
              </span>
              {customer.balance_poisha < 0 && (
                <span className="text-xs text-profit-good">(overpaid)</span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {customer.phone && (
              <div className="flex gap-1.5">
                <span className="text-muted-foreground">Phone:</span>
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.address && (
              <div className="flex gap-1.5">
                <span className="text-muted-foreground">Address:</span>
                <span>{customer.address}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Total Transactions card */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-3 pb-2">
            <div className="text-[10px] text-muted-foreground uppercase">All-Time Billed</div>
            <div className="text-lg font-bold tabular-nums">{formatBDT(allTimeBilled)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <div className="text-[10px] text-muted-foreground uppercase">All-Time Paid</div>
            <div className="text-lg font-bold tabular-nums">{formatBDT(allTimePaid)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <div className="text-[10px] text-muted-foreground uppercase">Previous Balance</div>
            <div className="text-lg font-bold tabular-nums text-muted-foreground">
              {customer.previous_balance_poisha ? formatBDT(customer.previous_balance_poisha) : '৳0.00'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: History / Orders / Payments */}
      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="invoices">Orders</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------------ */}
        {/* History tab (Tally Khata)                                           */}
        {/* ------------------------------------------------------------------ */}
        <TabsContent value="history" className="mt-3">
          <Card>
            <CardContent className="p-0">
              {historyLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  Loading…
                </div>
              ) : historyRows.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  No transaction history yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyRows.map(row => (
                      <TableRow key={row.date}>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(row.date)}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {row.billed > 0 ? formatBDT(row.billed) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-profit-good">
                          {row.paid > 0 ? formatBDT(row.paid) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums text-sm font-semibold ${
                          row.balance > 0 ? 'text-profit-loss' : row.balance < 0 ? 'text-profit-good' : ''
                        }`}>
                          {formatBDT(Math.abs(row.balance))}
                          {row.balance < 0 && <span className="text-xs font-normal ml-0.5">(cr)</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Show previous balance as starting row if non-zero */}
                    {(customer.previous_balance_poisha ?? 0) !== 0 && (
                      <TableRow className="border-t-2">
                        <TableCell className="text-sm text-muted-foreground italic">Opening Balance</TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell className={`text-right tabular-nums text-sm font-semibold ${
                          customer.previous_balance_poisha > 0 ? 'text-profit-loss' : 'text-profit-good'
                        }`}>
                          {formatBDT(Math.abs(customer.previous_balance_poisha))}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------------ */}
        {/* Invoices tab                                                        */}
        {/* ------------------------------------------------------------------ */}
        <TabsContent value="invoices" className="mt-3">
          <Card>
            <CardContent className="p-0">
              {invoicesLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  Loading…
                </div>
              ) : invoices.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  No orders for this customer.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/bills/${inv.id}`)}
                      >
                        <TableCell className="font-mono text-xs font-medium">
                          {inv.invoice_number}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(inv.invoice_date)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums text-sm ${
                            inv.status === 'VOID' ? 'text-muted-foreground line-through' : ''
                          }`}
                        >
                          {formatBDT(inv.total_poisha)}
                        </TableCell>
                        <TableCell>
                          {inv.status === 'VOID' ? (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              VOID
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              Active
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------------ */}
        {/* Payments tab                                                        */}
        {/* ------------------------------------------------------------------ */}
        <TabsContent value="payments" className="mt-3">
          <div className="flex flex-col gap-3">
            {/* Record Payment button */}
            <div className="flex justify-end">
              <Dialog
                open={payDialogOpen}
                onOpenChange={(v) => {
                  setPayDialogOpen(v)
                  if (!v) resetPayForm()
                }}
              >
                <DialogTrigger asChild>
                  <Button size="sm">Record Payment</Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Record Payment</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handlePaymentSubmit} className="flex flex-col gap-3 pt-1">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="pay-amount">Amount (BDT) *</Label>
                      <Input
                        id="pay-amount"
                        name="amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={payForm.amount}
                        onChange={(e) => setPayForm(prev => ({ ...prev, amount: e.target.value }))}
                        placeholder="0.00"
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="pay-date">Date *</Label>
                      <Input
                        id="pay-date"
                        name="date"
                        type="date"
                        value={payForm.date}
                        onChange={(e) => setPayForm(prev => ({ ...prev, date: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="pay-method">Method</Label>
                      <Select
                        value={payForm.method}
                        onValueChange={(v) => setPayForm(prev => ({ ...prev, method: v as PaymentMethod }))}
                      >
                        <SelectTrigger id="pay-method">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                            <SelectItem key={m} value={m}>
                              {METHOD_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="pay-notes">Notes</Label>
                      <Input
                        id="pay-notes"
                        name="notes"
                        value={payForm.notes}
                        onChange={(e) => setPayForm(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Optional reference or memo"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <DialogClose asChild>
                        <Button type="button" variant="outline" size="sm" disabled={saving}>
                          Cancel
                        </Button>
                      </DialogClose>
                      <Button type="submit" size="sm" disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {/* Payments table */}
            <Card>
              <CardContent className="p-0">
                {paymentsLoading ? (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                    Loading…
                  </div>
                ) : payments.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                    No payments recorded yet.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(p.payment_date)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium">
                            {formatBDT(p.amount_poisha)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {METHOD_LABELS[p.payment_method as PaymentMethod] ?? p.payment_method}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {p.notes ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
