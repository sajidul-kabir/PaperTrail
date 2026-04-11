import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbRun } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'

interface Supplier {
  id: string
  name: string
  phone: string | null
  address: string | null
  created_at: string
}

const SQL = `SELECT id, name, phone, address, created_at FROM suppliers ORDER BY name`

interface FormState { name: string; phone: string; address: string }
const emptyForm: FormState = { name: '', phone: '', address: '' }

export function SuppliersPage() {
  const { addToast } = useToast()
  const { data: suppliers, loading, error, refetch } = useQuery<Supplier>(SQL)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)
  const [deleting, setDeleting] = useState(false)

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setOpen(true)
  }

  function openEdit(s: Supplier) {
    setEditing(s)
    setForm({ name: s.name, phone: s.phone ?? '', address: s.address ?? '' })
    setOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      addToast({ title: 'Enter supplier name', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      if (editing) {
        await dbRun(
          `UPDATE suppliers SET name = ?, phone = ?, address = ? WHERE id = ?`,
          [form.name.trim(), form.phone.trim() || null, form.address.trim() || null, editing.id]
        )
        addToast({ title: 'Supplier updated' })
      } else {
        await dbRun(
          `INSERT INTO suppliers (id, name, phone, address, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
          [uuid(), form.name.trim(), form.phone.trim() || null, form.address.trim() || null]
        )
        addToast({ title: 'Supplier added' })
      }
      setOpen(false); setForm(emptyForm); setEditing(null); refetch()
    } catch (err: any) {
      addToast({ title: 'Failed', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await dbRun(`DELETE FROM suppliers WHERE id = ?`, [deleteTarget.id])
      addToast({ title: 'Supplier deleted' })
      setDeleteTarget(null); refetch()
    } catch (err: any) {
      addToast({ title: 'Cannot delete', description: 'Supplier may be linked to purchases. ' + err.message, variant: 'destructive' })
    } finally { setDeleting(false) }
  }

  const filtered = suppliers.filter(s =>
    `${s.name} ${s.phone ?? ''} ${s.address ?? ''}`.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your paper and accessory suppliers.</p>
        </div>
        <Button onClick={openNew}>+ New Supplier</Button>
      </div>

      <Input placeholder="Search suppliers..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : error ? (
        <p className="text-sm text-destructive">Error: {error}</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium text-muted-foreground">{filter ? 'No suppliers match.' : 'No suppliers yet.'}</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.phone ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">{s.address ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(s.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(s)} className="text-xs text-primary hover:underline">Edit</button>
                      <button onClick={() => setDeleteTarget(s)} className="text-xs text-destructive hover:underline">Delete</button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) { setEditing(null); setForm(emptyForm) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Supplier name" />
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="grid gap-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Optional" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); setForm(emptyForm) }} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Add'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Supplier</DialogTitle></DialogHeader>
          {deleteTarget && (
            <div className="flex flex-col gap-3 pt-2">
              <p className="text-sm text-muted-foreground">
                Delete <span className="font-semibold text-foreground">{deleteTarget.name}</span>? This cannot be undone.
                If this supplier is linked to any purchases, deletion will fail.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <DialogClose asChild><Button variant="outline" disabled={deleting}>Cancel</Button></DialogClose>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
