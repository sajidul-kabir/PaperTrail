import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { dbQuery, dbTransaction } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, poishaToBdt, bdtToPoisha, formatSize } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemoLine {
  id: string
  paper_type_id: string | null
  accessory_id: string | null
  cut_width_inches: number | null
  cut_height_inches: number | null
  quantity_pieces: number
  selling_price_per_piece_poisha: number
  line_total_poisha: number
  cost_per_piece_poisha: number
  cost_total_poisha: number
  profit_poisha: number
  profit_margin_pct: number
  label: string | null
}

interface MemoData {
  customer_id: string
  customer_name: string
  customer_organization: string | null
  bill_date: string
  order_ids: string[]
  lines: MemoLine[]
  outstanding_poisha: number
}

async function generateBillNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const rows = await dbQuery<{ invoice_number: string }>(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1`,
    [`${year}-%`]
  )
  let next = 1
  if (rows.length > 0) {
    const parts = rows[0].invoice_number.split('-')
    if (parts.length === 2) {
      const n = parseInt(parts[1], 10)
      if (!isNaN(n)) next = n + 1
    }
  }
  return `${year}-${String(next).padStart(4, '0')}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MemoPage() {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [payingNow, setPayingNow] = useState('')

  const memo = useMemo<MemoData | null>(() => {
    try {
      const raw = sessionStorage.getItem('memoData')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }, [])

  if (!memo) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-4">
        <p className="text-muted-foreground">No memo data found.</p>
        <Button onClick={() => navigate('/bills')}>Back to Bills</Button>
      </div>
    )
  }

  const customerDisplay = memo.customer_organization || memo.customer_name
  const billTotal = memo.lines.reduce((a, l) => a + l.line_total_poisha, 0)
  const outstanding = memo.outstanding_poisha
  const grandTotal = billTotal + outstanding
  const payingPoisha = payingNow ? bdtToPoisha(parseFloat(payingNow) || 0) : 0
  const remaining = grandTotal - payingPoisha

  async function handleConfirm() {
    setSaving(true)
    try {
      const invoiceId = uuid()
      const invoiceNumber = await generateBillNumber()
      const statements: { sql: string; params: any[] }[] = []

      // Create invoice
      statements.push({
        sql: `INSERT INTO invoices (id, invoice_number, invoice_date, customer_id, subtotal_poisha, total_poisha, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', datetime('now'))`,
        params: [invoiceId, invoiceNumber, memo.bill_date, memo.customer_id, billTotal, billTotal],
      })

      // Create invoice_lines
      for (const line of memo.lines) {
        statements.push({
          sql: `INSERT INTO invoice_lines (id, invoice_id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_sheets, selling_price_per_sheet_poisha, area_ratio, full_sheets_consumed, cost_per_full_sheet_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, waste_sheets, line_total_poisha)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [uuid(), invoiceId, line.paper_type_id, line.accessory_id, line.cut_width_inches, line.cut_height_inches,
            line.quantity_pieces, Math.round(line.selling_price_per_piece_poisha), 1, line.quantity_pieces,
            Math.round(line.cost_per_piece_poisha), line.cost_total_poisha, line.profit_poisha, line.profit_margin_pct, 0, line.line_total_poisha],
        })
      }

      // Update orders to BILLED
      for (const orderId of memo.order_ids) {
        statements.push({
          sql: `UPDATE orders SET status = 'BILLED', invoice_id = ? WHERE id = ?`,
          params: [invoiceId, orderId],
        })
      }

      // Record payment if any
      if (payingPoisha > 0) {
        statements.push({
          sql: `INSERT INTO payments (id, customer_id, amount_poisha, payment_date, payment_method, notes, created_at) VALUES (?, ?, ?, ?, 'CASH', ?, datetime('now'))`,
          params: [uuid(), memo.customer_id, payingPoisha, memo.bill_date, `Bill ${invoiceNumber}`],
        })
      }

      await dbTransaction(statements)
      sessionStorage.removeItem('memoData')

      // Store print data
      sessionStorage.setItem('billPrintData', JSON.stringify({
        invoice_number: invoiceNumber,
        bill_date: memo.bill_date,
        customer_display: customerDisplay,
        customer_name: memo.customer_name,
        lines: memo.lines,
        bill_total: billTotal,
        outstanding,
        grand_total: grandTotal,
        paying_now: payingPoisha,
        remaining,
      }))

      navigate(`/bills/${invoiceId}/print`)
    } catch (err: any) {
      addToast({ title: 'Failed', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-0 p-4 max-w-2xl mx-auto">
      {/* Memo view — same layout as print */}
      <div style={{ background: 'white', color: 'black', border: '1px solid #ddd', borderRadius: '8px', padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '14px' }}>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>MEMO</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '14px' }}>
          <div>
            <span style={{ color: '#666' }}>Customer: </span>
            <span style={{ fontWeight: 600 }}>{customerDisplay}</span>
          </div>
          <div>
            <span style={{ color: '#666' }}>Date: </span>
            <span style={{ fontWeight: 600 }}>{formatDate(memo.bill_date)}</span>
          </div>
        </div>

        {/* Items table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', fontWeight: 600 }}>Size</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Description</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', fontWeight: 600 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {memo.lines.map((line, i) => {
              const size = (line.cut_width_inches && line.cut_height_inches)
                ? formatSize(line.cut_width_inches, line.cut_height_inches)
                : '—'
              return (
                <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '6px 8px 6px 0', fontVariantNumeric: 'tabular-nums' }}>{size}</td>
                  <td style={{ padding: '6px 8px' }}>{line.label || 'Item'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.quantity_pieces.toLocaleString()}</td>
                  <td style={{ padding: '6px 0 6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{formatBDT(line.line_total_poisha)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Totals section */}
        <div style={{ borderTop: '2px solid #333', paddingTop: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0' }}>
            <span>Bill Total</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatBDT(billTotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', color: '#666' }}>
            <span>Outstanding Balance</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{outstanding > 0 ? formatBDT(outstanding) : '৳0.00'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '8px 0 4px', fontWeight: 700, borderTop: '1px solid #999' }}>
            <span>Grand Total</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBDT(grandTotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', padding: '8px 0 4px', borderTop: '1px solid #ddd' }}>
            <span>Paying Now</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#666' }}>৳</span>
              <Input className="h-8 w-32 text-right tabular-nums font-semibold" type="number" min="0" step="1"
                style={{ color: 'black', background: 'white', border: '1px solid #ccc' }}
                placeholder="0" value={payingNow} onChange={e => setPayingNow(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '8px 0 4px', fontWeight: 700, borderTop: '1px solid #999' }}>
            <span>Remaining</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: remaining > 0 ? '#dc2626' : '#16a34a' }}>
              {formatBDT(Math.max(0, remaining))}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={() => navigate('/bills')} disabled={saving}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={saving}>
          {saving ? 'Saving...' : 'Confirm & Print'}
        </Button>
      </div>
    </div>
  )
}
