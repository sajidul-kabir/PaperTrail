import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { dbQuery, dbTransaction } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { formatSize, bdtToPoisha, billSize, billLabel } from '@/lib/utils'

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

function formatDateBN(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTaka(poisha: number): string {
  const bdt = poisha / 100
  return bdt.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
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
  const emptyRows = Math.max(0, 8 - memo.lines.length)

  async function handleConfirm() {
    setSaving(true)
    try {
      const invoiceId = uuid()
      const invoiceNumber = await generateBillNumber()
      const statements: { sql: string; params: any[] }[] = []

      statements.push({
        sql: `INSERT INTO invoices (id, invoice_number, invoice_date, customer_id, subtotal_poisha, total_poisha, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', datetime('now'))`,
        params: [invoiceId, invoiceNumber, memo.bill_date, memo.customer_id, billTotal, billTotal],
      })

      for (const line of memo.lines) {
        statements.push({
          sql: `INSERT INTO invoice_lines (id, invoice_id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_sheets, selling_price_per_sheet_poisha, area_ratio, full_sheets_consumed, cost_per_full_sheet_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, waste_sheets, line_total_poisha)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [uuid(), invoiceId, line.paper_type_id, line.accessory_id, line.cut_width_inches, line.cut_height_inches,
            line.quantity_pieces, Math.round(line.selling_price_per_piece_poisha), 1, line.quantity_pieces,
            Math.round(line.cost_per_piece_poisha), line.cost_total_poisha, line.profit_poisha, line.profit_margin_pct, 0, line.line_total_poisha],
        })
      }

      for (const orderId of memo.order_ids) {
        statements.push({
          sql: `UPDATE orders SET status = 'BILLED', invoice_id = ? WHERE id = ?`,
          params: [invoiceId, orderId],
        })
      }

      if (payingPoisha > 0) {
        statements.push({
          sql: `INSERT INTO payments (id, customer_id, amount_poisha, payment_date, payment_method, notes, created_at) VALUES (?, ?, ?, ?, 'CASH', ?, datetime('now'))`,
          params: [uuid(), memo.customer_id, payingPoisha, memo.bill_date, `Bill ${invoiceNumber}`],
        })
      }

      await dbTransaction(statements)
      sessionStorage.removeItem('memoData')

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
    <div className="flex flex-col gap-0 p-4 max-w-[5.5in] mx-auto">
      <style>{`
        .memo-preview { background: white; color: black; font-family: 'Noto Sans Bengali', 'Kalpurush', system-ui, sans-serif; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
        .memo-preview * { color: black; }
        .memo-preview .memo-hdr { background: linear-gradient(135deg, #0d7377, #14919b); color: white !important; padding: 12px 16px 10px; text-align: center; position: relative; }
        .memo-preview .memo-hdr * { color: white !important; }
        .memo-preview .memo-hdr h1 { font-size: 18px; font-weight: 700; margin: 0 0 2px; }
        .memo-preview .memo-hdr .sub { font-size: 9.5px; margin: 0 0 2px; opacity: 0.9; }
        .memo-preview .memo-hdr .addr { font-size: 9px; margin: 0 0 2px; opacity: 0.85; }
        .memo-preview .memo-hdr .mob { font-size: 10.5px; font-weight: 600; margin: 0; }
        .memo-preview .bno { position: absolute; top: 8px; left: 12px; font-size: 13px; font-weight: 700; color: #fcd34d !important; }
        .memo-preview .mbadge { position: absolute; bottom: -1px; left: 12px; background: #dc2626; color: white !important; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px 4px 0 0; }
        .memo-preview .memo-body { padding: 12px 16px 8px; }
        .memo-preview table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .memo-preview th { border: 1px solid #444; padding: 3px 4px; font-weight: 700; text-align: center; background: #f5f5f0; }
        .memo-preview td { border: 1px solid #888; padding: 2px 4px; font-variant-numeric: tabular-nums; }
        .memo-preview td.r { text-align: right; }
        .memo-preview td.c { text-align: center; }
        .memo-preview .lbl { font-weight: 700; text-align: right; }
        .memo-preview .amt { text-align: right; font-weight: 600; }
      `}</style>

      <div className="memo-preview">
        <div className="memo-hdr">
          <div className="bno">Preview</div>
          <h1>নুকতা অফসেট প্রেস এন্ড পেপার হাউজ</h1>
          <p className="sub">দেশী-বিদেশী কাগজ বিক্রয় ও প্রিন্টিং কাজের অর্ডার নেওয়া হয়।</p>
          <p className="addr">হক সুপার মার্কেট, চিটাগারোড, সিদ্ধিরগঞ্জ, নারায়ণগঞ্জ।</p>
          <p className="mob">মোবাইল :০১৮১৯-১৫৩৩৮০</p>
          <div className="mbadge">Cash Memo</div>
        </div>

        <div className="memo-body">
          <div style={{ textAlign: 'right', fontSize: '11px', marginBottom: '6px' }}>Date : {formatDateBN(memo.bill_date)}</div>
          <div style={{ fontSize: '11px', marginBottom: '8px', display: 'flex', alignItems: 'baseline' }}>
            <span>Customer :</span>
            <span style={{ flex: 1, borderBottom: '1px dotted #999', margin: '0 4px' }} />
            <span style={{ fontWeight: 600 }}>{customerDisplay}</span>
          </div>

          <table style={{ marginBottom: '0' }}>
            <thead>
              <tr>
                <th style={{ width: '18%' }}>Size</th>
                <th>Description</th>
                <th style={{ width: '14%' }}>Qty</th>
                <th style={{ width: '14%' }}>Rate</th>
                <th style={{ width: '16%' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {memo.lines.map((line, i) => {
                const size = (line.cut_width_inches && line.cut_height_inches)
                  ? billSize(line.cut_width_inches, line.cut_height_inches) : '—'
                return (
                  <tr key={i}>
                    <td className="c">{size}</td>
                    <td>{billLabel(line.label)}</td>
                    <td className="r">{line.quantity_pieces.toLocaleString()}</td>
                    <td className="r">{formatTaka(line.selling_price_per_piece_poisha)}</td>
                    <td className="r">{formatTaka(line.line_total_poisha)}</td>
                  </tr>
                )
              })}
              {Array.from({ length: emptyRows }).map((_, i) => (
                <tr key={`e-${i}`}><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
              ))}
            </tbody>
          </table>

          <table style={{ marginBottom: '8px' }}>
            <tbody>
              <tr>
                <td colSpan={3} rowSpan={5} style={{ border: '1px solid #888', verticalAlign: 'top' }}></td>
                <td className="lbl" style={{ border: '1px solid #888' }}>Total</td>
                <td className="amt" style={{ border: '1px solid #888', width: '16%' }}>{formatTaka(billTotal)}</td>
              </tr>
              <tr>
                <td className="lbl" style={{ border: '1px solid #888' }}>Previous</td>
                <td className="amt" style={{ border: '1px solid #888' }}>{outstanding > 0 ? formatTaka(outstanding) : '—'}</td>
              </tr>
              <tr>
                <td className="lbl" style={{ border: '1px solid #888' }}>Subtotal</td>
                <td className="amt" style={{ border: '1px solid #888', fontWeight: 700 }}>{formatTaka(grandTotal)}</td>
              </tr>
              <tr>
                <td className="lbl" style={{ border: '1px solid #888' }}>Paid</td>
                <td className="amt" style={{ border: '1px solid #888' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
                    <span style={{ fontSize: '9px', opacity: 0.6 }}>৳</span>
                    <Input className="h-6 w-20 text-right tabular-nums text-xs font-semibold p-1"
                      style={{ color: 'black', background: '#fffff0', border: '1px solid #ccc' }}
                      type="number" min="0" step="1" placeholder="0"
                      value={payingNow} onChange={e => setPayingNow(e.target.value)} />
                  </div>
                </td>
              </tr>
              <tr>
                <td className="lbl" style={{ border: '1px solid #888' }}>Due</td>
                <td className="amt" style={{ border: '1px solid #888', fontWeight: 700, color: remaining > 0 ? '#dc2626' : '#16a34a' }}>
                  {formatTaka(Math.max(0, remaining))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={() => navigate('/bills')} disabled={saving}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={saving}>
          {saving ? 'Saving...' : 'Confirm & Print'}
        </Button>
      </div>
    </div>
  )
}
