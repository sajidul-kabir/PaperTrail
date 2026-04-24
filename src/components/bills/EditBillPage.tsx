import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbQuery, dbTransaction } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, profitColor } from '@/lib/utils'

interface InvoiceHeader {
  id: string
  invoice_number: string
  invoice_date: string
  customer_name: string
  customer_organization: string | null
  customer_id: string
  total_poisha: number
  status: 'ACTIVE' | 'VOID'
  notes: string | null
}

interface OrderRow {
  id: string
  order_date: string
  status: string
  total_poisha: number
  profit_poisha: number
  margin_pct: number
  item_summary: string
}

const INVOICE_SQL = `
  SELECT i.id, i.invoice_number, i.invoice_date,
         c.name AS customer_name, c.organization AS customer_organization,
         i.customer_id, i.total_poisha, i.status, i.notes
  FROM invoices i
  JOIN customers c ON i.customer_id = c.id
  WHERE i.id = ?
`

const ORDERS_SQL = `
  SELECT o.id, o.order_date, o.status,
    COALESCE(SUM(ol.line_total_poisha), 0) as total_poisha,
    COALESCE(SUM(ol.profit_poisha), 0) as profit_poisha,
    CASE WHEN COALESCE(SUM(ol.line_total_poisha), 0) > 0
      THEN COALESCE(SUM(ol.profit_poisha), 0) * 100.0 / COALESCE(SUM(ol.line_total_poisha), 1)
      ELSE 0
    END as margin_pct,
    GROUP_CONCAT(COALESCE(ol.label, 'Unknown'), ', ') as item_summary
  FROM orders o
  LEFT JOIN order_lines ol ON ol.order_id = o.id
  WHERE o.invoice_id = ?
  GROUP BY o.id
  ORDER BY o.order_date, o.ROWID
`

export function EditBillPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()

  const [ordersToRemove, setOrdersToRemove] = useState<Set<string>>(new Set())
  const [editReason, setEditReason] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: headerRows, loading } = useQuery<InvoiceHeader>(INVOICE_SQL, [id], [id])
  const { data: orders } = useQuery<OrderRow>(ORDERS_SQL, [id], [id])

  const invoice = headerRows[0] ?? null

  if (loading) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground p-4">Loading...</div>
  if (!invoice || invoice.status !== 'ACTIVE') return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 p-4">
      <p className="text-sm text-destructive">Bill not found or not active.</p>
      <Button variant="outline" size="sm" onClick={() => navigate('/bills')}>Back to Bills</Button>
    </div>
  )

  const remainingOrders = orders.filter(o => !ordersToRemove.has(o.id))
  const removedOrders = orders.filter(o => ordersToRemove.has(o.id))
  const newTotal = remainingOrders.reduce((a, o) => a + o.total_poisha, 0)
  const allRemoved = remainingOrders.length === 0 && orders.length > 0
  const hasChanges = ordersToRemove.size > 0
  const canSave = hasChanges && editReason.trim() !== ''

  function toggleRemove(orderId: string) {
    setOrdersToRemove(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const statements: { sql: string; params: any[] }[] = []

      // For each removed order: void it and restore stock
      for (const orderId of ordersToRemove) {
        statements.push({
          sql: `UPDATE orders SET status = 'VOID', invoice_id = NULL WHERE id = ?`,
          params: [orderId],
        })

        // Restore stock for removed orders
        const orderLines = await dbQuery<{
          paper_type_id: string | null; accessory_id: string | null; quantity_sheets: number
        }>(
          `SELECT paper_type_id, accessory_id, quantity_sheets FROM order_lines WHERE order_id = ?`,
          [orderId]
        )
        for (const ol of orderLines) {
          if (ol.quantity_sheets > 0) {
            statements.push({
              sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at)
                    VALUES (?, ?, ?, 'VOID_REVERSAL', ?, ?, datetime('now'))`,
              params: [uuid(), ol.paper_type_id, ol.accessory_id, ol.quantity_sheets, orderId],
            })
          }
        }
      }

      if (allRemoved) {
        // Void the entire invoice
        statements.push({
          sql: `UPDATE invoices SET status = 'VOID', void_reason = ?, voided_at = datetime('now') WHERE id = ?`,
          params: [editReason.trim(), invoice.id],
        })
      } else {
        // Regenerate invoice_lines from remaining orders
        statements.push({
          sql: `DELETE FROM invoice_lines WHERE invoice_id = ?`,
          params: [invoice.id],
        })

        const remainingIds = remainingOrders.map(o => o.id)
        const placeholders = remainingIds.map(() => '?').join(',')
        const allOrderLines = await dbQuery<{
          paper_type_id: string | null; accessory_id: string | null
          cut_width_inches: number | null; cut_height_inches: number | null
          quantity_pieces: number; selling_price_per_piece_poisha: number
          line_total_poisha: number; cost_per_piece_poisha: number
          cost_total_poisha: number; profit_poisha: number; profit_margin_pct: number
        }>(
          `SELECT paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, selling_price_per_piece_poisha, line_total_poisha, cost_per_piece_poisha, cost_total_poisha, profit_poisha, profit_margin_pct
           FROM order_lines WHERE order_id IN (${placeholders})`,
          remainingIds
        )

        for (const ol of allOrderLines) {
          statements.push({
            sql: `INSERT INTO invoice_lines (id, invoice_id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_sheets, selling_price_per_sheet_poisha, area_ratio, full_sheets_consumed, cost_per_full_sheet_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, waste_sheets, line_total_poisha)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [uuid(), invoice.id, ol.paper_type_id, ol.accessory_id, ol.cut_width_inches, ol.cut_height_inches,
              ol.quantity_pieces, Math.round(ol.selling_price_per_piece_poisha), 1, ol.quantity_pieces,
              Math.round(ol.cost_per_piece_poisha), ol.cost_total_poisha, ol.profit_poisha, ol.profit_margin_pct, 0, ol.line_total_poisha],
          })
        }

        // Update invoice total and append edit reason to notes
        const existingNotes = invoice.notes ?? ''
        const newNotes = existingNotes
          ? `${existingNotes}\n[Edit] ${editReason.trim()}`
          : `[Edit] ${editReason.trim()}`

        statements.push({
          sql: `UPDATE invoices SET total_poisha = ?, subtotal_poisha = ?, notes = ? WHERE id = ?`,
          params: [newTotal, newTotal, newNotes, invoice.id],
        })
      }

      await dbTransaction(statements)
      addToast({
        title: allRemoved ? 'Bill voided' : 'Bill updated',
        description: allRemoved
          ? `${invoice.invoice_number} has been voided. ${removedOrders.length} order(s) voided with stock restored.`
          : `${removedOrders.length} order(s) removed. New total: ${formatBDT(newTotal)}`,
      })
      navigate(`/bills/${invoice.id}`)
    } catch (err: any) {
      addToast({ title: 'Save failed', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/bills/${invoice.id}`}>← Back</Link>
        </Button>
        <h1 className="text-lg font-semibold">Edit Bill <span className="font-mono">{invoice.invoice_number}</span></h1>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Bill Info</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Customer</dt>
              <dd className="mt-0.5 font-medium">{invoice.customer_organization || invoice.customer_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Date</dt>
              <dd className="mt-0.5">{formatDate(invoice.invoice_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Current Total</dt>
              <dd className="mt-0.5 font-bold tabular-nums">{formatBDT(invoice.total_poisha)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Orders in this Bill</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map(order => {
                const isRemoved = ordersToRemove.has(order.id)
                return (
                  <TableRow key={order.id} className={isRemoved ? 'opacity-50' : ''}>
                    <TableCell className={`text-sm ${isRemoved ? 'line-through' : ''}`}>
                      {formatDate(order.order_date)}
                    </TableCell>
                    <TableCell className={`text-xs text-muted-foreground max-w-[200px] truncate ${isRemoved ? 'line-through' : ''}`}>
                      {order.item_summary}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${isRemoved ? 'line-through' : ''}`}>
                      {formatBDT(order.total_poisha)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-xs ${isRemoved ? 'line-through text-muted-foreground' : profitColor(order.margin_pct)}`}>
                      {formatBDT(order.profit_poisha)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!isRemoved && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs"
                            onClick={() => navigate('/orders/new', { state: { editOrderId: order.id } })}>
                            Edit
                          </Button>
                        )}
                        <Button
                          variant={isRemoved ? 'outline' : 'destructive'}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => toggleRemove(order.id)}
                        >
                          {isRemoved ? 'Undo' : 'Remove'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {hasChanges && (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Summary of Changes</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground uppercase">Orders to Remove</span>
                  <div className="text-lg font-bold text-destructive">{ordersToRemove.size}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase">New Total</span>
                  <div className="text-lg font-bold tabular-nums">
                    {allRemoved ? (
                      <Badge variant="destructive">BILL WILL BE VOIDED</Badge>
                    ) : formatBDT(newTotal)}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Edit Reason <span className="text-destructive">*</span></Label>
                <Input placeholder="Why are you editing this bill?"
                  value={editReason} onChange={e => setEditReason(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(`/bills/${invoice.id}`)}>Cancel</Button>
        <Button onClick={handleSave} disabled={!canSave || saving}>
          {saving ? 'Saving...' : allRemoved ? 'Void Bill' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
