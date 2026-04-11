import { useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { formatBDT, formatDate, formatSize } from '@/lib/utils'

interface PrintLine {
  cut_width_inches: number | null
  cut_height_inches: number | null
  quantity_pieces: number
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
      // Small delay to let the page render, then print
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

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          @page {
            size: 5.5in 8.5in;
            margin: 0.3in;
          }
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .print-area {
            width: 100% !important;
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            background: white !important;
            color: black !important;
            font-size: 11px !important;
          }
          .print-area * {
            color: black !important;
            border-color: #333 !important;
          }
          .print-area table { font-size: 11px !important; }
          .print-area .memo-header { font-size: 16px !important; }
          .print-area .memo-bill-no { font-size: 10px !important; }
        }
        .print-area {
          width: 5.5in;
          min-height: 8.5in;
          margin: 0 auto;
          padding: 0.3in;
          background: white !important;
          color: black !important;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        .print-area * {
          color: black !important;
          border-color: #333 !important;
        }
      `}</style>

      {/* Screen-only actions */}
      <div className="no-print flex items-center justify-between p-4 max-w-[5.5in] mx-auto mb-2">
        <Button variant="outline" onClick={() => navigate('/bills')}>Back to Bills</Button>
        <Button onClick={() => window.print()}>Print Again</Button>
      </div>

      {/* Print area — identical layout to memo */}
      <div className="print-area border rounded-lg" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '8px', marginBottom: '12px' }}>
          <div className="memo-header" style={{ fontSize: '18px', fontWeight: 'bold' }}>MEMO</div>
          <div className="memo-bill-no" style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>Bill # {data.invoice_number}</div>
        </div>

        {/* Customer + Date */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '12px' }}>
          <div>
            <span style={{ color: '#666' }}>Customer: </span>
            <span style={{ fontWeight: 600 }}>{data.customer_display}</span>
          </div>
          <div>
            <span style={{ color: '#666' }}>Date: </span>
            <span style={{ fontWeight: 600 }}>{formatDate(data.bill_date)}</span>
          </div>
        </div>

        {/* Items table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px 4px 0', fontWeight: 600 }}>Size</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Description</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '4px 0 4px 6px', fontWeight: 600 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, i) => {
              const size = (line.cut_width_inches && line.cut_height_inches)
                ? formatSize(line.cut_width_inches, line.cut_height_inches)
                : '—'
              return (
                <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '4px 6px 4px 0', fontVariantNumeric: 'tabular-nums' }}>{size}</td>
                  <td style={{ padding: '4px 6px' }}>{line.label || 'Item'}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.quantity_pieces.toLocaleString()}</td>
                  <td style={{ padding: '4px 0 4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{formatBDT(line.line_total_poisha)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ borderTop: '2px solid #333', paddingTop: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0' }}>
            <span>Bill Total</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatBDT(data.bill_total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', color: '#666' }}>
            <span>Outstanding Balance</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.outstanding > 0 ? formatBDT(data.outstanding) : '৳0.00'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '6px 0 3px', fontWeight: 700, borderTop: '1px solid #999' }}>
            <span>Grand Total</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBDT(data.grand_total)}</span>
          </div>
          {data.paying_now > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', borderTop: '1px solid #ddd' }}>
              <span>Paid</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatBDT(data.paying_now)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '6px 0 3px', fontWeight: 700, borderTop: '1px solid #999' }}>
            <span>Due</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBDT(Math.max(0, data.remaining))}</span>
          </div>
        </div>
      </div>
    </>
  )
}
