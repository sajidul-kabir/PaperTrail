import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbQuery, dbTransaction } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { Calendar } from '@/components/ui/calendar'
import * as Popover from '@radix-ui/react-popover'
import { useToast } from '@/components/ui/toast'
import { formatDate, formatNumber, formatSize, todayISO } from '@/lib/utils'
import { unitLabel, paperDisplayType } from '@/lib/paper-type'
import type { Category } from '@/lib/paper-type'
import { ChevronLeft, ChevronRight, CalendarDays, Printer } from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dateToISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isoToDate(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

// ─── SQL ──────────────────────────────────────────────────────────────────────

const TRANSFERS_SQL = `
  SELECT
    t.id, t.transfer_number, t.transfer_date, t.notes, t.created_at,
    tl.id as line_id,
    COALESCE(
      b.name || CASE WHEN pt.variant != '' THEN CASE WHEN pt.variant LIKE 'CB %' OR pt.variant LIKE 'CFB %' OR pt.variant LIKE 'CF %' THEN ' Carbon Paper' ELSE ' Color Paper' END ELSE '' END || ' ' || g.value || 'gsm ' || MIN(p.width_inches, p.height_inches) || 'x' || MAX(p.width_inches, p.height_inches) || CASE WHEN pt.variant != '' THEN ' ' || pt.variant ELSE '' END,
      at_name.name || ' ' || ab.name || ' ' || ag.value || COALESCE(ag.unit, 'lb'),
      'Unknown'
    ) as product_label,
    COALESCE(pt.category, 'ACCESSORY') as category,
    tl.quantity_units,
    tl.quantity_sheets,
    tl.cut_width_inches,
    tl.cut_height_inches,
    tl.pieces_per_sheet,
    tl.total_cut_pieces,
    tl.waste_area_per_sheet,
    tl.paper_type_id,
    tl.accessory_id,
    COALESCE(b.name, at_name.name, '') as brand_name,
    COALESCE(g.value, 0) as gsm_value,
    COALESCE(p.width_inches, 0) as sheet_width,
    COALESCE(p.height_inches, 0) as sheet_height,
    COALESCE(pt.variant, '') as variant
  FROM transfers t
  JOIN transfer_lines tl ON tl.transfer_id = t.id
  LEFT JOIN paper_types pt ON pt.id = tl.paper_type_id
  LEFT JOIN brands b ON b.id = pt.brand_id
  LEFT JOIN gsm_options g ON g.id = pt.gsm_id
  LEFT JOIN proportions p ON p.id = pt.proportion_id
  LEFT JOIN accessories ac ON ac.id = tl.accessory_id
  LEFT JOIN accessory_types at_name ON at_name.id = ac.accessory_type_id
  LEFT JOIN brands ab ON ab.id = ac.brand_id
  LEFT JOIN gsm_options ag ON ag.id = ac.gsm_id
  WHERE t.transfer_date = ?
  ORDER BY t.created_at DESC, tl.ROWID ASC
`

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransferLineRow {
  id: string
  transfer_number: string
  transfer_date: string
  notes: string | null
  created_at: string
  line_id: string
  product_label: string
  category: string
  quantity_units: number
  quantity_sheets: number
  cut_width_inches: number | null
  cut_height_inches: number | null
  pieces_per_sheet: number
  total_cut_pieces: number
  waste_area_per_sheet: number
  paper_type_id: string | null
  accessory_id: string | null
  brand_name: string
  gsm_value: number
  sheet_width: number
  sheet_height: number
  variant: string
}

interface TransferGroup {
  id: string
  transfer_number: string
  transfer_date: string
  notes: string | null
  lines: TransferLineRow[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TransfersPage() {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const today = todayISO()
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const { data: rawRows, loading, error, refetch } = useQuery<TransferLineRow>(TRANSFERS_SQL, [selectedDate], [selectedDate])
  const [deleteTarget, setDeleteTarget] = useState<TransferGroup | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Group rows by transfer
  const groupMap = new Map<string, TransferGroup>()
  for (const row of rawRows) {
    if (!groupMap.has(row.id)) {
      groupMap.set(row.id, {
        id: row.id,
        transfer_number: row.transfer_number,
        transfer_date: row.transfer_date,
        notes: row.notes,
        lines: [],
      })
    }
    groupMap.get(row.id)!.lines.push(row)
  }
  const transfers = Array.from(groupMap.values())

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const cuttingEntries = await dbQuery<{
        paper_type_id: string | null; accessory_id: string | null
        cut_width_inches: number | null; cut_height_inches: number | null
        quantity_pieces: number; cost_per_piece_poisha: number
      }>(
        `SELECT paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, cost_per_piece_poisha
         FROM cutting_stock WHERE reference_id = ? AND transaction_type = 'TRANSFER_IN'`,
        [deleteTarget.id]
      )

      const statements: { sql: string; params: any[] }[] = []

      for (const entry of cuttingEntries) {
        statements.push({
          sql: `INSERT INTO cutting_stock (id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, transaction_type, reference_id, cost_per_piece_poisha, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'ADJUSTMENT', ?, ?, datetime('now'))`,
          params: [uuid(), entry.paper_type_id, entry.accessory_id, entry.cut_width_inches, entry.cut_height_inches,
            -entry.quantity_pieces, deleteTarget.id, entry.cost_per_piece_poisha],
        })
      }

      for (const line of deleteTarget.lines) {
        statements.push({
          sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at)
                VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, datetime('now'))`,
          params: [uuid(), line.paper_type_id, line.accessory_id, line.quantity_sheets, deleteTarget.id],
        })
      }

      statements.push({ sql: `DELETE FROM transfer_lines WHERE transfer_id = ?`, params: [deleteTarget.id] })
      statements.push({ sql: `DELETE FROM transfers WHERE id = ?`, params: [deleteTarget.id] })

      await dbTransaction(statements)
      addToast({ title: 'Transfer deleted', description: `${deleteTarget.transfer_number} reversed. Stock returned to godown.` })
      setDeleteTarget(null)
      refetch()
    } catch (err: any) {
      addToast({ title: 'Delete failed', description: err.message, variant: 'destructive' })
    } finally { setDeleting(false) }
  }

  function categoryBadgeClass(cat: string): string {
    if (cat === 'CARD') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    if (cat === 'STICKER') return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
    if (cat === 'ACCESSORY') return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
    return ''
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
        <Button asChild>
          <Link to="/transfers/new">+ New Transfer</Link>
        </Button>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Popover.Root open={calendarOpen} onOpenChange={setCalendarOpen}>
          <Popover.Trigger asChild>
            <Button variant="outline" className="h-8 gap-2 px-3 text-sm font-medium">
              {formatDate(selectedDate)}<CalendarDays className="h-5 w-5 shrink-0 opacity-60" />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="z-50 rounded-lg border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95" sideOffset={4} align="center">
              <Calendar selected={isoToDate(selectedDate)} onSelect={(d) => { setSelectedDate(dateToISO(d)); setCalendarOpen(false) }} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {selectedDate !== today && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedDate(today)}>Today</Button>
        )}
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading transfers...</div>}
      {error && <div className="text-sm text-destructive">Error: {error}</div>}

      {!loading && !error && transfers.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No transfers on {formatDate(selectedDate)}.</p>
        </div>
      )}

      {!loading && !error && transfers.map(t => {
        const totalPieces = t.lines.reduce((a, l) => a + l.total_cut_pieces, 0)
        const totalSheets = t.lines.reduce((a, l) => a + l.quantity_sheets, 0)

        return (
          <div key={t.id} className="rounded-md border">
            {/* Transfer header */}
            <div className="flex items-center justify-between px-4 py-3 bg-muted/50 border-b">
              <div className="flex items-center gap-4">
                <span className="font-mono font-semibold text-sm">{t.transfer_number}</span>
                {t.notes && <span className="text-xs text-muted-foreground italic">{t.notes}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {t.lines.length} item{t.lines.length !== 1 ? 's' : ''} · {formatNumber(totalSheets)} sheets · {formatNumber(totalPieces)} pieces
                </span>
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => {
                    sessionStorage.setItem('transferReceiptData', JSON.stringify({
                      transfer_number: t.transfer_number,
                      transfer_date: t.transfer_date,
                      notes: t.notes,
                      lines: t.lines.map(l => ({
                        product_label: l.product_label,
                        category: l.category,
                        brand_name: l.brand_name,
                        gsm_value: l.gsm_value,
                        sheet_width: l.sheet_width,
                        sheet_height: l.sheet_height,
                        cut_width_inches: l.cut_width_inches,
                        cut_height_inches: l.cut_height_inches,
                        quantity_units: l.quantity_units,
                        unit_label: unitLabel(l.category as Category),
                        quantity_sheets: l.quantity_sheets,
                        pieces_per_sheet: l.pieces_per_sheet,
                        total_cut_pieces: l.total_cut_pieces,
                      })),
                    }))
                    navigate('/transfers/receipt')
                  }}>
                  <Printer className="h-3 w-3 mr-1" />Print
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => navigate('/transfers/new', { state: { editTransferId: t.id } })}>
                  Edit
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(t)}>
                  Delete
                </Button>
              </div>
            </div>

            {/* Transfer lines table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Cut Size</TableHead>
                  <TableHead className="text-right">Qty (units)</TableHead>
                  <TableHead className="text-right">Sheets</TableHead>
                  <TableHead className="text-right">Pcs/Sheet</TableHead>
                  <TableHead className="text-right">Total Pieces</TableHead>
                  <TableHead className="text-right">Waste/Sheet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.lines.map(line => {
                  const isAcc = line.category === 'ACCESSORY'
                  return (
                    <TableRow key={line.line_id}>
                      <TableCell className="font-medium text-sm">{line.product_label}</TableCell>
                      <TableCell>
                        {(() => {
                          const displayType = line.category === 'PAPER' ? paperDisplayType(line.variant) : line.category
                          const isCarbon = displayType === 'Carbon Paper'
                          const isColor = displayType === 'Color Paper'
                          return <Badge variant={line.category === 'PAPER' && !isCarbon && !isColor ? 'secondary' : 'outline'}
                            className={`text-[10px] px-1.5 py-0 ${isCarbon ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' : isColor ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' : categoryBadgeClass(line.category)}`}>{displayType}</Badge>
                        })()}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {isAcc ? '—' : (line.cut_width_inches && line.cut_height_inches
                          ? formatSize(line.cut_width_inches, line.cut_height_inches) : '—')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{line.quantity_units}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(line.quantity_sheets)}</TableCell>
                      <TableCell className="text-right tabular-nums">{isAcc ? '1' : line.pieces_per_sheet}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{formatNumber(line.total_cut_pieces)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {isAcc ? '—' : (line.waste_area_per_sheet > 0 ? `${line.waste_area_per_sheet.toFixed(1)} sq.in` : '0')}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )
      })}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Transfer</DialogTitle></DialogHeader>
          {deleteTarget && (
            <div className="flex flex-col gap-3 pt-2">
              <p className="text-sm text-muted-foreground">
                This will reverse transfer <span className="font-semibold text-foreground">{deleteTarget.transfer_number}</span> ({formatDate(deleteTarget.transfer_date)}):
              </p>
              <ul className="text-sm space-y-1 pl-4">
                {deleteTarget.lines.map(line => (
                  <li key={line.line_id} className="list-disc text-muted-foreground">
                    <span className="text-foreground">{line.product_label}</span>
                    {line.cut_width_inches && line.cut_height_inches && (
                      <span> ({formatSize(line.cut_width_inches, line.cut_height_inches)})</span>
                    )}
                    : {formatNumber(line.total_cut_pieces)} pieces removed from cutting, {formatNumber(line.quantity_sheets)} sheets returned to godown
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2 pt-2">
                <DialogClose asChild><Button variant="outline" disabled={deleting}>Cancel</Button></DialogClose>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete Transfer'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
