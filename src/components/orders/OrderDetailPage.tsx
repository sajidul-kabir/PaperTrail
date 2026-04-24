import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbTransaction } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, formatNumber, profitColor } from '@/lib/utils'

interface OrderHeader {
  id: string; order_date: string; customer_name: string; customer_organization: string | null
  status: 'PENDING' | 'BILLED' | 'VOID'; invoice_id: string | null
}

interface OrderLineRow {
  id: string; label: string; cut_width_inches: number | null; cut_height_inches: number | null
  quantity_pieces: number; quantity_sheets: number
  selling_price_per_piece_poisha: number; line_total_poisha: number
  cost_per_piece_poisha: number; cost_total_poisha: number; profit_poisha: number; profit_margin_pct: number
  paper_type_id: string | null; accessory_id: string | null
}

const ORDER_SQL = `
  SELECT o.id, o.order_date, c.name as customer_name, c.organization as customer_organization, o.status, o.invoice_id
  FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?
`

const LINES_SQL = `
  SELECT ol.id, COALESCE(ol.label, 'Unknown') as label, ol.cut_width_inches, ol.cut_height_inches,
    ol.quantity_pieces, COALESCE(ol.quantity_sheets, 0) as quantity_sheets,
    ol.selling_price_per_piece_poisha, ol.line_total_poisha,
    ol.cost_per_piece_poisha, ol.cost_total_poisha, ol.profit_poisha, ol.profit_margin_pct,
    ol.paper_type_id, ol.accessory_id
  FROM order_lines ol WHERE ol.order_id = ? ORDER BY ol.ROWID ASC
`

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: headerRows, loading, error, refetch: refetchHeader } = useQuery<OrderHeader>(ORDER_SQL, [id], [id])
  const { data: lines, refetch: refetchLines } = useQuery<OrderLineRow>(LINES_SQL, [id], [id])

  const order = headerRows[0] ?? null
  const grandTotal = lines.reduce((a, l) => a + l.line_total_poisha, 0)
  const grandCost = lines.reduce((a, l) => a + l.cost_total_poisha, 0)
  const grandProfit = lines.reduce((a, l) => a + l.profit_poisha, 0)
  const grandMargin = grandTotal > 0 ? (grandProfit / grandTotal) * 100 : 0

  async function handleVoid() {
    if (!order || !voidReason.trim()) return
    setVoiding(true)
    try {
      const statements: { sql: string; params: any[] }[] = [
        { sql: `UPDATE orders SET status = 'VOID' WHERE id = ?`, params: [order.id] },
      ]

      // If billed, also void the invoice
      if (order.status === 'BILLED' && order.invoice_id) {
        statements.push({
          sql: `UPDATE invoices SET status = 'VOID', void_reason = ?, voided_at = datetime('now') WHERE id = ?`,
          params: [voidReason.trim(), order.invoice_id],
        })
      }

      for (const line of lines) {
        if (line.quantity_sheets > 0) {
          // New-era order: restore sheets to godown stock_ledger
          statements.push({
            sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at)
                  VALUES (?, ?, ?, 'VOID_REVERSAL', ?, ?, datetime('now'))`,
            params: [uuid(), line.paper_type_id, line.accessory_id, line.quantity_sheets, order.id],
          })
        } else {
          // Legacy order (cutting_stock era): restore pieces to cutting_stock
          statements.push({
            sql: `INSERT INTO cutting_stock (id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, transaction_type, reference_id, cost_per_piece_poisha, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'VOID_REVERSAL', ?, ?, datetime('now'))`,
            params: [uuid(), line.paper_type_id, line.accessory_id, line.cut_width_inches, line.cut_height_inches, line.quantity_pieces, order.id, line.cost_per_piece_poisha],
          })
        }
      }

      await dbTransaction(statements)
      addToast({ title: 'Order voided', description: 'Stock has been restored.' })
      setDialogOpen(false); setVoidReason(''); refetchHeader(); refetchLines()
    } catch (err: any) {
      addToast({ title: 'Void failed', description: err.message, variant: 'destructive' })
    } finally { setVoiding(false) }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground p-4">Loading...</div>
  if (error || !order) return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 p-4">
      <p className="text-sm text-destructive">{error ?? 'Order not found.'}</p>
      <Button variant="outline" size="sm" onClick={() => navigate('/orders')}>Back to Orders</Button>
    </div>
  )

  const isVoid = order.status === 'VOID'

  return (
    <div className="flex flex-col gap-4 p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild><Link to="/orders">← Orders</Link></Button>
          <h1 className="text-lg font-semibold">Order Detail</h1>
          <Badge variant={order.status === 'PENDING' ? 'secondary' : order.status === 'BILLED' ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">{order.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
        {order.status === 'PENDING' && (
          <Button variant="outline" size="sm" onClick={() => navigate('/orders/new', { state: { editOrderId: order.id } })}>
            Edit Order
          </Button>
        )}
        {(order.status === 'PENDING' || order.status === 'BILLED') && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button variant="destructive" size="sm">Void Order</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Void Order</DialogTitle></DialogHeader>
              <div className="flex flex-col gap-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  Voiding will restore stock to godown.{order.status === 'BILLED' && ' The associated bill will also be voided.'}
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label>Reason</Label>
                  <Input placeholder="Enter reason..." value={voidReason} onChange={e => setVoidReason(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <DialogClose asChild><Button variant="outline" disabled={voiding}>Cancel</Button></DialogClose>
                  <Button variant="destructive" disabled={!voidReason.trim() || voiding} onClick={handleVoid}>{voiding ? 'Voiding...' : 'Confirm Void'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Date</dt>
              <dd className="mt-0.5">{formatDate(order.order_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Customer</dt>
              <dd className="mt-0.5 font-medium">{order.customer_organization || order.customer_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Total</dt>
              <dd className={`mt-0.5 font-bold tabular-nums ${isVoid ? 'line-through text-muted-foreground' : ''}`}>{formatBDT(grandTotal)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Profit</dt>
              <dd className={`mt-0.5 font-bold tabular-nums ${isVoid ? 'text-muted-foreground' : profitColor(grandMargin)}`}>{formatBDT(grandProfit)} ({grandMargin.toFixed(1)}%)</dd>
            </div>
            {order.invoice_id && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground uppercase">Bill</dt>
                <dd className="mt-0.5"><Link to={`/bills/${order.invoice_id}`} className="text-primary hover:underline text-sm">View Bill</Link></dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Items</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="text-right">Sheets</TableHead>
                <TableHead className="text-right">Pieces</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map(line => (
                <TableRow key={line.id} className={isVoid ? 'opacity-50' : ''}>
                  <TableCell className="text-sm max-w-[200px] truncate">{line.label}</TableCell>
                  <TableCell className="tabular-nums text-xs text-muted-foreground">
                    {line.cut_width_inches && line.cut_height_inches ? `${Math.min(line.cut_width_inches, line.cut_height_inches)}x${Math.max(line.cut_width_inches, line.cut_height_inches)}` : '—'}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">{line.quantity_sheets > 0 ? formatNumber(line.quantity_sheets) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(line.quantity_pieces)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatBDT(line.line_total_poisha)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{formatBDT(line.cost_total_poisha)}</TableCell>
                  <TableCell className={`text-right tabular-nums text-xs font-medium ${isVoid ? 'text-muted-foreground' : profitColor(line.profit_margin_pct)}`}>{formatBDT(line.profit_poisha)}</TableCell>
                  <TableCell className={`text-right tabular-nums text-xs ${isVoid ? 'text-muted-foreground' : profitColor(line.profit_margin_pct)}`}>{line.profit_margin_pct.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
