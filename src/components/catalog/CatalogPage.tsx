import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { Trash2 } from 'lucide-react'
import { dbRun, dbQuery, dbTransaction } from '@/lib/ipc'
import { useQuery } from '@/hooks/useQuery'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { formatSize } from '@/lib/utils'
import type { Category } from '@/lib/paper-type'

// ─── Shared Types ────────────────────────────────────────────────────────────

interface Brand { id: string; name: string }
interface GsmOption { id: string; value: number }
interface Proportion { id: string; width_inches: number; height_inches: number }
interface AccessoryType { id: string; name: string }

// ─── Brands Sub-Tab ──────────────────────────────────────────────────────────

function BrandsSection({ category }: { category: Category }) {
  const { addToast } = useToast()
  const { data: brands, refetch } = useQuery<Brand>(
    `SELECT id, name FROM brands WHERE category = ? ORDER BY name`, [category], [category]
  )
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) { addToast({ title: 'Brand name is required', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await dbRun('INSERT INTO brands (id, name, category) VALUES (?, ?, ?)', [uuid(), trimmed, category])
      setName('')
      refetch()
      addToast({ title: 'Brand added' })
    } catch (err: any) {
      addToast({ title: 'Failed to add brand', description: err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const filtered = brands.filter(b => b.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input placeholder="Brand name" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()} className="max-w-xs" />
        <Button onClick={handleAdd} disabled={saving} size="sm">Add Brand</Button>
        <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-xs" />
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Brand Name</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow><TableCell colSpan={2} className="text-muted-foreground italic">No brands yet.</TableCell></TableRow>
          ) : filtered.map(brand => (
            <TableRow key={brand.id}>
              <TableCell>{brand.name}</TableCell>
              <TableCell>
                <button className="text-muted-foreground hover:text-destructive transition-colors" title="Delete"
                  onClick={async () => {
                    try {
                      let usedCount = 0
                      if (category === 'ACCESSORY') {
                        const used = await dbQuery<{ cnt: number }>(
                          `SELECT COUNT(*) as cnt FROM accessories WHERE brand_id = ?`, [brand.id])
                        usedCount = used[0]?.cnt || 0
                      } else {
                        const used = await dbQuery<{ cnt: number }>(
                          `SELECT COUNT(*) as cnt FROM paper_types pt WHERE pt.brand_id = ? AND (
                            EXISTS (SELECT 1 FROM stock_ledger sl WHERE sl.paper_type_id = pt.id) OR
                            EXISTS (SELECT 1 FROM invoice_lines il WHERE il.paper_type_id = pt.id))`, [brand.id])
                        usedCount = used[0]?.cnt || 0
                      }

                      if (usedCount > 0) { addToast({ title: 'Cannot delete', description: 'In use.', variant: 'destructive' }); return }
                      
                      const statements = [{ sql: 'DELETE FROM brands WHERE id = ?', params: [brand.id] }]
                      if (category !== 'ACCESSORY') {
                        statements.unshift({ sql: 'DELETE FROM paper_types WHERE brand_id = ?', params: [brand.id] })
                      }
                      await dbTransaction(statements)
                      refetch()
                      addToast({ title: 'Brand deleted' })
                    } catch (err: any) { addToast({ title: 'Cannot delete', description: err.message, variant: 'destructive' }) }
                  }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── GSM Sub-Tab ─────────────────────────────────────────────────────────────

function GsmSection({ category }: { category: Category }) {
  const { addToast } = useToast()
  const { data: gsmOptions, refetch } = useQuery<GsmOption>(
    `SELECT id, value FROM gsm_options WHERE category = ? ORDER BY value`, [category], [category]
  )
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const label = category === 'ACCESSORY' ? 'Pound' : 'GSM'

  async function handleAdd() {
    const parsed = parseInt(value.trim(), 10)
    if (!value.trim() || isNaN(parsed) || parsed < 0) { addToast({ title: `Valid ${label} value required`, variant: 'destructive' }); return }
    setSaving(true)
    try {
      await dbRun('INSERT INTO gsm_options (id, value, category) VALUES (?, ?, ?)', [uuid(), parsed, category])
      setValue('')
      refetch()
      addToast({ title: `${label} option added` })
    } catch (err: any) { addToast({ title: 'Failed', description: err.message, variant: 'destructive' }) }
    finally { setSaving(false) }
  }

  const filtered = gsmOptions.filter(g => String(g.value).includes(filter))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input type="number" placeholder={`${label} (e.g. ${category === 'ACCESSORY' ? '10' : '80'})`} value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()} className="max-w-xs" min={0} />
        <Button onClick={handleAdd} disabled={saving} size="sm">Add {label}</Button>
        <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-xs" />
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>{label}</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow><TableCell colSpan={2} className="text-muted-foreground italic">No {label.toLowerCase()} options yet.</TableCell></TableRow>
          ) : filtered.map(g => (
            <TableRow key={g.id}>
              <TableCell>{g.value} {label.toLowerCase()}</TableCell>
              <TableCell>
                <button className="text-muted-foreground hover:text-destructive transition-colors" title="Delete"
                  onClick={async () => {
                    try {
                      let usedCount = 0
                      if (category === 'ACCESSORY') {
                        const used = await dbQuery<{ cnt: number }>(
                          `SELECT COUNT(*) as cnt FROM accessories WHERE gsm_id = ?`, [g.id])
                        usedCount = used[0]?.cnt || 0
                      } else {
                        const used = await dbQuery<{ cnt: number }>(
                          `SELECT COUNT(*) as cnt FROM paper_types pt WHERE pt.gsm_id = ? AND (
                            EXISTS (SELECT 1 FROM stock_ledger sl WHERE sl.paper_type_id = pt.id) OR
                            EXISTS (SELECT 1 FROM invoice_lines il WHERE il.paper_type_id = pt.id))`, [g.id])
                        usedCount = used[0]?.cnt || 0
                      }

                      if (usedCount > 0) { addToast({ title: 'Cannot delete', description: 'In use.', variant: 'destructive' }); return }

                      const statements = [{ sql: 'DELETE FROM gsm_options WHERE id = ?', params: [g.id] }]
                      if (category !== 'ACCESSORY') {
                        statements.unshift({ sql: 'DELETE FROM paper_types WHERE gsm_id = ?', params: [g.id] })
                      }
                      await dbTransaction(statements)
                      refetch()
                      addToast({ title: `${label} option deleted` })
                    } catch (err: any) { addToast({ title: 'Cannot delete', description: err.message, variant: 'destructive' }) }
                  }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Sizes Sub-Tab ───────────────────────────────────────────────────────────

function SizesSection({ category }: { category: Category }) {
  const { addToast } = useToast()
  const { data: proportions, refetch } = useQuery<Proportion>(
    `SELECT id, width_inches, height_inches FROM proportions WHERE category = ? ORDER BY width_inches, height_inches`, [category], [category]
  )
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  async function handleAdd() {
    const w = parseFloat(width), h = parseFloat(height)
    if (isNaN(w) || w <= 0 || isNaN(h) || h <= 0) { addToast({ title: 'Valid width and height required', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await dbRun('INSERT INTO proportions (id, name, width_inches, height_inches, category) VALUES (?, ?, ?, ?, ?)',
        [uuid(), `${w}x${h}`, w, h, category])
      setWidth(''); setHeight('')
      refetch()
      addToast({ title: 'Size added' })
    } catch (err: any) { addToast({ title: 'Failed', description: err.message, variant: 'destructive' }) }
    finally { setSaving(false) }
  }

  const filtered = proportions.filter(p => formatSize(p.width_inches, p.height_inches).includes(filter.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Input type="number" placeholder="Width (in)" value={width} onChange={e => setWidth(e.target.value)} className="w-32" min={0} step={0.01} />
        <Input type="number" placeholder="Height (in)" value={height} onChange={e => setHeight(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()} className="w-32" min={0} step={0.01} />
        <Button onClick={handleAdd} disabled={saving} size="sm">Add Size</Button>
        <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-xs" />
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Size (inches)</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow><TableCell colSpan={2} className="text-muted-foreground italic">No sizes yet.</TableCell></TableRow>
          ) : filtered.map(p => (
            <TableRow key={p.id}>
              <TableCell>{formatSize(p.width_inches, p.height_inches)}</TableCell>
              <TableCell>
                <button className="text-muted-foreground hover:text-destructive transition-colors" title="Delete"
                  onClick={async () => {
                    try {
                      const used = await dbQuery<{ cnt: number }>(
                        `SELECT COUNT(*) as cnt FROM paper_types pt WHERE pt.proportion_id = ? AND (
                          EXISTS (SELECT 1 FROM stock_ledger sl WHERE sl.paper_type_id = pt.id) OR
                          EXISTS (SELECT 1 FROM invoice_lines il WHERE il.paper_type_id = pt.id))`, [p.id])
                      if (used[0]?.cnt > 0) { addToast({ title: 'Cannot delete', description: 'In use.', variant: 'destructive' }); return }
                      await dbTransaction([
                        { sql: 'DELETE FROM paper_types WHERE proportion_id = ?', params: [p.id] },
                        { sql: 'DELETE FROM proportions WHERE id = ?', params: [p.id] },
                      ])
                      refetch()
                      addToast({ title: 'Size deleted' })
                    } catch (err: any) { addToast({ title: 'Cannot delete', description: err.message, variant: 'destructive' }) }
                  }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Accessory Types Sub-Tab ────────────────────────────────────────────────

function AccessoryTypesSection() {
  const { addToast } = useToast()
  const { data: types, refetch } = useQuery<AccessoryType>('SELECT id, name FROM accessory_types ORDER BY name')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) { addToast({ title: 'Accessory name is required', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await dbRun('INSERT INTO accessory_types (id, name) VALUES (?, ?)', [uuid(), trimmed])
      setName('')
      refetch()
      addToast({ title: 'Accessory name added' })
    } catch (err: any) { addToast({ title: 'Failed', description: err.message, variant: 'destructive' }) }
    finally { setSaving(false) }
  }

  const filtered = types.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input placeholder="Accessory name (e.g. Ink, Glue)" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()} className="max-w-xs" />
        <Button onClick={handleAdd} disabled={saving} size="sm">Add Name</Button>
        <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-xs" />
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Accessory Name</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow><TableCell colSpan={2} className="text-muted-foreground italic">No names yet.</TableCell></TableRow>
          ) : filtered.map(type => (
            <TableRow key={type.id}>
              <TableCell>{type.name}</TableCell>
              <TableCell>
                <button className="text-muted-foreground hover:text-destructive transition-colors" title="Delete"
                  onClick={async () => {
                    try {
                      const used = await dbQuery<{ cnt: number }>(
                        `SELECT COUNT(*) as cnt FROM accessories WHERE accessory_type_id = ?`, [type.id])
                      if (used[0]?.cnt > 0) { addToast({ title: 'Cannot delete', description: 'In use.', variant: 'destructive' }); return }
                      await dbRun('DELETE FROM accessory_types WHERE id = ?', [type.id])
                      refetch()
                      addToast({ title: 'Accessory name deleted' })
                    } catch (err: any) { addToast({ title: 'Cannot delete', description: err.message, variant: 'destructive' }) }
                  }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Category Panel ──────────────────────────────────────────────────────────

function CategoryPanel({ category }: { category: Category }) {
  return (
    <Tabs defaultValue="brands">
      <TabsList>
        <TabsTrigger value="brands">Brands</TabsTrigger>
        <TabsTrigger value="gsm">{category === 'ACCESSORY' ? 'Pounds' : 'GSM'}</TabsTrigger>
        {category !== 'ACCESSORY' && <TabsTrigger value="sizes">Sizes</TabsTrigger>}
        {category === 'ACCESSORY' && <TabsTrigger value="types">Names</TabsTrigger>}
      </TabsList>
      <TabsContent value="brands" className="pt-4"><BrandsSection category={category} /></TabsContent>
      <TabsContent value="gsm" className="pt-4"><GsmSection category={category} /></TabsContent>
      {category !== 'ACCESSORY' && <TabsContent value="sizes" className="pt-4"><SizesSection category={category} /></TabsContent>}
      {category === 'ACCESSORY' && <TabsContent value="types" className="pt-4"><AccessoryTypesSection /></TabsContent>}
    </Tabs>
  )
}

// ─── CatalogPage ─────────────────────────────────────────────────────────────

export function CatalogPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
      <p className="text-sm text-muted-foreground -mt-2">
        Manage brands, GSM values, sizes, and accessories. Combinations are created automatically on purchase or sale.
      </p>

      <Tabs defaultValue="PAPER">
        <TabsList>
          <TabsTrigger value="PAPER">Paper</TabsTrigger>
          <TabsTrigger value="CARD">Card</TabsTrigger>
          <TabsTrigger value="STICKER">Sticker</TabsTrigger>
          <TabsTrigger value="ACCESSORY">Accessories</TabsTrigger>
        </TabsList>
        <TabsContent value="PAPER" className="pt-4"><CategoryPanel category="PAPER" /></TabsContent>
        <TabsContent value="CARD" className="pt-4"><CategoryPanel category="CARD" /></TabsContent>
        <TabsContent value="STICKER" className="pt-4"><CategoryPanel category="STICKER" /></TabsContent>
        <TabsContent value="ACCESSORY" className="pt-4"><CategoryPanel category="ACCESSORY" /></TabsContent>
      </Tabs>
    </div>
  )
}
