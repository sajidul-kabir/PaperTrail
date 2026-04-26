import { useState } from "react";
import { v4 as uuid } from "uuid";
import { useQuery } from "@/hooks/useQuery";
import { dbRun } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  formatDate,
  formatBDT,
  bdtToPoisha,
  todayISO,
  poishaToBdt,
} from "@/lib/utils";

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  previous_outstanding_poisha: number;
  due_poisha: number;
  created_at: string;
}

interface SupplierPayment {
  id: string;
  supplier_name: string;
  amount_poisha: number;
  payment_date: string;
  payment_method: string;
  notes: string | null;
}

const SUPPLIER_SQL = `
  SELECT s.*,
    s.previous_outstanding_poisha +
    COALESCE((SELECT SUM(CAST(cost_per_ream_poisha AS REAL) * quantity_reams) FROM purchases WHERE supplier_id = s.id), 0) -
    COALESCE((SELECT SUM(amount_poisha) FROM supplier_payments WHERE supplier_id = s.id), 0) as due_poisha
  FROM suppliers s ORDER BY s.name
`;

const PAYMENTS_SQL = `
  SELECT sp.id, sp.amount_poisha, sp.payment_date, sp.payment_method, sp.notes,
    s.name as supplier_name
  FROM supplier_payments sp
  JOIN suppliers s ON s.id = sp.supplier_id
  ORDER BY sp.payment_date DESC, sp.created_at DESC
`;

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CHECK", label: "Check" },
  { value: "OTHER", label: "Other" },
] as const;

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CHECK: "Check",
  OTHER: "Other",
};

interface FormState {
  name: string;
  phone: string;
  address: string;
  previousOutstanding: string;
}
const emptyForm: FormState = {
  name: "",
  phone: "",
  address: "",
  previousOutstanding: "",
};

export function SuppliersPage() {
  const { addToast } = useToast();
  const {
    data: suppliers,
    loading,
    error,
    refetch,
  } = useQuery<Supplier>(SUPPLIER_SQL);
  const { data: payments, refetch: refetchPayments } =
    useQuery<SupplierPayment>(PAYMENTS_SQL);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Pay supplier form
  const [payForm, setPayForm] = useState({
    supplierId: "",
    supplierFilter: "",
    amount: "",
    date: todayISO(),
    method: "CASH",
    notes: "",
  });
  const [payingSaving, setPayingSaving] = useState(false);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      phone: s.phone ?? "",
      address: s.address ?? "",
      previousOutstanding: s.previous_outstanding_poisha
        ? String(poishaToBdt(s.previous_outstanding_poisha))
        : "",
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      addToast({ title: "Enter supplier name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const prevOutstanding = form.previousOutstanding
          ? bdtToPoisha(parseFloat(form.previousOutstanding))
          : 0;
        await dbRun(
          `UPDATE suppliers SET name = ?, phone = ?, address = ?, previous_outstanding_poisha = ? WHERE id = ?`,
          [
            form.name.trim(),
            form.phone.trim() || null,
            form.address.trim() || null,
            prevOutstanding,
            editing.id,
          ],
        );
        addToast({ title: "Supplier updated" });
      } else {
        const prevOutstanding = form.previousOutstanding
          ? bdtToPoisha(parseFloat(form.previousOutstanding))
          : 0;
        await dbRun(
          `INSERT INTO suppliers (id, name, phone, address, previous_outstanding_poisha, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [
            uuid(),
            form.name.trim(),
            form.phone.trim() || null,
            form.address.trim() || null,
            prevOutstanding,
          ],
        );
        addToast({ title: "Supplier added" });
      }
      setOpen(false);
      setForm(emptyForm);
      setEditing(null);
      refetch();
    } catch (err: any) {
      addToast({
        title: "Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await dbRun(`DELETE FROM suppliers WHERE id = ?`, [deleteTarget.id]);
      addToast({ title: "Supplier deleted" });
      setDeleteTarget(null);
      refetch();
    } catch (err: any) {
      addToast({
        title: "Cannot delete",
        description: "Supplier may be linked to purchases. " + err.message,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  async function handlePayment() {
    if (!payForm.supplierId) {
      addToast({ title: "Select a supplier", variant: "destructive" });
      return;
    }
    const amt = parseFloat(payForm.amount);
    if (!amt || amt <= 0) {
      addToast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!payForm.date) {
      addToast({ title: "Select a date", variant: "destructive" });
      return;
    }
    setPayingSaving(true);
    try {
      await dbRun(
        `INSERT INTO supplier_payments (id, supplier_id, amount_poisha, payment_date, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          payForm.supplierId,
          bdtToPoisha(amt),
          payForm.date,
          payForm.method,
          payForm.notes.trim() || null,
        ],
      );
      addToast({ title: "Payment recorded" });
      setPayForm((f) => ({
        ...f,
        supplierId: "",
        supplierFilter: "",
        amount: "",
        notes: "",
      }));
      refetch();
      refetchPayments();
    } catch (err: any) {
      addToast({
        title: "Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setPayingSaving(false);
    }
  }

  const filtered = suppliers.filter((s) =>
    `${s.name} ${s.phone ?? ""} ${s.address ?? ""}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  const filteredSupplierOptions = suppliers.filter((s) =>
    s.name.toLowerCase().includes(payForm.supplierFilter.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your paper and accessory suppliers.
          </p>
        </div>
        <Button onClick={openNew}>+ New Supplier</Button>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Supplier List</TabsTrigger>
          <TabsTrigger value="pay">Pay Supplier</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <div className="flex flex-col gap-4 mt-2">
            <Input
              placeholder="Search suppliers..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : error ? (
              <p className="text-sm text-destructive">Error: {error}</p>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
                <p className="text-sm font-medium text-muted-foreground">
                  {filter ? "No suppliers match." : "No suppliers yet."}
                </p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {s.phone ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[200px] truncate">
                          {s.address ?? "—"}
                        </TableCell>
                        <TableCell
                          className={` font-medium ${s.due_poisha > 0 ? "text-destructive" : "text-green-600"}`}
                        >
                          {formatBDT(s.due_poisha)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <button
                              onClick={() => openEdit(s)}
                              className="text-xs text-primary hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleteTarget(s)}
                              className="text-xs text-destructive hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="pay">
          <div className="flex flex-col gap-6 mt-2">
            <div className="max-w-md flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Record Supplier Payment</h2>

              {/* Supplier dropdown with search */}
              <div className="grid gap-1.5">
                <Label>Supplier *</Label>
                <Select
                  value={payForm.supplierId}
                  onValueChange={(v) =>
                    setPayForm((f) => ({ ...f, supplierId: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 pb-1.5">
                      <Input
                        placeholder="Search..."
                        value={payForm.supplierFilter}
                        onChange={(e) =>
                          setPayForm((f) => ({
                            ...f,
                            supplierFilter: e.target.value,
                          }))
                        }
                        className="h-8"
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                    {filteredSupplierOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.due_poisha > 0
                          ? ` (Due: ${formatBDT(s.due_poisha)})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>Amount (BDT) *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payForm.amount}
                  onChange={(e) =>
                    setPayForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  placeholder="0.00"
                />
              </div>

              <div className="grid gap-1.5">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={payForm.date}
                  onChange={(e) =>
                    setPayForm((f) => ({ ...f, date: e.target.value }))
                  }
                />
              </div>

              <div className="grid gap-1.5">
                <Label>Method</Label>
                <Select
                  value={payForm.method}
                  onValueChange={(v) =>
                    setPayForm((f) => ({ ...f, method: v }))
                  }
                >
                  <SelectTrigger>
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

              <div className="grid gap-1.5">
                <Label>Notes</Label>
                <Input
                  value={payForm.notes}
                  onChange={(e) =>
                    setPayForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Optional"
                />
              </div>

              <Button
                onClick={handlePayment}
                disabled={payingSaving}
                className="w-fit"
              >
                {payingSaving ? "Saving..." : "Record Payment"}
              </Button>
            </div>

            {/* Recent payments table */}
            {payments.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Recent Payments
                </h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {formatDate(p.payment_date)}
                          </TableCell>
                          <TableCell className="font-medium">
                            {p.supplier_name}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatBDT(p.amount_poisha)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0"
                            >
                              {METHOD_LABELS[p.payment_method] ??
                                p.payment_method}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                            {p.notes ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Add/Edit Dialog */}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setEditing(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Supplier" : "Add Supplier"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Supplier name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Address</Label>
              <Input
                value={form.address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Previous Outstanding (BDT)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.previousOutstanding}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    previousOutstanding: e.target.value,
                  }))
                }
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setEditing(null);
                setForm(emptyForm);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editing ? "Update" : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Supplier</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="flex flex-col gap-3 pt-2">
              <p className="text-sm text-muted-foreground">
                Delete{" "}
                <span className="font-semibold text-foreground">
                  {deleteTarget.name}
                </span>
                ? This cannot be undone. If this supplier is linked to any
                purchases, deletion will fail.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <DialogClose asChild>
                  <Button variant="outline" disabled={deleting}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
