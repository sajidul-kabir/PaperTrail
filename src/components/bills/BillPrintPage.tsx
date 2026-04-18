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

  const ROWS_PER_PAGE = 15
  // Chunk lines into pages
  const pages: PrintLine[][] = []
  for (let i = 0; i < data.lines.length; i += ROWS_PER_PAGE) {
    pages.push(data.lines.slice(i, i + ROWS_PER_PAGE))
  }
  if (pages.length === 0) pages.push([])
  const lastPageLines = pages[pages.length - 1]
  const emptyRows = lastPageLines.length < ROWS_PER_PAGE ? ROWS_PER_PAGE - lastPageLines.length : 0

  return (
    <>
      <style>{`
        @media print {
          @page { size: 5.83in 8.27in; margin: 1.5in 0 0 0; }
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .bill-page {
            width: 5.83in !important;
            max-width: none !important; padding: 0 !important;
            margin: 0 !important; border: none !important;
            border-radius: 0 !important; box-shadow: none !important;
          }
          .bill-table tr { page-break-inside: avoid; }
          .bill-footer-table { page-break-inside: avoid; }
          .signature-line { page-break-inside: avoid; }
        }
        .bill-page-wrapper {
          transform: scale(1.4); transform-origin: top center;
          margin-bottom: 200px;
        }
        @media print { .bill-page-wrapper { transform: none !important; margin-bottom: 0 !important; } }
        .bill-page {
          width: 5.83in; margin: 0 auto;
          background: white; color: black;
          font-family: 'Noto Sans Bengali', 'Kalpurush', system-ui, sans-serif;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        .bill-page * { color: black; }
        .bill-header-spacer {
          height: 1.5in;
        }
        @media print { .bill-header-spacer { display: none; } }
        .bill-number-row {
          display: flex; justify-content: flex-end;
          padding: 0 1in; font-size: 13px; font-weight: 700;
          margin-bottom: 4px;
        }
        .bill-body { padding: 4px 1in 8px; }
        .bill-date { text-align: right; font-size: 11px; margin-bottom: 8px; }
        .customer-info { font-size: 11.5px; margin-bottom: 10px; line-height: 1.6; }
        .customer-info .label { font-weight: 400; }
        .customer-info .dots { flex: 1; border-bottom: 1px dotted #999; margin: 0 4px; min-width: 20px; }
        .customer-info .value { font-weight: 600; }
        .bill-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 0; }
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

      <div className="no-print flex items-center justify-between p-4 max-w-[5.83in] mx-auto mb-2">
        <Button variant="outline" onClick={() => navigate('/bills')}>Back to Bills</Button>
        <Button onClick={() => window.print()}>Print Again</Button>
      </div>

      <div className="bill-page-wrapper">
      {pages.map((pageLines, pageIdx) => {
        const isFirst = pageIdx === 0
        const isLast = pageIdx === pages.length - 1
        const pageEmptyRows = isLast ? emptyRows : 0

        return (
          <div key={pageIdx} className="bill-page" style={!isLast ? { pageBreakAfter: 'always' } : undefined}>
            {/* Spacer for pre-printed letterhead (screen preview only, print uses @page margin) */}
            <div className="bill-header-spacer" />

            {isFirst && (
              <>
                <div className="bill-number-row">{data.invoice_number}</div>
                <div className="bill-body">
                  <div className="bill-date">তারিখ ঃ {formatDateBN(data.bill_date)}</div>
                  <div className="customer-info">
                    <div style={{ display: 'flex', alignItems: 'baseline' }}>
                      <span className="label">প্রতিষ্ঠানের নাম ঃ</span>
                      <span className="dots" />
                      <span className="value">{data.customer_display}</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {!isFirst && (
              <div className="bill-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '6px', color: '#666' }}>
                  <span>{data.invoice_number}</span>
                  <span>পৃষ্ঠা {pageIdx + 1}/{pages.length}</span>
                </div>
              </div>
            )}

            <div style={{ padding: '0 1in' }}>
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
                  {pageLines.map((line, i) => {
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
                  {Array.from({ length: pageEmptyRows }).map((_, i) => (
                    <tr key={`empty-${i}`}>
                      <td>&nbsp;</td><td></td><td></td><td></td><td></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {isLast && (
                <>
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
                </>
              )}
            </div>
          </div>
        )
      })}
      </div>
    </>
  )
}
