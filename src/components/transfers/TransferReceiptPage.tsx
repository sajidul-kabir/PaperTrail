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
          @page { size: 3in auto; margin: 0.15in; }
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .receipt {
            width: 100% !important; max-width: none !important;
            padding: 0 !important; margin: 0 !important;
            border: none !important; border-radius: 0 !important;
            box-shadow: none !important;
          }
        }
        .receipt-wrapper {
          transform: scale(1.8); transform-origin: top center;
          margin-bottom: 300px;
        }
        @media print { .receipt-wrapper { transform: none !important; margin-bottom: 0 !important; } }
        .receipt {
          width: 3in; margin: 0 auto;
          background: white; color: black;
          font-family: 'Consolas', 'Courier New', monospace;
          font-size: 10px; line-height: 1.3;
          padding: 8px;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          border: 1px solid #ddd; border-radius: 4px;
        }
        .receipt * { color: black; }
        .receipt .r-header {
          text-align: center; border-bottom: 1px dashed #333;
          padding-bottom: 4px; margin-bottom: 4px;
        }
        .receipt .r-header .shop { font-size: 11px; font-weight: 700; }
        .receipt .r-header .sub { font-size: 8px; opacity: 0.7; }
        .receipt .r-title {
          text-align: center; font-weight: 700; font-size: 11px;
          margin: 4px 0; letter-spacing: 1px;
        }
        .receipt .r-meta { margin-bottom: 4px; }
        .receipt .r-meta div { display: flex; justify-content: space-between; }
        .receipt .r-divider { border-top: 1px dashed #333; margin: 3px 0; }
        .receipt .r-total {
          display: flex; justify-content: space-between;
          font-weight: 700; font-size: 11px; padding: 3px 0;
        }
        .receipt .r-footer { text-align: center; font-size: 8px; opacity: 0.6; margin-top: 6px; padding-top: 4px; border-top: 1px dashed #333; }
        .receipt table { width: 100%; border-collapse: collapse; font-size: 9px; }
        .receipt th { padding: 2px 2px; font-weight: 700; text-align: left; border-bottom: 1px solid #333; white-space: nowrap; }
        .receipt th.r { text-align: right; }
        .receipt td { padding: 2px 2px; border-bottom: 1px dotted #ccc; white-space: nowrap; }
        .receipt td.r { text-align: right; }
        .receipt td.b { font-weight: 600; }
      `}</style>

      <div className="no-print flex items-center justify-between p-4 max-w-[3in] mx-auto mb-2">
        <Button variant="outline" size="sm" onClick={() => navigate('/transfers')}>Back</Button>
        <Button size="sm" onClick={() => window.print()}>Print Again</Button>
      </div>

      <div className="receipt-wrapper">
      <div className="receipt">
        <div className="r-header">
          <div className="shop">নুকতা অফসেট প্রেস</div>
          <div className="sub">গোডাউন → কাটিং ট্রান্সফার</div>
        </div>

        <div className="r-title">TRANSFER RECEIPT</div>

        <div className="r-meta">
          <div><span>No:</span><span style={{ fontWeight: 600 }}>{data.transfer_number}</span></div>
          <div><span>Date:</span><span>{formatDateShort(data.transfer_date)}</span></div>
          {data.notes && <div><span>Note:</span><span>{data.notes}</span></div>}
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
      </div>
      </div>
    </>
  )
}
