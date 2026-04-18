import { useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { formatSize } from '@/lib/utils'

interface ReceiptLine {
  product_label: string
  category: string
  brand_name: string
  gsm_value: number
  sheet_width: number
  sheet_height: number
  cut_width_inches: number | null
  cut_height_inches: number | null
  quantity_units: number
  unit_label: string
  quantity_sheets: number
  pieces_per_sheet: number
  total_cut_pieces: number
}

interface ReceiptData {
  transfer_number: string
  transfer_date: string
  notes: string | null
  lines: ReceiptLine[]
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function TransferReceiptPage() {
  const navigate = useNavigate()

  const data = useMemo<ReceiptData | null>(() => {
    try {
      const raw = sessionStorage.getItem('transferReceiptData')
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
        <p className="text-muted-foreground">No receipt data found.</p>
        <Button onClick={() => navigate('/transfers')}>Back to Transfers</Button>
      </div>
    )
  }

  const totalPieces = data.lines.reduce((a, l) => a + l.total_cut_pieces, 0)

  return (
    <>
      <style>{`
        @media print {
          @page { size: 5.83in 8.27in; margin: 1.5in 0 0 0; }
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .receipt {
            width: 5.83in !important; max-width: none !important;
            padding: 0 !important; margin: 0 !important;
            border: none !important; border-radius: 0 !important;
            box-shadow: none !important;
          }
          .receipt tr { page-break-inside: avoid; }
          .r-total { page-break-inside: avoid; }
        }
        .receipt-wrapper {
          transform: scale(1.4); transform-origin: top center;
          margin-bottom: 200px;
        }
        @media print { .receipt-wrapper { transform: none !important; margin-bottom: 0 !important; } }
        .receipt {
          width: 5.83in; margin: 0 auto;
          background: white; color: black;
          font-family: 'Noto Sans Bengali', 'Kalpurush', system-ui, sans-serif;
          font-size: 15px; line-height: 1.5;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          border: 1px solid #ddd; border-radius: 4px;
        }
        .receipt * { color: black; }
        .receipt .r-spacer { height: 1.5in; }
        @media print { .receipt .r-spacer { display: none; } }
        .receipt .r-title {
          text-align: center; font-weight: 700; font-size: 18px;
          margin: 6px 0; letter-spacing: 1px;
        }
        .receipt .r-body { padding: 6px 0.6in 10px; }
        .receipt .r-meta { margin-bottom: 8px; }
        .receipt .r-meta div { display: flex; justify-content: space-between; font-size: 15px; }
        .receipt .r-divider { border-top: 1px solid #333; margin: 6px 0; }
        .receipt .r-total {
          display: flex; justify-content: space-between;
          font-weight: 700; font-size: 16px; padding: 6px 0;
        }
        .receipt .r-footer { text-align: center; font-size: 12px; opacity: 0.6; margin-top: 10px; padding-top: 6px; border-top: 1px solid #333; }
        .receipt table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .receipt th { padding: 5px 6px; font-weight: 700; text-align: left; border-bottom: 1px solid #333; }
        .receipt th.r { text-align: right; }
        .receipt td { padding: 5px 6px; border-bottom: 1px dotted #ccc; }
        .receipt td.r { text-align: right; }
        .receipt td.b { font-weight: 600; }
      `}</style>

      <div className="no-print flex items-center justify-between p-4 max-w-[5.83in] mx-auto mb-2">
        <Button variant="outline" size="sm" onClick={() => navigate('/transfers')}>Back</Button>
        <Button size="sm" onClick={() => window.print()}>Print Again</Button>
      </div>

      <div className="receipt-wrapper">
      <div className="receipt">
        {/* 3-inch spacer for pre-printed letterhead */}
        <div className="r-spacer" />

        <div className="r-body">
        <div className="r-title">ট্রান্সফার রিসিট</div>

        <div className="r-meta">
          <div><span>নং:</span><span style={{ fontWeight: 600 }}>{data.transfer_number}</span></div>
          <div><span>তারিখ:</span><span>{formatDateShort(data.transfer_date)}</span></div>
          {data.notes && <div><span>নোট:</span><span>{data.notes}</span></div>}
        </div>

        <div className="r-divider" />

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>GSM</th>
              <th>Cut</th>
              <th>Cut Size</th>
              <th className="r">Pcs</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, i) => {
              const isAcc = line.category === 'ACCESSORY'
              const itemName = isAcc
                ? line.product_label
                : `${line.brand_name} ${formatSize(line.sheet_width, line.sheet_height)}`
              const cutSize = (!isAcc && line.cut_width_inches && line.cut_height_inches)
                ? formatSize(line.cut_width_inches, line.cut_height_inches) : '—'
              const cutQty = isAcc
                ? `${line.quantity_units} pcs`
                : `${line.quantity_units} ${line.unit_label}`
              return (
                <tr key={i}>
                  <td>{itemName}</td>
                  <td>{isAcc ? '—' : line.gsm_value}</td>
                  <td>{cutQty}</td>
                  <td>{cutSize}</td>
                  <td className="r b">{line.total_cut_pieces.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="r-divider" />

        <div className="r-total">
          <span>Total Pieces:</span><span>{totalPieces.toLocaleString()}</span>
        </div>

        <div className="r-footer">
          PaperTrail &middot; Auto-generated
        </div>
        </div>{/* close r-body */}
      </div>
      </div>
    </>
  )
}
