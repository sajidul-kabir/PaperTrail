import { useState } from 'react'
import { dbRun } from '@/lib/ipc'
import { useQuery } from '@/hooks/useQuery'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatBDT } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'

interface CustomerRow {
  id: string
  name: string
  organization: string | null
  phone: string | null
  address: string | null
  balance_poisha: number
}

const CUSTOMERS_SQL = `
  SELECT c.*,
    COALESCE((SELECT SUM(total_poisha) FROM invoices WHERE customer_id = c.id AND status = 'ACTIVE'), 0) -
    COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE customer_id = c.id), 0) as balance_poisha
  FROM customers c
  ORDER BY c.name
`

export function CustomersPage() {
  const navigate = useNavigate()
  const { addToast } = useToast()

  const { data: customers, loading, refetch } = useQuery<CustomerRow>(CUSTOMERS_SQL, [], [])

  const [filter, setFilter] = useState('')

  // Add customer dialog state
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    organization: '',
    phone: '',
    address: '',
  })

  function resetForm() {
    setForm({ name: '', organization: '', phone: '', address: '' })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) {
      addToast({ title: 'Name is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await dbRun(
        `INSERT INTO customers (id, name, organization, phone, address) VALUES (?, ?, ?, ?, ?)`,
        [
          uuid(),
          name,
          form.organization.trim() || null,
          form.phone.trim() || null,
          form.address.trim() || null,
        ]
      )
      addToast({ title: 'Customer added', description: name })
      setOpen(false)
      resetForm()
      refetch()
    } catch (err: any) {
      addToast({ title: 'Failed to add customer', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Customers</h1>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
          <DialogTrigger asChild>
            <Button size="sm">Add Customer</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Add Customer</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-1">
              <div className="flex flex-col gap-1">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Full name"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="organization">Organization</Label>
                <Input
                  id="organization"
                  name="organization"
                  value={form.organization}
                  onChange={handleChange}
                  placeholder="Company / shop name"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="01XXXXXXXXX"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  placeholder="Delivery / billing address"
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

      <Input
        placeholder="Search customers..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="max-w-sm"
      />

      {/* Customers table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>All Customers</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Loading…</div>
          ) : customers.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              No customers yet. Click "Add Customer" to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Outstanding Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.filter(c => `${c.name} ${c.organization ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(filter.toLowerCase())).map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/customers/${c.id}`)}
                  >
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.organization ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.phone ?? '—'}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums text-sm font-semibold ${
                        c.balance_poisha > 0
                          ? 'text-profit-loss'
                          : c.balance_poisha < 0
                          ? 'text-profit-good'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {c.balance_poisha === 0 ? '—' : formatBDT(Math.abs(c.balance_poisha))}
                      {c.balance_poisha < 0 && (
                        <span className="ml-1 text-xs font-normal">(overpaid)</span>
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
  )
}
