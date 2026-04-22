import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useQuery } from '@/hooks/useQuery'
import { dbRun } from '@/lib/ipc'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatNumber, paperTypeLabel, formatSize } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { sheetsPerUnit, unitLabelPlural, paperDisplayType, isPacketVariant } from '@/lib/paper-type'
import type { Category } from '@/lib/paper-type'

const LOW_STOCK_THRESHOLD = 5

const STOCK_SQL = `
SELECT
  pt.id as paper_type_id,
  pt.category,
  b.name as brand_name,
  g.value as gsm_value,
  p.width_inches, p.height_inches,
  COALESCE(pt.variant, '') as variant,
  COALESCE(SUM(sl.quantity_sheets), 0) as total_sheets
FROM paper_types pt
JOIN brands b ON pt.brand_id = b.id
JOIN gsm_options g ON pt.gsm_id = g.id
JOIN proportions p ON pt.proportion_id = p.id
LEFT JOIN stock_ledger sl ON sl.paper_type_id = pt.id
GROUP BY pt.id
HAVING total_sheets > 0
ORDER BY pt.category, b.name, g.value
`

const AVG_COST_SQL = `
SELECT
  paper_type_id,
  CASE WHEN SUM(quantity_reams) > 0
    THEN SUM(cost_per_ream_poisha * quantity_reams) / SUM(quantity_reams)
    ELSE 0
  END as avg_cost_poisha
FROM purchases
GROUP BY paper_type_id
`

const ACCESSORY_STOCK_SQL = `
SELECT
  a.id as accessory_id,
  at.name || ' ' || b.name || ' ' || g.value || COALESCE(g.unit, 'lb') as accessory_name,
  COALESCE(SUM(sl.quantity_sheets), 0) as total_pieces
FROM accessories a
JOIN accessory_types at ON a.accessory_type_id = at.id
JOIN brands b ON a.brand_id = b.id
JOIN gsm_options g ON a.gsm_id = g.id
LEFT JOIN stock_ledger sl ON sl.accessory_id = a.id
GROUP BY a.id
HAVING total_pieces > 0
ORDER BY at.name, b.name
`

const ACCESSORY_COST_SQL = `
SELECT
  accessory_id,
  CASE WHEN SUM(quantity_reams) > 0
    THEN SUM(cost_per_ream_poisha * quantity_reams) / SUM(quantity_reams)
    ELSE 0
  END as avg_cost_poisha
FROM purchases
WHERE accessory_id IS NOT NULL
GROUP BY accessory_id
`

interface StockRow {
  paper_type_id: string
  category: Category
  brand_name: string
  gsm_value: number
  width_inches: number
  height_inches: number
  variant: string
  total_sheets: number
}

interface AvgCostRow {
  paper_type_id: string
  avg_cost_poisha: number
}

interface AccessoryStockRow {
  accessory_id: string
  accessory_name: string
  total_pieces: number
}

interface AccessoryCostRow {
  accessory_id: string
  avg_cost_poisha: number
}

interface MonthlyPurchaseRow {
  month: string
  total_cost_poisha: number
}

const MONTHLY_PURCHASES_SQL = `
SELECT
  strftime('%Y-%m', purchase_date) as month,
  SUM(total_cost_poisha) as total_cost_poisha
FROM purchases
GROUP BY strftime('%Y-%m', purchase_date)
ORDER BY month DESC
LIMIT 6
`

const TOTAL_PURCHASES_SQL = `
SELECT COALESCE(SUM(total_cost_poisha), 0) as total FROM purchases
`

export function GodownPage() {
  const { addToast } = useToast()
  const [filter, setFilter] = useState('')
  const [viewCategory, setViewCategory] = useState<'ALL' | Category>('ALL')
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'paper'; id: string; label: string; sheets: number } | { type: 'accessory'; id: string; label: string; pieces: number } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const { data: stockRows, loading: stockLoading, error: stockError, refetch: refetchStock } = useQuery<StockRow>(STOCK_SQL)
  const { data: costRows, loading: costLoading, error: costError } = useQuery<AvgCostRow>(AVG_COST_SQL)
  const { data: accessoryStockRows, loading: accStockLoading, error: accStockError, refetch: refetchAccStock } = useQuery<AccessoryStockRow>(ACCESSORY_STOCK_SQL)
  const { data: accessoryCostRows, loading: accCostLoading, error: accCostError } = useQuery<AccessoryCostRow>(ACCESSORY_COST_SQL)
  const { data: monthlyPurchases } = useQuery<MonthlyPurchaseRow>(MONTHLY_PURCHASES_SQL)
  const { data: totalPurchasesRows } = useQuery<{ total: number }>(TOTAL_PURCHASES_SQL)

  const loading = stockLoading || costLoading || accStockLoading || accCostLoading
  const error = stockError || costError || accStockError || accCostError

  const costMap = new Map<string, number>()
  for (const row of costRows) costMap.set(row.paper_type_id, row.avg_cost_poisha)

  const accCostMap = new Map<string, number>()
  for (const row of accessoryCostRows) accCostMap.set(row.accessory_id, row.avg_cost_poisha)

  const filteredRows = stockRows
    .filter(row => viewCategory === 'ALL' || row.category === viewCategory)
    .filter(row => `${paperTypeLabel(row.brand_name, row.gsm_value, row.width_inches, row.height_inches, row.variant)}`.toLowerCase().includes(filter.toLowerCase()))

  const filteredAccessoryRows = accessoryStockRows
    .filter(() => viewCategory === 'ALL' || viewCategory === 'ACCESSORY')
    .filter(row => row.accessory_name.toLowerCase().includes(filter.toLowerCase()))

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.type === 'paper') {
        await dbRun(
          `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at) VALUES (?, ?, NULL, 'ADJUSTMENT', ?, 'godown-delete', datetime('now'))`,
          [uuid(), deleteTarget.id, -deleteTarget.sheets]
        )
      } else {
        await dbRun(
          `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at) VALUES (?, NULL, ?, 'ADJUSTMENT', ?, 'godown-delete', datetime('now'))`,
          [uuid(), deleteTarget.id, -deleteTarget.pieces]
        )
      }
      addToast({ title: 'Stock removed', description: `${deleteTarget.label} deleted from godown.` })
      setDeleteTarget(null)
      refetchStock(); refetchAccStock()
    } catch (err: any) {
      addToast({ title: 'Failed', description: err.message, variant: 'destructive' })
    } finally { setDeleting(false) }
  }

  const showPaperRows = viewCategory !== 'ACCESSORY'
  const showAccessoryRows = viewCategory === 'ALL' || viewCategory === 'ACCESSORY'

  const totalItems = (showPaperRows ? filteredRows.length : 0) + (showAccessoryRows ? filteredAccessoryRows.length : 0)

  // Investment calculations — current godown stock value
  const paperInvestment = stockRows.reduce((sum, row) => {
    const cat = (row.category || 'PAPER') as Category
    const isPacket = isPacketVariant(row.variant)
    const spu = isPacket ? 1 : sheetsPerUnit(cat)
    const units = Number(row.total_sheets) / spu
    const avgCost = costMap.get(row.paper_type_id) ?? 0
    return sum + Math.round(avgCost * units)
  }, 0)

  const accessoryInvestment = accessoryStockRows.reduce((sum, row) => {
    const avgCost = accCostMap.get(row.accessory_id) ?? 0
    return sum + Math.round(avgCost * Number(row.total_pieces))
  }, 0)

  const totalGodownInvestment = paperInvestment + accessoryInvestment
  const allTimePurchases = totalPurchasesRows[0]?.total ?? 0

  // Per-category breakdown
  const categoryTotals = new Map<string, number>()
  for (const row of stockRows) {
    const cat = (row.category || 'PAPER') as Category
    const isPacket = isPacketVariant(row.variant)
    const spu = isPacket ? 1 : sheetsPerUnit(cat)
    const units = Number(row.total_sheets) / spu
    const avgCost = costMap.get(row.paper_type_id) ?? 0
    const value = Math.round(avgCost * units)
    categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + value)
  }
  if (accessoryInvestment > 0) {
    categoryTotals.set('ACCESSORY', accessoryInvestment)
  }

  // Current month label
  const currentMonth = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const thisMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const thisMonthPurchases = monthlyPurchases.find(m => m.month === thisMonthKey)?.total_cost_poisha ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Godown Storage</h1>
        {!loading && !error && (
          <span className="text-sm text-muted-foreground">
            {totalItems} item{totalItems !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading inventory...</div>}
      {error && <div className="text-sm text-destructive">Error: {error}</div>}

      {!loading && !error && (
        <>
          {/* Investment Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Current Godown Value</div>
                <div className="text-xl font-bold tabular-nums mt-1">{formatBDT(totalGodownInvestment)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">All-Time Purchases</div>
                <div className="text-xl font-bold tabular-nums mt-1 text-muted-foreground">{formatBDT(allTimePurchases)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{currentMonth}</div>
                <div className="text-xl font-bold tabular-nums mt-1">{formatBDT(thisMonthPurchases)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">By Category</div>
                <div className="mt-1 space-y-0.5">
                  {Array.from(categoryTotals.entries()).map(([cat, value]) => (
                    <div key={cat} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{cat}</span>
                      <span className="tabular-nums font-medium">{formatBDT(value)}</span>
                    </div>
                  ))}
                  {categoryTotals.size === 0 && <div className="text-xs text-muted-foreground">No stock</div>}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-4">
            <Tabs value={viewCategory} onValueChange={v => setViewCategory(v as any)}>
              <TabsList>
                <TabsTrigger value="ALL">All</TabsTrigger>
                <TabsTrigger value="PAPER">Paper</TabsTrigger>
                <TabsTrigger value="CARD">Card</TabsTrigger>
                <TabsTrigger value="STICKER">Sticker</TabsTrigger>
                <TabsTrigger value="ACCESSORY">Accessory</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input placeholder="Search inventory..." value={filter} onChange={e => setFilter(e.target.value)} onFocus={() => setViewCategory('ALL')} className="max-w-sm" />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Stock (units)</TableHead>
                <TableHead className="text-right">Stock (sheets)</TableHead>
                <TableHead className="text-right">Avg Cost / Unit</TableHead>
                <TableHead className="text-right">Avg Cost / Sheet</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totalItems === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No items found.</TableCell>
                </TableRow>
              )}
              {showPaperRows && filteredRows.map((row) => {
                const cat = (row.category || 'PAPER') as Category
                const isPacket = isPacketVariant(row.variant)
                const spu = isPacket ? 1 : sheetsPerUnit(cat)
                const totalSheets = Number(row.total_sheets)
                const units = totalSheets / spu
                const avgCostPoisha = costMap.get(row.paper_type_id) ?? 0
                const totalValuePoisha = Math.round(avgCostPoisha * units)
                const isLow = units < LOW_STOCK_THRESHOLD

                return (
                  <TableRow key={row.paper_type_id} className={cn(isLow && 'bg-destructive/10 hover:bg-destructive/15')}>
                    <TableCell className="font-medium">
                      {paperTypeLabel(row.brand_name, row.gsm_value, row.width_inches, row.height_inches, row.variant)}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const displayType = cat === 'PAPER' ? paperDisplayType(row.variant) : cat
                        const isCarbon = displayType === 'Carbon Paper'
                        const isColor = displayType === 'Color Paper'
                        const isPacketType = displayType === 'Packet Paper'
                        return <Badge variant={cat === 'PAPER' && !isCarbon && !isColor && !isPacketType ? 'secondary' : 'outline'} className={`text-[10px] px-1.5 py-0 ${cat === 'CARD' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : cat === 'STICKER' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : isCarbon ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' : isColor ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' : isPacketType ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200' : ''}`}>{displayType}</Badge>
                      })()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {isPacket ? `${formatNumber(totalSheets)} packets` : `${formatNumber(units, 1)} ${unitLabelPlural(cat)}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {isPacket ? <span className="text-muted-foreground">—</span> : formatNumber(totalSheets)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {avgCostPoisha > 0 ? formatBDT(avgCostPoisha) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {isPacket ? <span className="text-muted-foreground">—</span> : avgCostPoisha > 0 ? formatBDT(Math.round(avgCostPoisha / spu)) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {avgCostPoisha > 0 ? formatBDT(totalValuePoisha) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {isLow ? <Badge variant="destructive">Low</Badge> : <Badge variant="secondary">OK</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget({ type: 'paper', id: row.paper_type_id, label: paperTypeLabel(row.brand_name, row.gsm_value, row.width_inches, row.height_inches, row.variant), sheets: totalSheets })}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
              {showAccessoryRows && filteredAccessoryRows.map((row) => {
                const totalPieces = Number(row.total_pieces)
                const avgCostPoisha = accCostMap.get(row.accessory_id) ?? 0
                const totalValuePoisha = Math.round(avgCostPoisha * totalPieces)
                const isLow = totalPieces < LOW_STOCK_THRESHOLD

                return (
                  <TableRow key={`acc-${row.accessory_id}`} className={cn(isLow && 'bg-destructive/10 hover:bg-destructive/15')}>
                    <TableCell className="font-medium">
                      {row.accessory_name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">ACCESSORY</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(totalPieces)} pieces
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(totalPieces)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {avgCostPoisha > 0 ? formatBDT(avgCostPoisha) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {avgCostPoisha > 0 ? formatBDT(avgCostPoisha) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {avgCostPoisha > 0 ? formatBDT(totalValuePoisha) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {isLow ? <Badge variant="destructive">Low</Badge> : <Badge variant="secondary">OK</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget({ type: 'accessory', id: row.accessory_id, label: row.accessory_name, pieces: totalPieces })}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Delete from Godown?</DialogTitle></DialogHeader>
          {deleteTarget && (
            <div className="flex flex-col gap-3 pt-2">
              <p className="text-sm text-muted-foreground">
                This will remove all stock of <span className="font-semibold text-foreground">{deleteTarget.label}</span> from godown ({deleteTarget.type === 'paper' ? `${formatNumber(deleteTarget.sheets)} sheets` : `${formatNumber(deleteTarget.pieces)} pieces`}).
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
