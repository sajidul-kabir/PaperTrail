import { useState, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { dbQuery, dbTransaction } from '@/lib/ipc'
import { findOrCreatePaperType, findOrCreateAccessory, sheetsPerUnit, unitLabel, unitLabelPlural, PAPER_SUBTYPES, VARIANT_PRESETS, paperDisplayType } from '@/lib/paper-type'
import type { Category } from '@/lib/paper-type'
import { useQuery } from '@/hooks/useQuery'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatBDT, formatDate, bdtToPoisha, poishaToBdt, todayISO, formatSize } from '@/lib/utils'
import { usePurchaseMinimize } from '@/lib/purchase-minimize'
import { Minus } from 'lucide-react'

// ─── SQL ──────────────────────────────────────────────────────────────────────

const SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(total_cost_poisha), 0) as total_all,
    COALESCE(SUM(CASE WHEN purchase_date = ? THEN total_cost_poisha ELSE 0 END), 0) as total_today,
    COALESCE(SUM(CASE WHEN purchase_date >= ? THEN total_cost_poisha ELSE 0 END), 0) as total_week,
    COALESCE(SUM(CASE WHEN purchase_date >= ? THEN total_cost_poisha ELSE 0 END), 0) as total_month,
    COALESCE(SUM(CASE WHEN category = 'PAPER' THEN total_cost_poisha ELSE 0 END), 0) as total_paper,
    COALESCE(SUM(CASE WHEN category = 'CARD' THEN total_cost_poisha ELSE 0 END), 0) as total_card,
    COALESCE(SUM(CASE WHEN category = 'STICKER' THEN total_cost_poisha ELSE 0 END), 0) as total_sticker,
    COALESCE(SUM(CASE WHEN category = 'ACCESSORY' THEN total_cost_poisha ELSE 0 END), 0) as total_accessory
  FROM purchases
`

const PURCHASES_SQL = `
  SELECT pu.id, pu.purchase_date, pu.category,
    COALESCE(b.name, ab.name, '') as brand_name,
    COALESCE(g.value, ag.value, 0) as gsm_value,
    COALESCE(p.width_inches, 0) as width_inches,
    COALESCE(p.height_inches, 0) as height_inches,
    COALESCE(at.name, '') as accessory_name,
    pu.quantity_reams, pu.cost_per_ream_poisha, COALESCE(pu.extra_cost_per_unit_poisha, 0) as extra_cost_per_unit_poisha,
    pu.supplier_name, pu.notes,
    pu.paper_type_id, pu.accessory_id,
    pt.brand_id, pt.gsm_id, pt.proportion_id, COALESCE(pt.variant, '') as variant,
    ac.brand_id as acc_brand_id, ac.gsm_id as acc_gsm_id, ac.accessory_type_id as acc_type_id, COALESCE(ag.unit, 'lb') as acc_gsm_unit,
    pu.supplier_id,
    COALESCE(s.name, pu.supplier_name) as display_supplier_name
  FROM purchases pu
  LEFT JOIN paper_types pt ON pu.paper_type_id = pt.id
  LEFT JOIN brands b ON pt.brand_id = b.id
  LEFT JOIN gsm_options g ON pt.gsm_id = g.id
  LEFT JOIN proportions p ON pt.proportion_id = p.id
  LEFT JOIN accessories ac ON pu.accessory_id = ac.id
  LEFT JOIN accessory_types at ON ac.accessory_type_id = at.id
  LEFT JOIN brands ab ON ac.brand_id = ab.id
  LEFT JOIN gsm_options ag ON ac.gsm_id = ag.id
  LEFT JOIN suppliers s ON pu.supplier_id = s.id
  ORDER BY pu.purchase_date DESC, pu.created_at DESC
`

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SummaryRow { total_all: number; total_today: number; total_week: number; total_month: number; total_paper: number; total_card: number; total_sticker: number; total_accessory: number }
interface Brand { id: string; name: string }
interface Gsm { id: string; value: number; unit: string }
interface Proportion { id: string; width_inches: number; height_inches: number }
interface AccessoryType { id: string; name: string }
interface SupplierOption { id: string; name: string }

interface Purchase {
  id: string; purchase_date: string; category: Category
  brand_name: string; gsm_value: number; width_inches: number; height_inches: number
  accessory_name: string; quantity_reams: number; cost_per_ream_poisha: number; extra_cost_per_unit_poisha: number
  supplier_name: string | null; notes: string | null
  paper_type_id: string | null; accessory_id: string | null; variant: string
  brand_id: string | null; gsm_id: string | null; proportion_id: string | null
  acc_brand_id: string | null; acc_gsm_id: string | null; acc_type_id: string | null; acc_gsm_unit: string
  supplier_id: string | null; display_supplier_name: string | null
}

function getWeekStart(): string {
  const d = new Date(); const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const mon = new Date(d.setDate(diff))
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
}
function getMonthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── Form types ───────────────────────────────────────────────────────────────

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'PAPER', label: 'Paper' },
  { value: 'CARD', label: 'Card' },
  { value: 'STICKER', label: 'Sticker' },
  { value: 'ACCESSORY', label: 'Accessories' },
]

interface PurchaseLine {
  id: string
  category: Category
  brandId: string; gsmId: string; proportionId: string; accessoryId: string
  paperSubtype: string; variant: string; variantFilter: string; variantTab: string
  quantity: string; extraSheets: string; costPerUnit: string; extraCostPerUnit: string
}

function emptyLine(): PurchaseLine {
  return { id: uuid(), category: 'PAPER', brandId: '', gsmId: '', proportionId: '', accessoryId: '', paperSubtype: '', variant: '', variantFilter: '', variantTab: '', quantity: '', extraSheets: '', costPerUnit: '', extraCostPerUnit: '' }
}

/** Compute effective units (reams/packets) from quantity + extra sheets */
function effectiveQty(line: PurchaseLine, spu: number): number {
  const units = parseFloat(line.quantity) || 0
  const extra = parseInt(line.extraSheets) || 0
  return units + extra / spu
}

/** Tab groups for variant filtering */
const VARIANT_TABS: Record<string, string[]> = {
  carbon: ['', 'CB', 'CFB', 'CF'],
  color: [],
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PurchasesPage() {
  const { addToast } = useToast()
  const location = useLocation()
  const { minimized: globalMinimized, minimize: globalMinimize, restore: globalRestore } = usePurchaseMinimize()
  const [open, setOpen] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [viewCategory, setViewCategory] = useState<'ALL' | Category>('ALL')
  const [summaryView, setSummaryView] = useState<'today' | 'week' | 'month' | 'all' | 'paper' | 'card' | 'sticker' | 'accessory'>('month')
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Multi-line form state
  const [purchaseDate, setPurchaseDate] = useState(todayISO())
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PurchaseLine[]>([emptyLine()])
  const [expandedLineId, setExpandedLineId] = useState<string>(lines[0]?.id ?? '')

  // The "active" category for catalog lookups (from first line or editing line)
  const activeCat = lines[0]?.category ?? 'PAPER'

  const { data: brands } = useQuery<Brand>(`SELECT id, name FROM brands WHERE category = ? ORDER BY name`, [activeCat], [activeCat])
  const { data: gsmOptions } = useQuery<Gsm>(`SELECT id, value, COALESCE(unit, '') as unit FROM gsm_options WHERE category = ? ORDER BY value`, [activeCat], [activeCat])
  const { data: proportions } = useQuery<Proportion>(`SELECT id, width_inches, height_inches FROM proportions WHERE category = ? ORDER BY width_inches`, [activeCat], [activeCat])
  const { data: accessoryTypes } = useQuery<AccessoryType>('SELECT id, name FROM accessory_types ORDER BY name')
  const { data: supplierOptions } = useQuery<SupplierOption>('SELECT id, name FROM suppliers ORDER BY name')
  const { data: purchases, loading, error, refetch } = useQuery<Purchase>(PURCHASES_SQL)

  const today = todayISO()
  const { data: summaryRows, loading: summaryLoading, refetch: refetchSummary } = useQuery<SummaryRow>(SUMMARY_SQL, [today, getWeekStart(), getMonthStart()], [today])
  const summary = summaryRows[0] ?? { total_all: 0, total_today: 0, total_week: 0, total_month: 0, total_paper: 0, total_card: 0, total_sticker: 0, total_accessory: 0 }

  // Restore minimized purchase when navigated here with restorePurchase state
  useEffect(() => {
    const state = location.state as any
    if (state?.restorePurchase && globalMinimized) {
      const data = globalRestore()
      if (data?.formData) {
        const f = data.formData
        setPurchaseDate(f.purchaseDate ?? todayISO())
        setSupplierId(f.supplierId ?? '')
        setNotes(f.notes ?? '')
        setLines(f.lines ?? [emptyLine()])
        setExpandedLineId(f.expandedLineId ?? '')
        setEditingPurchase(f.editingPurchase ?? null)
        setOpen(true)
      }
      // Clear the navigation state so it doesn't re-trigger
      window.history.replaceState({}, '')
    }
  }, [location.state])

  function resetForm() {
    setPurchaseDate(todayISO()); setSupplierId(''); setNotes('')
    const first = emptyLine()
    setLines([first]); setExpandedLineId(first.id); setEditingPurchase(null)
  }

  function openNew() { resetForm(); setOpen(true) }

  function openEdit(p: Purchase) {
    setEditingPurchase(p)
    setPurchaseDate(p.purchase_date)
    setSupplierId(p.supplier_id ?? '')
    setNotes(p.notes ?? '')
    // Determine paperSubtype from variant
    const editVariant = p.variant || ''
    let editSubtype = ''
    if (editVariant) {
      if (editVariant === 'PACKET' || editVariant === 'Packet' || editVariant === 'packet') editSubtype = 'packet'
      else if (VARIANT_PRESETS.carbon?.includes(editVariant)) editSubtype = 'carbon'
      else if (VARIANT_PRESETS.color?.includes(editVariant)) editSubtype = 'color'
      else editSubtype = 'carbon' // fallback for unknown variants
    }
    const editLineId = uuid()
    setExpandedLineId(editLineId)
    setLines([{
      id: editLineId, category: p.category,
      brandId: p.category === 'ACCESSORY' ? (p.acc_brand_id ?? '') : (p.brand_id ?? ''),
      gsmId: p.category === 'ACCESSORY' ? (p.acc_gsm_id ?? '') : (p.gsm_id ?? ''),
      proportionId: p.proportion_id ?? '',
      accessoryId: p.category === 'ACCESSORY' ? (p.acc_type_id ?? '') : '',
      paperSubtype: editSubtype, variant: editVariant, variantFilter: '', variantTab: '',
      quantity: String(Math.floor(p.quantity_reams)),
      extraSheets: (() => {
        const spu = sheetsPerUnit(p.category)
        const frac = p.quantity_reams - Math.floor(p.quantity_reams)
        const sheets = Math.round(frac * spu)
        return sheets > 0 ? String(sheets) : ''
      })(),
      costPerUnit: String(poishaToBdt(p.cost_per_ream_poisha)),
      extraCostPerUnit: p.extra_cost_per_unit_poisha ? String(poishaToBdt(p.extra_cost_per_unit_poisha)) : '',
    }])
    setOpen(true)
  }

  const updateLine = useCallback((id: string, patch: Partial<PurchaseLine>) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const next = { ...l, ...patch }
      if ('category' in patch) { next.brandId = ''; next.gsmId = ''; next.proportionId = ''; next.accessoryId = ''; next.paperSubtype = ''; next.variant = ''; next.variantFilter = ''; next.variantTab = '' }
      if ('brandId' in patch && patch.brandId) {
        const brand = brands.find(b => b.id === patch.brandId)
        if (brand && /a4/i.test(brand.name)) {
          const a4 = proportions.find(p => Math.min(p.width_inches, p.height_inches) === 8.25 && Math.max(p.width_inches, p.height_inches) === 11.75)
          if (a4) next.proportionId = a4.id
        }
      }
      if ('paperSubtype' in patch) {
        next.variant = ''; next.variantFilter = ''; next.variantTab = ''
        // Auto-set GSM + size defaults for carbon/color paper
        const st = patch.paperSubtype
        if (st === 'carbon') {
          const g47 = gsmOptions.find(g => g.value === 47)
          const s23x36 = proportions.find(p => (Math.min(p.width_inches, p.height_inches) === 23 && Math.max(p.width_inches, p.height_inches) === 36))
          if (g47) next.gsmId = g47.id
          if (s23x36) next.proportionId = s23x36.id
        } else if (st === 'color') {
          const g42 = gsmOptions.find(g => g.value === 42)
          const s18x23 = proportions.find(p => (Math.min(p.width_inches, p.height_inches) === 18 && Math.max(p.width_inches, p.height_inches) === 23))
          if (g42) next.gsmId = g42.id
          if (s18x23) next.proportionId = s18x23.id
        } else if (st === 'packet') {
          next.variant = 'PACKET'
          next.extraSheets = ''
        }
      }
      return next
    }))
  }, [gsmOptions, proportions])

  const addLine = () => {
    const newLine = emptyLine()
    setLines(prev => [...prev, newLine])
    setExpandedLineId(newLine.id)
  }
  const removeLine = (id: string) => setLines(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev)

  async function handleSave() {
    if (!purchaseDate) { addToast({ title: 'Select a date', variant: 'destructive' }); return }

    // Validate lines
    for (const line of lines) {
      const cat = line.category
      if (cat === 'ACCESSORY') {
        if (!line.accessoryId || !line.brandId || !line.gsmId) { addToast({ title: 'Select name, brand, and pound for accessories', variant: 'destructive' }); return }
      } else {
        if (!line.brandId || !line.gsmId || !line.proportionId) { addToast({ title: 'Select brand, GSM, and size for all lines', variant: 'destructive' }); return }
      }
      const spu = sheetsPerUnit(line.category)
      const totalQty = effectiveQty(line, spu)
      if (totalQty <= 0) { addToast({ title: 'Enter valid quantity', variant: 'destructive' }); return }
      const cost = parseFloat(line.costPerUnit)
      if (!line.costPerUnit || isNaN(cost) || cost <= 0) { addToast({ title: 'Enter valid cost', variant: 'destructive' }); return }
    }

    setSaving(true)
    try {
      if (editingPurchase && lines.length === 1) {
        // EDIT single purchase
        const line = lines[0]
        const cat = line.category
        const spu = line.paperSubtype === 'packet' ? 1 : sheetsPerUnit(cat)
        let paperTypeId: string | null = null
        let accessoryId: string | null = null

        if (cat !== 'ACCESSORY') {
          paperTypeId = await findOrCreatePaperType(line.brandId, line.gsmId, line.proportionId, cat, line.variant)
        } else {
          accessoryId = await findOrCreateAccessory(line.accessoryId, line.brandId, line.gsmId)
        }

        const qty = effectiveQty(line, spu)
        const costPoisha = bdtToPoisha(parseFloat(line.costPerUnit))
        const extraCostPoisha = line.extraCostPerUnit ? bdtToPoisha(parseFloat(line.extraCostPerUnit)) : 0
        const quantitySheets = Math.round(qty * spu)

        await dbTransaction([
          { sql: `UPDATE purchases SET paper_type_id = ?, accessory_id = ?, category = ?, purchase_date = ?, quantity_reams = ?, cost_per_ream_poisha = ?, extra_cost_per_unit_poisha = ?, total_cost_poisha = ?, supplier_id = ?, supplier_name = ?, notes = ? WHERE id = ?`,
            params: [paperTypeId, accessoryId, cat, purchaseDate, qty, costPoisha, extraCostPoisha, Math.round(qty * (costPoisha + extraCostPoisha)), supplierId || null, null, notes.trim() || null, editingPurchase.id] },
          { sql: `UPDATE stock_ledger SET paper_type_id = ?, accessory_id = ?, quantity_sheets = ? WHERE reference_id = ? AND transaction_type = 'PURCHASE'`,
            params: [paperTypeId, accessoryId, quantitySheets, editingPurchase.id] },
        ])
        addToast({ title: 'Purchase updated' })
      } else {
        // CREATE new purchases (multi-line)
        const statements: { sql: string; params: any[] }[] = []
        const now = new Date().toISOString()

        for (const line of lines) {
          const cat = line.category
          const spu = line.paperSubtype === 'packet' ? 1 : sheetsPerUnit(cat)
          let paperTypeId: string | null = null
          let accessoryId: string | null = null

          if (cat !== 'ACCESSORY') {
            paperTypeId = await findOrCreatePaperType(line.brandId, line.gsmId, line.proportionId, cat, line.variant)
          } else {
            accessoryId = await findOrCreateAccessory(line.accessoryId, line.brandId, line.gsmId)
          }

          const qty = effectiveQty(line, spu)
          const costPoisha = bdtToPoisha(parseFloat(line.costPerUnit))
          const extraCostPoisha = line.extraCostPerUnit ? bdtToPoisha(parseFloat(line.extraCostPerUnit)) : 0
          const quantitySheets = Math.round(qty * spu)
          const purchaseId = uuid()

          statements.push({
            sql: `INSERT INTO purchases (id, paper_type_id, accessory_id, category, purchase_date, quantity_reams, cost_per_ream_poisha, extra_cost_per_unit_poisha, total_cost_poisha, supplier_id, supplier_name, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [purchaseId, paperTypeId, accessoryId, cat, purchaseDate, qty, costPoisha, extraCostPoisha, Math.round(qty * (costPoisha + extraCostPoisha)), supplierId || null, null, notes.trim() || null, now],
          })
          statements.push({
            sql: `INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at) VALUES (?, ?, ?, 'PURCHASE', ?, ?, ?)`,
            params: [uuid(), paperTypeId, accessoryId, quantitySheets, purchaseId, now],
          })
        }
        await dbTransaction(statements)
        addToast({ title: 'Purchases recorded', description: `${lines.length} item${lines.length > 1 ? 's' : ''} added to stock.` })
      }
      setOpen(false); resetForm(); refetch(); refetchSummary()
    } catch (err: any) {
      addToast({ title: 'Failed to save', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      // Find the stock_ledger entry for this purchase to know how many sheets to remove
      const ledgerRows = await dbQuery<{ paper_type_id: string | null; accessory_id: string | null; quantity_sheets: number }>(
        `SELECT paper_type_id, accessory_id, quantity_sheets FROM stock_ledger WHERE reference_id = ? AND transaction_type = 'PURCHASE'`,
        [deleteTarget.id]
      )

      // Check current godown stock for each affected item
      for (const entry of ledgerRows) {
        const col = entry.paper_type_id ? 'paper_type_id' : 'accessory_id'
        const id = entry.paper_type_id ?? entry.accessory_id
        const stockRows = await dbQuery<{ total: number }>(
          `SELECT COALESCE(SUM(quantity_sheets), 0) as total FROM stock_ledger WHERE ${col} = ?`,
          [id]
        )
        const currentStock = stockRows[0]?.total ?? 0
        if (currentStock < entry.quantity_sheets) {
          addToast({
            title: 'Cannot delete',
            description: `Only ${currentStock} sheets remain in godown but this purchase added ${entry.quantity_sheets}. Some stock has already been transferred out.`,
            variant: 'destructive',
          })
          setDeleting(false)
          return
        }
      }

      await dbTransaction([
        { sql: `DELETE FROM stock_ledger WHERE reference_id = ? AND transaction_type = 'PURCHASE'`, params: [deleteTarget.id] },
        { sql: `DELETE FROM purchases WHERE id = ?`, params: [deleteTarget.id] },
      ])
      addToast({ title: 'Purchase deleted', description: 'Stock ledger updated.' })
      setDeleteTarget(null)
      refetch(); refetchSummary()
    } catch (err: any) {
      addToast({ title: 'Delete failed', description: err.message, variant: 'destructive' })
    } finally { setDeleting(false) }
  }

  const filteredPurchases = purchases
    .filter(p => {
      if (summaryView === 'all') return true
      if (summaryView === 'today') return p.purchase_date === today
      if (summaryView === 'week') return p.purchase_date >= getWeekStart()
      if (summaryView === 'month') return p.purchase_date >= getMonthStart()
      if (summaryView === 'paper') return p.category === 'PAPER'
      if (summaryView === 'card') return p.category === 'CARD'
      if (summaryView === 'sticker') return p.category === 'STICKER'
      if (summaryView === 'accessory') return p.category === 'ACCESSORY'
      return true
    })
    .filter(p => viewCategory === 'ALL' || p.category === viewCategory)
    .filter(p => `${p.brand_name} ${p.gsm_value} ${formatSize(p.width_inches, p.height_inches)} ${p.variant || ''} ${p.accessory_name} ${p.display_supplier_name ?? ''}`.toLowerCase().includes(filter.toLowerCase()))

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchases</h1>
          <p className="text-sm text-muted-foreground mt-1">Record purchases and track stock additions.</p>
        </div>
        {!summaryLoading && (
          <div className="flex items-center gap-2">
            <Select value={summaryView} onValueChange={v => setSummaryView(v as any)}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="paper">Paper (all)</SelectItem>
                <SelectItem value="card">Card (all)</SelectItem>
                <SelectItem value="sticker">Sticker (all)</SelectItem>
                <SelectItem value="accessory">Accessory (all)</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-lg font-bold tabular-nums whitespace-nowrap">
              {formatBDT(summaryView === 'today' ? summary.total_today : summaryView === 'week' ? summary.total_week : summaryView === 'month' ? summary.total_month : summaryView === 'all' ? summary.total_all : summaryView === 'paper' ? summary.total_paper : summaryView === 'card' ? summary.total_card : summaryView === 'sticker' ? summary.total_sticker : summary.total_accessory)}
            </span>
          </div>
        )}
      </div>

      {/* ── Purchase Dialog ──────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); if (!globalMinimized) resetForm() } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onInteractOutside={e => e.preventDefault()}>
          <button
            type="button"
            className="absolute right-11 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            onClick={() => {
              const label = editingPurchase ? 'Edit Purchase' : `Recording ${lines.length} Purchase${lines.length > 1 ? 's' : ''}`
              globalMinimize(label, {
                purchaseDate, supplierId, notes, lines, expandedLineId, editingPurchase,
              })
              setOpen(false)
            }}
            title="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <DialogHeader><DialogTitle>{editingPurchase ? 'Edit Purchase' : 'Record Purchases'}</DialogTitle></DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Header: date + supplier */}
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>Purchase Date *</Label>
                <DatePicker value={purchaseDate} onChange={setPurchaseDate} />
              </div>
              <div className="grid gap-1.5">
                <Label>Supplier</Label>
                <Select value={supplierId} onValueChange={v => setSupplierId(v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Optional..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {supplierOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Notes</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            {/* Lines */}

            {lines.map((line, idx) => {
              const cat = line.category
              const isPacket = line.paperSubtype === 'packet'
              const spu = isPacket ? 1 : sheetsPerUnit(cat)
              const uLbl = isPacket ? 'packet' : unitLabel(cat)
              const uLblP = isPacket ? 'packets' : unitLabelPlural(cat)
              const qty = isPacket ? (parseFloat(line.quantity) || 0) : effectiveQty(line, spu)
              const cost = parseFloat(line.costPerUnit) || 0
              const extraCost = parseFloat(line.extraCostPerUnit) || 0
              const isExpanded = expandedLineId === line.id

              // Build compact summary label for collapsed view
              const summaryLabel = (() => {
                if (cat === 'ACCESSORY') {
                  const name = accessoryTypes.find(t => t.id === line.accessoryId)?.name || ''
                  const brand = brands.find(b => b.id === line.brandId)?.name || ''
                  return name && brand ? `${name} ${brand}` : 'Untitled'
                }
                const brand = brands.find(b => b.id === line.brandId)?.name || ''
                const gsm = gsmOptions.find(g => g.id === line.gsmId)?.value
                const size = proportions.find(p => p.id === line.proportionId)
                const sizeStr = size ? formatSize(size.width_inches, size.height_inches) : ''
                const parts = [brand, gsm ? `${gsm}gsm` : '', sizeStr, line.variant].filter(Boolean)
                return parts.length > 0 ? parts.join(' ') : 'Untitled'
              })()
              const totalSheets = Math.round(qty * spu)

              // Collapsed view
              if (!isExpanded && !editingPurchase) {
                return (
                  <Card key={line.id} tabIndex={0} className="cursor-pointer hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors" onClick={() => setExpandedLineId(line.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedLineId(line.id) } }}>
                    <CardContent className="py-2 flex items-center gap-3">
                      <span className="text-xs font-semibold text-muted-foreground w-5">#{idx + 1}</span>
                      <span className="text-sm font-medium flex-1 truncate">{summaryLabel}</span>
                      {totalSheets > 0 && <span className="text-xs tabular-nums text-muted-foreground">{totalSheets.toLocaleString()} sheets</span>}
                      {cost > 0 && qty > 0 && <span className="text-xs tabular-nums font-medium">{formatBDT(bdtToPoisha((cost + extraCost) * qty))}</span>}
                      {lines.length > 1 && (
                        <button className="text-muted-foreground hover:text-destructive text-lg leading-none ml-1" onClick={e => { e.stopPropagation(); removeLine(line.id) }}>×</button>
                      )}
                    </CardContent>
                  </Card>
                )
              }

              return (
                <Card key={line.id}>
                  <CardContent className="pt-3 pb-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-muted-foreground">#{idx + 1}</span>
                      {!editingPurchase && lines.length > 1 && (
                        <button className="text-muted-foreground hover:text-destructive text-lg leading-none" onClick={() => removeLine(line.id)}>×</button>
                      )}
                    </div>

                    {/* Category */}
                    <div className="flex gap-1.5 mb-2">
                      {CATEGORIES.map(c => (
                        <Button key={c.value} size="sm" variant={cat === c.value ? 'default' : 'outline'}
                          onClick={() => updateLine(line.id, { category: c.value })} className="text-xs h-7 px-2">{c.label}</Button>
                      ))}
                    </div>

                    {/* Item selection */}
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {cat === 'ACCESSORY' ? (
                        <>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Name</Label>
                            <Select value={line.accessoryId} onValueChange={v => updateLine(line.id, { accessoryId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Name" /></SelectTrigger>
                              <SelectContent>{accessoryTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Brand</Label>
                            <Select value={line.brandId} onValueChange={v => updateLine(line.id, { brandId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Brand" /></SelectTrigger>
                              <SelectContent>{brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Unit</Label>
                            <Select value={line.gsmId} onValueChange={v => updateLine(line.id, { gsmId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Unit" /></SelectTrigger>
                              <SelectContent>{gsmOptions.map(g => <SelectItem key={g.id} value={g.id}>{g.value}{g.unit || 'lb'}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Brand</Label>
                            <Select value={line.brandId} onValueChange={v => updateLine(line.id, { brandId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Brand" /></SelectTrigger>
                              <SelectContent>{brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">GSM</Label>
                            <Select value={line.gsmId} onValueChange={v => updateLine(line.id, { gsmId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="GSM" /></SelectTrigger>
                              <SelectContent>{gsmOptions.map(g => <SelectItem key={g.id} value={g.id}>{g.value}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Size</Label>
                            <Select value={line.proportionId} onValueChange={v => updateLine(line.id, { proportionId: v })}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Size" /></SelectTrigger>
                              <SelectContent>{proportions.map(p => <SelectItem key={p.id} value={p.id}>{formatSize(p.width_inches, p.height_inches)}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Paper sub-type + variant (only for PAPER category) */}
                    {cat === 'PAPER' && (
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="grid gap-1">
                          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Paper Type</Label>
                          <div className="flex gap-1">
                            {PAPER_SUBTYPES.map(st => (
                              <Button key={st.value} size="sm" variant={line.paperSubtype === st.value ? 'default' : 'outline'}
                                onClick={() => updateLine(line.id, { paperSubtype: st.value })} className="text-xs h-7 px-2 flex-1">{st.label}</Button>
                            ))}
                          </div>
                        </div>
                        {line.paperSubtype && VARIANT_PRESETS[line.paperSubtype] && (() => {
                          const presets = VARIANT_PRESETS[line.paperSubtype]!
                          const tabs = VARIANT_TABS[line.paperSubtype] ?? []
                          const tabFiltered = line.variantTab
                            ? presets.filter(v => v.startsWith(line.variantTab + ' '))
                            : presets
                          const filtered = line.variantFilter
                            ? tabFiltered.filter(v => v.toLowerCase().includes(line.variantFilter.toLowerCase()))
                            : tabFiltered
                          return (
                            <div className="grid gap-1">
                              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Variant</Label>
                              <Select value={line.variant} onValueChange={v => updateLine(line.id, { variant: v })}>
                                <SelectTrigger className="h-8"><SelectValue placeholder="Select variant..." /></SelectTrigger>
                                <SelectContent className="max-h-72" header={
                                  <div className="flex flex-col gap-1.5">
                                    {tabs.length > 0 && (
                                      <div className="flex gap-1">
                                        {tabs.map(t => (
                                          <button key={t || 'ALL'} type="button"
                                            className={`px-2 py-0.5 text-[10px] font-semibold rounded ${line.variantTab === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                                            onPointerDown={e => { e.preventDefault(); e.stopPropagation(); updateLine(line.id, { variantTab: t }) }}>
                                            {t || 'All'}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    <Input placeholder="Search variants..." value={line.variantFilter}
                                      onChange={e => updateLine(line.id, { variantFilter: e.target.value })}
                                      className="h-8 text-sm" />
                                  </div>
                                }>
                                  {filtered.length === 0 ? (
                                    <div className="py-3 text-center text-sm text-muted-foreground">No variants found</div>
                                  ) : filtered.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    {/* Qty + Cost */}
                    <div className={`grid gap-3 ${cat !== 'ACCESSORY' && !isPacket ? 'grid-cols-4' : 'grid-cols-3'}`}>
                      <div className="grid gap-1">
                        <Label className="text-xs">Qty ({uLblP})</Label>
                        <Input className="h-8" type="number" min="0" step="1" value={line.quantity} onChange={e => updateLine(line.id, { quantity: e.target.value })} />
                      </div>
                      {cat !== 'ACCESSORY' && !isPacket && (
                        <div className="grid gap-1">
                          <Label className="text-xs">+ Sheets</Label>
                          <Input className="h-8" type="number" min="0" step="1" placeholder="0" value={line.extraSheets} onChange={e => updateLine(line.id, { extraSheets: e.target.value })} />
                        </div>
                      )}
                      <div className="grid gap-1">
                        <Label className="text-xs">Cost/{uLbl} (BDT)</Label>
                        <Input className="h-8" type="number" min="0.01" step="0.01" value={line.costPerUnit} onChange={e => updateLine(line.id, { costPerUnit: e.target.value })} />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Extra cost/{uLbl}</Label>
                        <Input className="h-8" type="number" min="0" step="0.01" placeholder="0" value={line.extraCostPerUnit} onChange={e => updateLine(line.id, { extraCostPerUnit: e.target.value })} />
                      </div>
                    </div>

                    {qty > 0 && cost > 0 && (
                      <div className="text-xs text-muted-foreground mt-2 border-t pt-2 space-y-1">
                        <div className="flex justify-between">
                          <span>Purchasing:</span>
                          <span className="font-semibold text-foreground">
                            {cat === 'ACCESSORY' ? (
                              <>
                                {accessoryTypes.find(t => t.id === line.accessoryId)?.name || '...'} {' '}
                                {brands.find(b => b.id === line.brandId)?.name || '...'} {' '}
                                {gsmOptions.find(g => g.id === line.gsmId)?.value || '...'}{gsmOptions.find(g => g.id === line.gsmId)?.unit || 'lb'}
                              </>
                            ) : (
                              <>
                                {brands.find(b => b.id === line.brandId)?.name || '...'}
                                {line.variant ? ` ${paperDisplayType(line.variant)}` : ''} {' '}
                                {gsmOptions.find(g => g.id === line.gsmId)?.value || '...'}gsm {' '}
                                {proportions.find(p => p.id === line.proportionId) ? formatSize(proportions.find(p => p.id === line.proportionId)!.width_inches, proportions.find(p => p.id === line.proportionId)!.height_inches) : '...'}
                                {line.variant ? ` ${line.variant}` : ''}
                              </>
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Supplier Due: <span className="font-medium text-foreground">{formatBDT(bdtToPoisha(cost * qty))}</span></span>
                          <span>{Math.round(qty * spu).toLocaleString()} {isPacket ? 'packets' : 'sheets'}</span>
                        </div>
                        {extraCost > 0 && (
                          <div className="flex justify-between">
                            <span>Total (with extra): <span className="font-medium text-foreground">{formatBDT(bdtToPoisha((cost + extraCost) * qty))}</span></span>
                            <span className="text-muted-foreground">+{formatBDT(bdtToPoisha(extraCost))}/{uLbl} extra</span>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {!editingPurchase && (
            <Button variant="outline" size="sm" onClick={addLine} className="w-full">+ Add Row</Button>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setOpen(false); resetForm() }} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingPurchase ? 'Update Purchase' : `Save ${lines.length > 1 ? `${lines.length} Purchases` : 'Purchase'}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Filter + search + button */}
      <div className="flex items-center gap-4">
        <Tabs value={viewCategory} onValueChange={v => setViewCategory(v as any)}>
          <TabsList>
            <TabsTrigger value="ALL">All</TabsTrigger>
            <TabsTrigger value="PAPER">Paper</TabsTrigger>
            <TabsTrigger value="CARD">Card</TabsTrigger>
            <TabsTrigger value="STICKER">Sticker</TabsTrigger>
            <TabsTrigger value="ACCESSORY">Accessories</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input placeholder="Search purchases..." value={filter} onChange={e => setFilter(e.target.value)} onFocus={() => setViewCategory('ALL')} className="max-w-sm" />
        <div className="flex-1" />
        <Button onClick={openNew}>+ New Purchase</Button>
      </div>

      {/* Table */}
      {loading ? <p className="text-sm text-muted-foreground">Loading...</p>
       : error ? <p className="text-sm text-destructive">Error: {error}</p>
       : filteredPurchases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium text-muted-foreground">No purchases found.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Cost / Unit</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPurchases.map(p => {
                const pCat = (p.category || 'PAPER') as Category
                const productLabel = pCat === 'ACCESSORY'
                  ? `${p.accessory_name} ${p.brand_name} ${p.gsm_value}${p.acc_gsm_unit}`
                  : `${p.brand_name}${p.variant ? ' ' + paperDisplayType(p.variant) : ''} ${p.gsm_value}gsm ${formatSize(p.width_inches, p.height_inches)}${p.variant ? ' ' + p.variant : ''}`
                
                return (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(p.purchase_date)}</TableCell>
                    <TableCell>{productLabel}</TableCell>
                    <TableCell>
                      {(() => {
                        const displayType = pCat === 'PAPER' ? paperDisplayType(p.variant) : pCat
                        const isCarbon = displayType === 'Carbon Paper'
                        const isColor = displayType === 'Color Paper'
                        return <Badge variant={pCat === 'PAPER' && !isCarbon && !isColor ? 'secondary' : 'outline'} className={`text-[10px] px-1.5 py-0 ${pCat === 'CARD' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : pCat === 'STICKER' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : pCat === 'ACCESSORY' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' : isCarbon ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' : isColor ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' : ''}`}>{displayType}</Badge>
                      })()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.quantity_reams} {unitLabelPlural(pCat)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBDT(p.cost_per_ream_poisha)}{p.extra_cost_per_unit_poisha > 0 ? <span className="text-muted-foreground"> +{formatBDT(p.extra_cost_per_unit_poisha)}</span> : ''}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatBDT(Math.round((p.cost_per_ream_poisha + p.extra_cost_per_unit_poisha) * p.quantity_reams))}</TableCell>
                    <TableCell className="text-muted-foreground">{p.display_supplier_name ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(p)} className="text-xs text-primary hover:underline">Edit</button>
                        <button onClick={() => setDeleteTarget(p)} className="text-xs text-destructive hover:underline">Delete</button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Purchase</DialogTitle></DialogHeader>
          {deleteTarget && (() => {
            const pCat = (deleteTarget.category || 'PAPER') as Category
            const label = pCat === 'ACCESSORY'
              ? `${deleteTarget.accessory_name} ${deleteTarget.brand_name} ${deleteTarget.gsm_value}${deleteTarget.acc_gsm_unit}`
              : `${deleteTarget.brand_name}${deleteTarget.variant ? ' ' + paperDisplayType(deleteTarget.variant) : ''} ${deleteTarget.gsm_value}gsm ${formatSize(deleteTarget.width_inches, deleteTarget.height_inches)}${deleteTarget.variant ? ' ' + deleteTarget.variant : ''}`
            return (
              <div className="flex flex-col gap-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  This will delete the purchase of <span className="font-semibold text-foreground">{deleteTarget.quantity_reams} {unitLabelPlural(pCat)}</span> of{' '}
                  <span className="font-semibold text-foreground">{label}</span> ({formatDate(deleteTarget.purchase_date)}) and remove the corresponding stock from godown.
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <DialogClose asChild><Button variant="outline" disabled={deleting}>Cancel</Button></DialogClose>
                  <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Deleting...' : 'Delete Purchase'}
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
