import { useState } from 'react'
import { dbRun } from '@/lib/ipc'
import { useQuery } from '@/hooks/useQuery'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { Calendar } from '@/components/ui/calendar'
import * as Popover from '@radix-ui/react-popover'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, bdtToPoisha, todayISO } from '@/lib/utils'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

interface PaymentRow {
  id: string
  customer_name: string
  customer_organization: string | null
  amount_poisha: number
  payment_date: string
  payment_method: string
  notes: string | null
}

interface CustomerRow { id: string; name: string; organization: string | null }

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHECK', label: 'Check' },
  { value: 'OTHER', label: 'Other' },
] as const

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash', BANK_TRANSFER: 'Bank Transfer', CHECK: 'Check', OTHER: 'Other',
}

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

const PAYMENTS_SQL = `
  SELECT p.id, p.amount_poisha, p.payment_date, p.payment_method, p.notes,
    c.name as customer_name, c.organization as customer_organization
  FROM payments p
  JOIN customers c ON p.customer_id = c.id
  WHERE p.payment_date = ?
  ORDER BY p.created_at DESC
`

const SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(amount_poisha), 0) as day_total,
    COUNT(*) as day_count
  FROM payments WHERE payment_date = ?
`

interface FormState {
  customerId: string
  customerFilter: string
  amount: string
  method: string
  notes: string
}

const defaultForm = (): FormState => ({
  customerId: '', customerFilter: '', amount: '', method: 'CASH', notes: '',
})

export function PaymentsPage() {
  const { addToast } = useToast()
  const today = todayISO()
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [customerFilter, setCustomerFilter] = useState('')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(defaultForm())
  const [saving, setSaving] = useState(false)

  const { data: payments, loading, refetch } = useQuery<PaymentRow>(PAYMENTS_SQL, [selectedDate], [selectedDate])
  const { data: summaryRows } = useQuery<{ day_total: number; day_count: number }>(SUMMARY_SQL, [selectedDate], [selectedDate])
  const summary = summaryRows[0] ?? { day_total: 0, day_count: 0 }

  const { data: customers, loading: customersLoading } = useQuery<CustomerRow>(
    `SELECT id, name, organization FROM customers ORDER BY COALESCE(organization, name)`, [], []
  )

  const filtered = payments.filter(p => {
    const display = p.customer_organization || p.customer_name
    return display.toLowerCase().includes(customerFilter.toLowerCase())
  })

  const filteredCustomers = form.customerFilter
    ? customers.filter(c => `${c.organization ?? ''} ${c.name}`.toLowerCase().includes(form.customerFilter.toLowerCase()))
    : customers

  function handleOpenChange(val: boolean) {
    setOpen(val)
    if (!val) setForm(defaultForm())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amountNum = parseFloat(form.amount)
    if (!form.customerId) {
      addToast({ title: 'Select a customer', variant: 'destructive' }); return
    }
    if (!form.amount || isNaN(amountNum) || amountNum <= 0) {
      addToast({ title: 'Enter a valid amount', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      await dbRun(
        `INSERT INTO payments (id, customer_id, amount_poisha, payment_date, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuid(), form.customerId, bdtToPoisha(amountNum), selectedDate, form.method, form.notes.trim() || null]
      )
      addToast({ title: 'Payment recorded', description: `${formatBDT(bdtToPoisha(amountNum))} saved.` })
      setOpen(false)
      setForm(defaultForm())
      refetch()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Payments</h1>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm">Record Payment</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Record Payment — {formatDate(selectedDate)}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-1.5">
                <Label>Customer</Label>
                <Select value={form.customerId} onValueChange={val => setForm(f => ({ ...f, customerId: val }))} disabled={customersLoading}>
                  <SelectTrigger><SelectValue placeholder={customersLoading ? 'Loading…' : 'Select customer'} /></SelectTrigger>
                  <SelectContent className="max-h-60" header={
                    <Input placeholder="Search customers..." value={form.customerFilter}
                      onChange={e => setForm(f => ({ ...f, customerFilter: e.target.value }))} className="h-8 text-sm" />
                  }>
                    {filteredCustomers.length === 0 ? <div className="py-3 text-center text-sm text-muted-foreground">No customers found</div>
                      : filteredCustomers.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.organization ? <>{c.organization} <span className="text-muted-foreground text-xs">({c.name})</span></> : c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Amount (BDT)</Label>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Payment Method</Label>
                <Select value={form.method} onValueChange={val => setForm(f => ({ ...f, method: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Notes</Label>
                <Input type="text" placeholder="Optional notes" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <DialogClose asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></DialogClose>
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Payment'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
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
      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[10px] text-muted-foreground uppercase">Payments</div>
          <div className="text-xl font-bold tabular-nums">{summary.day_count}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[10px] text-muted-foreground uppercase">Total Collected</div>
          <div className="text-xl font-bold tabular-nums">{formatBDT(summary.day_total)}</div>
        </CardContent></Card>
      </div>

      {/* Payments table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              No payments for {formatDate(selectedDate)}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p, i) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-sm">{p.customer_organization || p.customer_name}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">{formatBDT(p.amount_poisha)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{METHOD_LABELS[p.payment_method] ?? p.payment_method}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{p.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
