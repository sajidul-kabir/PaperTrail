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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, formatNumber, profitColor, poishaToBdt } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceHeader {
  id: string
  invoice_number: string
  invoice_date: string
  customer_name: string
  customer_organization: string | null
  customer_id: string
  total_poisha: number
  status: 'ACTIVE' | 'VOID'
  void_reason: string | null
  voided_at: string | null
}

interface InvoiceLine {
  id: string
  paper_type_label: string
  full_width_inches: number
  full_height_inches: number
  cut_width_inches: number
  cut_height_inches: number
  quantity_sheets: number
  selling_price_per_sheet_poisha: number
  cost_per_full_sheet_poisha: number
  area_ratio: number
  full_sheets_consumed: number
  cost_total_poisha: number
  profit_poisha: number
  profit_margin_pct: number
  waste_sheets: number
  line_total_poisha: number
  paper_type_id: string | null
  accessory_id: string | null
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const INVOICE_SQL = `
  SELECT i.id,
         i.invoice_number,
         i.invoice_date,
         c.name  AS customer_name,
         c.organization AS customer_organization,
         i.customer_id,
         i.total_poisha,
         i.status,
         i.void_reason,
         i.voided_at
  FROM invoices i
  JOIN customers c ON i.customer_id = c.id
  WHERE i.id = ?
`

const LINES_SQL = `
  SELECT il.id,
         il.paper_type_id,
         il.accessory_id,
         COALESCE(
           b.name || CASE WHEN pt.variant != '' THEN CASE WHEN pt.variant LIKE 'CB %' OR pt.variant LIKE 'CFB %' OR pt.variant LIKE 'CF %' THEN ' Carbon Paper' ELSE ' Color Paper' END ELSE '' END || ' ' || g.value || 'gsm ' || MIN(p.width_inches, p.height_inches) || 'x' || MAX(p.width_inches, p.height_inches) || CASE WHEN pt.variant != '' THEN ' ' || pt.variant ELSE '' END,
           at.name || ' ' || ab.name || ' ' || ag.value || COALESCE(ag.unit, 'lb'),
           'Unknown'
         ) AS paper_type_label,
         COALESCE(p.width_inches, 0) AS full_width_inches,
         COALESCE(p.height_inches, 0) AS full_height_inches,
         il.cut_width_inches,
         il.cut_height_inches,
         il.quantity_sheets,
         il.selling_price_per_sheet_poisha,
         il.cost_per_full_sheet_poisha,
         il.area_ratio,
         il.full_sheets_consumed,
         il.cost_total_poisha,
         il.profit_poisha,
         il.profit_margin_pct,
         il.waste_sheets,
         il.line_total_poisha
  FROM invoice_lines il
  LEFT JOIN paper_types pt ON pt.id = il.paper_type_id
  LEFT JOIN brands      b  ON b.id  = pt.brand_id
  LEFT JOIN gsm_options g  ON g.id  = pt.gsm_id
  LEFT JOIN proportions p  ON p.id  = pt.proportion_id
  LEFT JOIN accessories ac ON ac.id = il.accessory_id
  LEFT JOIN accessory_types at ON at.id = ac.accessory_type_id
  LEFT JOIN brands ab ON ab.id = ac.brand_id
  LEFT JOIN gsm_options ag ON ag.id = ac.gsm_id
  WHERE il.invoice_id = ?
  ORDER BY il.ROWID ASC
`

// ─── Profit Breakdown ────────────────────────────────────────────────────────

function ProfitBreakdown({ line }: { line: InvoiceLine }) {
  const [open, setOpen] = useState(false)

  const cutArea = line.cut_width_inches * line.cut_height_inches
  const fullArea = line.full_width_inches * line.full_height_inches
  const costPerReamPoisha = line.cost_per_full_sheet_poisha * 500

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="text-xs text-primary hover:underline whitespace-nowrap"
          title="View profit breakdown"
        >
          Breakdown
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Profit Breakdown</DialogTitle>
        </DialogHeader>
        <div className="text-sm space-y-4 pt-2">
          <div className="font-medium text-muted-foreground">{line.paper_type_label}</div>

          <div className="space-y-2">
            <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">1. Area Ratio</h4>
            <div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
              <div>Cut size: {line.cut_width_inches}" x {line.cut_height_inches}" = {cutArea.toFixed(2)} sq.in</div>
              <div>Full sheet: {line.full_width_inches}" x {line.full_height_inches}" = {fullArea.toFixed(2)} sq.in</div>
              <div className="font-semibold pt-1">Area ratio = {cutArea.toFixed(2)} / {fullArea.toFixed(2)} = {(line.area_ratio * 100).toFixed(4)}%</div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">2. Full Sheets Consumed</h4>
            <div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
              <div>Quantity ordered: {formatNumber(line.quantity_sheets)} sheets</div>
              <div className="font-semibold pt-1">{formatNumber(line.quantity_sheets)} x {(line.area_ratio).toFixed(4)} = {formatNumber(line.full_sheets_consumed, 2)} full sheets</div>
              <div className="text-muted-foreground">({formatNumber(line.full_sheets_consumed / 500, 4)} reams)</div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">3. Revenue</h4>
            <div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
              <div>Rate per full sheet: {formatBDT(line.selling_price_per_sheet_poisha)}</div>
              <div className="font-semibold pt-1">{formatNumber(line.full_sheets_consumed, 2)} x {formatBDT(line.selling_price_per_sheet_poisha)} = {formatBDT(line.line_total_poisha)}</div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">4. Cost</h4>
            <div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
              <div>Avg cost per full sheet: {formatBDT(line.cost_per_full_sheet_poisha)}</div>
              <div className="text-muted-foreground">(Avg cost per ream: {formatBDT(costPerReamPoisha)})</div>
              <div className="font-semibold pt-1">{formatNumber(line.full_sheets_consumed, 2)} x {formatBDT(line.cost_per_full_sheet_poisha)} = {formatBDT(line.cost_total_poisha)}</div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">5. Profit</h4>
            <div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
              <div>Revenue: {formatBDT(line.line_total_poisha)}</div>
              <div>− Cost: {formatBDT(line.cost_total_poisha)}</div>
              <div className={`font-semibold pt-1 ${profitColor(line.profit_margin_pct)}`}>
                = Profit: {formatBDT(line.profit_poisha)} ({line.profit_margin_pct.toFixed(1)}% margin)
              </div>
            </div>
          </div>

          {line.waste_sheets > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">6. Waste</h4>
              <div className="bg-muted/50 rounded-md p-3 font-mono text-xs">
                <div>Waste from cutting layout: {formatNumber(line.waste_sheets, 2)} full-sheet equivalents</div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()

  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const {
    data: headerRows,
    loading: headerLoading,
    error: headerError,
    refetch: refetchHeader,
  } = useQuery<InvoiceHeader>(INVOICE_SQL, [id], [id])

  const {
    data: lines,
    loading: linesLoading,
    refetch: refetchLines,
  } = useQuery<InvoiceLine>(LINES_SQL, [id], [id])

  const invoice = headerRows[0] ?? null

  // ── Totals ──────────────────────────────────────────────────────────────────

  const grandTotal = lines.reduce((a, l) => a + l.line_total_poisha, 0)
  const grandCost = lines.reduce((a, l) => a + l.cost_total_poisha, 0)
  const grandProfit = lines.reduce((a, l) => a + l.profit_poisha, 0)
  const grandMargin = grandTotal > 0 ? (grandProfit / grandTotal) * 100 : 0

  // ── Void handler ────────────────────────────────────────────────────────────

  const handleVoid = async () => {
    if (!invoice || !voidReason.trim()) return
    setVoiding(true)
    try {
      const statements: { sql: string; params: any[] }[] = [
        {
          sql: `UPDATE invoices
                SET status = 'VOID', void_reason = ?, voided_at = datetime('now')
                WHERE id = ?`,
          params: [voidReason.trim(), invoice.id],
        },
        // Set linked orders back to PENDING
        {
          sql: `UPDATE orders SET status = 'PENDING', invoice_id = NULL WHERE invoice_id = ?`,
          params: [invoice.id],
        },
      ]

      // Note: We do NOT restore cutting_stock here because stock was
      // already deducted at order time, not bill time. Voiding a bill
      // just un-links orders so they can be re-billed. To restore stock,
      // void the individual orders instead.

      await dbTransaction(statements)

      addToast({ title: 'Bill voided', description: `${invoice.invoice_number} has been voided. Linked orders are now PENDING.` })
      setDialogOpen(false)
      setVoidReason('')
      refetchHeader()
      refetchLines()
    } catch (err: any) {
      addToast({ title: 'Void failed', description: err.message, variant: 'destructive' })
    } finally {
      setVoiding(false)
    }
  }

  const handlePrint = async () => {
    if (!invoice) return
    // Look up outstanding balance for this customer
    let outstanding = 0
    try {
      const rows = await dbQuery<{ bal: number }>(`
        SELECT COALESCE(SUM(i.total_poisha), 0) - COALESCE((SELECT SUM(p.amount_poisha) FROM payments p WHERE p.customer_id = ?), 0) as bal
        FROM invoices i WHERE i.customer_id = ? AND i.status = 'ACTIVE'
      `, [invoice.customer_id, invoice.customer_id])
      outstanding = Math.max(0, (rows[0]?.bal ?? 0) - invoice.total_poisha)
    } catch { /* ignore */ }

    const customerDisplay = invoice.customer_organization || invoice.customer_name
    sessionStorage.setItem('billPrintData', JSON.stringify({
      invoice_number: invoice.invoice_number,
      bill_date: invoice.invoice_date,
      customer_display: customerDisplay,
      customer_name: invoice.customer_name,
      lines: lines.map(l => ({
        cut_width_inches: l.cut_width_inches,
        cut_height_inches: l.cut_height_inches,
        quantity_pieces: l.quantity_sheets,
        selling_price_per_piece_poisha: l.selling_price_per_sheet_poisha,
        line_total_poisha: l.line_total_poisha,
        label: l.paper_type_label,
      })),
      bill_total: grandTotal,
      outstanding,
      grand_total: grandTotal + outstanding,
      paying_now: 0,
      remaining: grandTotal + outstanding,
    }))
    navigate(`/bills/${invoice.id}/print`)
  }

  // ── Render states ───────────────────────────────────────────────────────────

  if (headerLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground p-4">
        Loading…
      </div>
    )
  }

  if (headerError || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 p-4">
        <p className="text-sm text-destructive">{headerError ?? 'Order not found.'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/bills')}>
          Back to Bills
        </Button>
      </div>
    )
  }

  const isVoid = invoice.status === 'VOID'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 p-4 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/bills">← Bills</Link>
          </Button>
          <h1 className="text-lg font-semibold font-mono">{invoice.invoice_number}</h1>
          {isVoid ? (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">VOID</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">ACTIVE</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isVoid && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/bills/${invoice.id}/edit`)}>
              Edit Bill
            </Button>
          )}
          {!isVoid && (
            <Button variant="outline" size="sm" onClick={handlePrint}>
              Print Again
            </Button>
          )}
          {!isVoid && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Void Bill
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Void Bill {invoice.invoice_number}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Voiding will un-link all orders (setting them back to PENDING so they can be re-billed). This cannot be undone.
                  </p>
                <div className="flex flex-col gap-1.5">
                  <Label>Reason</Label>
                  <Input
                    placeholder="Enter void reason…"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <DialogClose asChild>
                    <Button variant="outline" disabled={voiding}>Cancel</Button>
                  </DialogClose>
                  <Button
                    variant="destructive"
                    disabled={!voidReason.trim() || voiding}
                    onClick={handleVoid}
                  >
                    {voiding ? 'Voiding…' : 'Confirm Void'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      {/* Invoice header card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Bill Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground uppercase tracking-wide">Bill #</dt>
              <dd className="font-mono font-medium mt-0.5">{invoice.invoice_number}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase tracking-wide">Date</dt>
              <dd className="mt-0.5">{formatDate(invoice.invoice_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase tracking-wide">Customer</dt>
              <dd className="mt-0.5 font-medium">{invoice.customer_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase tracking-wide">Total</dt>
              <dd className={`mt-0.5 font-bold tabular-nums ${isVoid ? 'line-through text-muted-foreground' : ''}`}>
                {formatBDT(invoice.total_poisha)}
              </dd>
            </div>
            {isVoid && invoice.void_reason && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Void Reason</dt>
                <dd className="mt-0.5 text-destructive">{invoice.void_reason}</dd>
              </div>
            )}
            {isVoid && invoice.voided_at && (
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Voided At</dt>
                <dd className="mt-0.5 text-muted-foreground text-xs">{invoice.voided_at}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {linesLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : lines.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No line items found.
            </div>
          ) : (
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
                {lines.map((line) => (
                  <TableRow key={line.id} className={isVoid ? 'opacity-50' : ''}>
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {line.paper_type_label}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs text-muted-foreground">
                      {line.cut_width_inches && line.cut_height_inches ? `${Math.min(line.cut_width_inches, line.cut_height_inches)}x${Math.max(line.cut_width_inches, line.cut_height_inches)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.full_sheets_consumed > 0 ? formatNumber(line.full_sheets_consumed) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(line.quantity_sheets)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatBDT(line.line_total_poisha)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {formatBDT(line.cost_total_poisha)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums text-xs font-medium ${
                        isVoid ? 'text-muted-foreground' : profitColor(line.profit_margin_pct)
                      }`}
                    >
                      {formatBDT(line.profit_poisha)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums text-xs ${
                        isVoid ? 'text-muted-foreground' : profitColor(line.profit_margin_pct)
                      }`}
                    >
                      {line.profit_margin_pct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Totals summary */}
      {lines.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Total</span>
                <span
                  className={`text-xl font-bold tabular-nums ${isVoid ? 'line-through text-muted-foreground' : ''}`}
                >
                  {formatBDT(grandTotal)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Cost</span>
                <span className="text-xl font-bold tabular-nums text-muted-foreground">
                  {formatBDT(grandCost)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Profit</span>
                <span
                  className={`text-xl font-bold tabular-nums ${
                    isVoid ? 'text-muted-foreground' : profitColor(grandMargin)
                  }`}
                >
                  {formatBDT(grandProfit)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Margin</span>
                <span
                  className={`text-xl font-bold tabular-nums ${
                    isVoid ? 'text-muted-foreground' : profitColor(grandMargin)
                  }`}
                >
                  {grandMargin.toFixed(1)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
