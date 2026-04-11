import { useState } from 'react'
import { dbQuery, dbRun } from '@/lib/ipc'
import { useQuery } from '@/hooks/useQuery'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, bdtToPoisha, todayISO } from '@/lib/utils'

interface PaymentRow {
  id: string
  customer_id: string
  customer_name: string
  amount_poisha: number
  payment_date: string
  payment_method: 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'OTHER'
  notes: string | null
  created_at: string
}

interface CustomerRow {
  id: string
  name: string
}

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHECK', label: 'Check' },
  { value: 'OTHER', label: 'Other' },
] as const

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  CHECK: 'Check',
  OTHER: 'Other',
}

interface FormState {
  customerId: string
  amount: string
  date: string
  method: string
  notes: string
}

const defaultForm = (): FormState => ({
  customerId: '',
  amount: '',
  date: todayISO(),
  method: 'CASH',
  notes: '',
})

export function PaymentsPage() {
  const { addToast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(defaultForm())
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const { data: payments, loading: paymentsLoading, refetch: refetchPayments } = useQuery<PaymentRow>(
    `SELECT p.*, c.name as customer_name
     FROM payments p
     JOIN customers c ON p.customer_id = c.id
     ORDER BY p.payment_date DESC, p.created_at DESC`,
    [],
    []
  )

  const { data: customers, loading: customersLoading } = useQuery<CustomerRow>(
    `SELECT id, name FROM customers ORDER BY name`,
    [],
    []
  )

  function handleOpenChange(val: boolean) {
    setOpen(val)
    if (!val) setForm(defaultForm())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const amountNum = parseFloat(form.amount)
    if (!form.customerId) {
      addToast({ title: 'Validation Error', description: 'Please select a customer.', variant: 'destructive' })
      return
    }
    if (!form.amount || isNaN(amountNum) || amountNum <= 0) {
      addToast({ title: 'Validation Error', description: 'Please enter a valid amount.', variant: 'destructive' })
      return
    }
    if (!form.date) {
      addToast({ title: 'Validation Error', description: 'Please select a payment date.', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      await dbRun(
        `INSERT INTO payments (id, customer_id, amount_poisha, payment_date, payment_method, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          form.customerId,
          bdtToPoisha(amountNum),
          form.date,
          form.method,
          form.notes.trim() || null,
        ]
      )
      addToast({ title: 'Payment recorded', description: `${formatBDT(bdtToPoisha(amountNum))} payment saved.` })
      setOpen(false)
      setForm(defaultForm())
      refetchPayments()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message ?? 'Failed to record payment.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Payments</h1>

        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm">Record Payment</Button>
          </DialogTrigger>

          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
              {/* Customer */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payment-customer">Customer</Label>
                <Select
                  value={form.customerId}
                  onValueChange={(val) => setForm((f) => ({ ...f, customerId: val }))}
                  disabled={customersLoading}
                >
                  <SelectTrigger id="payment-customer">
                    <SelectValue placeholder={customersLoading ? 'Loading…' : 'Select customer'} />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Amount */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payment-amount">Amount (BDT)</Label>
                <Input
                  id="payment-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>

              {/* Date */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payment-date">Date</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>

              {/* Method */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payment-method">Payment Method</Label>
                <Select
                  value={form.method}
                  onValueChange={(val) => setForm((f) => ({ ...f, method: val }))}
                >
                  <SelectTrigger id="payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payment-notes">Notes</Label>
                <Input
                  id="payment-notes"
                  type="text"
                  placeholder="Optional notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-1">
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={saving}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Payment'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Input
        placeholder="Search payments..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="max-w-sm"
      />

      {/* Payment history table */}
      <div className="rounded-md border">
        {paymentsLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Loading…
          </div>
        ) : payments.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            No payments recorded yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.filter(p => `${p.customer_name} ${p.notes ?? ''}`.toLowerCase().includes(filter.toLowerCase())).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(p.payment_date)}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-sm">
                    {p.customer_name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    {formatBDT(p.amount_poisha)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {METHOD_LABELS[p.payment_method] ?? p.payment_method}
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                    {p.notes ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
