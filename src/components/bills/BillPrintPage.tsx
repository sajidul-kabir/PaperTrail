import { useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { formatBDT, formatSize } from '@/lib/utils'

interface PrintLine {
  cut_width_inches: number | null
  cut_height_inches: number | null
  quantity_pieces: number
  selling_price_per_piece_poisha: number
  line_total_poisha: number
  label: string | null
}

interface PrintData {
  invoice_number: string
  bill_date: string
  customer_display: string
  customer_name: string
  lines: PrintLine[]
  bill_total: number
  outstanding: number
  grand_total: number
  paying_now: number
  remaining: number
}

function formatDateBN(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTaka(poisha: number): string {
  const bdt = poisha / 100
  return bdt.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function BillPrintPage() {
  const navigate = useNavigate()

  const data = useMemo<PrintData | null>(() => {
    try {
      const raw = sessionStorage.getItem('billPrintData')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }, [])

  useEffect(() => {
    if (data) {
      const timer = setTimeout(() => window.print(), 400)
      return () => clearTimeout(timer)
    }
  }, [data])

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-4">
        <p className="text-muted-foreground">No print data found.</p>
        <Button onClick={() => navigate('/bills')}>Back to Bills</Button>
      </div>
    )
  }

  const emptyRows = Math.max(0, 12 - data.lines.length)

  return (
    <>
      <style>{`
        @media print {
          @page { size: 5.5in 8.5in; margin: 0; }
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .bill-page {
            width: 5.5in !important; min-height: 8.5in !important;
            max-width: none !important; padding: 0 !important;
            margin: 0 !important; border: none !important;
            border-radius: 0 !important; box-shadow: none !important;
          }
        }
        .bill-page-wrapper {
          transform: scale(1.4); transform-origin: top center;
          margin-bottom: 200px;
        }
        @media print { .bill-page-wrapper { transform: none !important; margin-bottom: 0 !important; } }
        .bill-page {
          width: 5.5in; min-height: 8.5in; margin: 0 auto;
          background: white; color: black;
          font-family: 'Noto Sans Bengali', 'Kalpurush', system-ui, sans-serif;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          display: flex; flex-direction: column;
        }
        .bill-page * { color: black; }
        .bill-header {
          background: linear-gradient(135deg, #0d7377, #14919b);
          color: white !important; padding: 12px 16px 10px;
          text-align: center; position: relative;
        }
        .bill-header * { color: white !important; }
        .bill-header h1 { font-size: 20px; font-weight: 700; margin: 0 0 2px; letter-spacing: 0.5px; }
        .bill-header .subtitle { font-size: 10px; margin: 0 0 3px; opacity: 0.9; }
        .bill-header .address { font-size: 9.5px; margin: 0 0 2px; opacity: 0.85; }
        .bill-header .mobile { font-size: 11px; font-weight: 600; margin: 0; }
        .bill-number {
          position: absolute; top: 10px; left: 14px;
          font-size: 14px; font-weight: 700; color: #fcd34d !important;
        }
        .memo-badge {
          position: absolute; bottom: -1px; left: 14px;
          background: #dc2626; color: white !important;
          font-size: 11px; font-weight: 700; padding: 2px 10px;
          border-radius: 4px 4px 0 0;
        }
        .bill-body { padding: 14px 16px 8px; flex: 1; display: flex; flex-direction: column; }
        .bill-date { text-align: right; font-size: 11px; margin-bottom: 8px; }
        .customer-info { font-size: 11.5px; margin-bottom: 10px; line-height: 1.6; }
        .customer-info .label { font-weight: 400; }
        .customer-info .dots { flex: 1; border-bottom: 1px dotted #999; margin: 0 4px; min-width: 20px; }
        .customer-info .value { font-weight: 600; }
        .bill-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: auto; }
        .bill-table th {
          border: 1px solid #444; padding: 4px 5px; font-weight: 700;
          text-align: center; background: #f5f5f0;
        }
        .bill-table td {
          border: 1px solid #888; padding: 3px 5px;
          font-variant-numeric: tabular-nums;
        }
        .bill-table td.text-r { text-align: right; }
        .bill-table td.text-c { text-align: center; }
        .bill-footer-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .bill-footer-table td {
          border: 1px solid #888; padding: 3px 5px;
          font-variant-numeric: tabular-nums;
        }
        .bill-footer-table .label-cell { font-weight: 700; text-align: right; }
        .bill-footer-table .amount-cell { text-align: right; font-weight: 600; }
        .signature-line {
          text-align: center; font-size: 10px; margin-top: 16px;
          padding-top: 4px; border-top: 1px solid #444; width: 120px;
          margin-left: auto; margin-right: auto;
        }
      `}</style>

      <div className="no-print flex items-center justify-between p-4 max-w-[5.5in] mx-auto mb-2">
        <Button variant="outline" onClick={() => navigate('/bills')}>Back to Bills</Button>
        <Button onClick={() => window.print()}>Print Again</Button>
      </div>

      <div className="bill-page-wrapper">
      <div className="bill-page">
        {/* Teal Header */}
        <div className="bill-header">
          <div className="bill-number">{data.invoice_number}</div>
          <h1>নুকতা অফসেট প্রেস এন্ড পেপার হাউজ</h1>
          <p className="subtitle">দেশী-বিদেশী কাগজ বিক্রয় ও প্রিন্টিং কাজের অর্ডার নেওয়া হয়।</p>
          <p className="address">হক সুপার মার্কেট, চিটাগারোড, সিদ্ধিরগঞ্জ, নারায়ণগঞ্জ।</p>
          <p className="mobile">মোবাইল ঃ ০১৮১৯-১৫৩৩৮০</p>
          <div className="memo-badge">ক্যাশ মেমো</div>
        </div>

        <div className="bill-body">
          {/* Date */}
          <div className="bill-date">তারিখ ঃ {formatDateBN(data.bill_date)}</div>

          {/* Customer Info */}
          <div className="customer-info">
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <span className="label">প্রতিষ্ঠানের নাম ঃ</span>
              <span className="dots" />
              <span className="value">{data.customer_display}</span>
            </div>
          </div>

          {/* Items Table */}
          <table className="bill-table">
            <thead>
              <tr>
                <th style={{ width: '18%' }}>সাইজ</th>
                <th>বিবরণ</th>
                <th style={{ width: '14%' }}>পরিমাণ</th>
                <th style={{ width: '14%' }}>দর</th>
                <th style={{ width: '16%' }}>টাকা</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, i) => {
                const size = (line.cut_width_inches && line.cut_height_inches)
                  ? formatSize(line.cut_width_inches, line.cut_height_inches) : '—'
                return (
                  <tr key={i}>
                    <td className="text-c">{size}</td>
                    <td>{line.label || 'Item'}</td>
                    <td className="text-r">{line.quantity_pieces.toLocaleString()}</td>
                    <td className="text-r">{formatTaka(line.selling_price_per_piece_poisha)}</td>
                    <td className="text-r">{formatTaka(line.line_total_poisha)}</td>
                  </tr>
                )
              })}
              {/* Empty rows to fill the table */}
              {Array.from({ length: emptyRows }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td>&nbsp;</td><td></td><td></td><td></td><td></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer totals */}
          <table className="bill-footer-table">
            <tbody>
              <tr>
                <td colSpan={3} rowSpan={5} style={{ border: '1px solid #888', verticalAlign: 'top', fontSize: '10px', color: '#666' }}></td>
                <td className="label-cell" style={{ border: '1px solid #888' }}>মোট</td>
                <td className="amount-cell" style={{ border: '1px solid #888', width: '16%' }}>{formatTaka(data.bill_total)}</td>
              </tr>
              <tr>
                <td className="label-cell" style={{ border: '1px solid #888' }}>সাবেক</td>
                <td className="amount-cell" style={{ border: '1px solid #888' }}>{data.outstanding > 0 ? formatTaka(data.outstanding) : '—'}</td>
              </tr>
              <tr>
                <td className="label-cell" style={{ border: '1px solid #888' }}>সর্বমোট</td>
                <td className="amount-cell" style={{ border: '1px solid #888', fontWeight: 700 }}>{formatTaka(data.grand_total)}</td>
              </tr>
              <tr>
                <td className="label-cell" style={{ border: '1px solid #888' }}>জমা</td>
                <td className="amount-cell" style={{ border: '1px solid #888' }}>{data.paying_now > 0 ? formatTaka(data.paying_now) : '—'}</td>
              </tr>
              <tr>
                <td className="label-cell" style={{ border: '1px solid #888' }}>বাকী</td>
                <td className="amount-cell" style={{ border: '1px solid #888', fontWeight: 700 }}>{formatTaka(Math.max(0, data.remaining))}</td>
              </tr>
            </tbody>
          </table>

          <div className="signature-line">স্বাক্ষর</div>
        </div>
      </div>
      </div>
    </>
  )
}
