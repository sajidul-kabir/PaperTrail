/**
 * Seed script: 50 items across April 2026
 * Run with: npx electron --no-sandbox scripts/seed-april.cjs
 */
const Database = require('better-sqlite3')
const path = require('path')
const crypto = require('crypto')

const dbPath = path.join(process.env.APPDATA, 'papertrail', 'papertrail.db')
console.log('DB path:', dbPath)
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

function uid() { return crypto.randomUUID() }

// ── Check existing data ─────────────────────────────────────────────────────
const existing = db.prepare('SELECT COUNT(*) as c FROM brands').get()
if (existing.c > 0) {
  console.log('Database already has data (' + existing.c + ' brands). Aborting to avoid duplicates.')
  console.log('If you want to re-seed, back up and clear the database first.')
  db.close()
  process.exit(1)
}

const run = db.transaction(() => {

// ── 1. Brands ─────────────────────────────────────────────────────────────────
const brands = {
  paper: [], card: [], sticker: [], accessory: []
}
const paperBrandNames = ['Sonali', 'Desh', 'Bengal', 'Fresh', 'Star', 'Moon', 'Sun', 'Rainbow']
const cardBrandNames = ['Royal Card', 'Premium Card']
const stickerBrandNames = ['StickyMax']
const accBrandNames = ['Fresh', 'Star', 'Local']

const ins_brand = db.prepare('INSERT INTO brands (id, name, category) VALUES (?, ?, ?)')
for (const n of paperBrandNames) { const id = uid(); ins_brand.run(id, n, 'PAPER'); brands.paper.push({ id, name: n }) }
for (const n of cardBrandNames) { const id = uid(); ins_brand.run(id, n, 'CARD'); brands.card.push({ id, name: n }) }
for (const n of stickerBrandNames) { const id = uid(); ins_brand.run(id, n, 'STICKER'); brands.sticker.push({ id, name: n }) }
for (const n of accBrandNames) { const id = uid(); ins_brand.run(id, n, 'ACCESSORY'); brands.accessory.push({ id, name: n }) }
console.log('Brands:', paperBrandNames.length + cardBrandNames.length + stickerBrandNames.length + accBrandNames.length)

// ── 2. GSM Options ────────────────────────────────────────────────────────────
const gsms = { paper: [], card: [], sticker: [], accessory: [] }
const paperGsmValues = [47, 55, 60, 70, 80, 100, 120]
const cardGsmValues = [180, 230, 300]
const stickerGsmValues = [80, 120]
const accGsmValues = [0] // accessories use 0 gsm with 'lb' unit

const ins_gsm = db.prepare('INSERT INTO gsm_options (id, value, category, unit) VALUES (?, ?, ?, ?)')
for (const v of paperGsmValues) { const id = uid(); ins_gsm.run(id, v, 'PAPER', ''); gsms.paper.push({ id, value: v }) }
for (const v of cardGsmValues) { const id = uid(); ins_gsm.run(id, v, 'CARD', ''); gsms.card.push({ id, value: v }) }
for (const v of stickerGsmValues) { const id = uid(); ins_gsm.run(id, v, 'STICKER', ''); gsms.sticker.push({ id, value: v }) }
for (const v of accGsmValues) { const id = uid(); ins_gsm.run(id, v, 'ACCESSORY', 'lb'); gsms.accessory.push({ id, value: v }) }
console.log('GSM options:', paperGsmValues.length + cardGsmValues.length + stickerGsmValues.length + accGsmValues.length)

// ── 3. Proportions ────────────────────────────────────────────────────────────
const proportions = { paper: [], card: [], sticker: [] }
const paperSizes = [
  { name: '23x36', w: 23, h: 36 },
  { name: '20x30', w: 20, h: 30 },
  { name: '17x22', w: 17, h: 22 },
  { name: '22x28', w: 22, h: 28 },
  { name: 'A4', w: 8.25, h: 11.75 },
  { name: 'Legal', w: 8.5, h: 14 },
]
const cardSizes = [
  { name: '20x30', w: 20, h: 30 },
  { name: '22x28', w: 22, h: 28 },
]
const stickerSizes = [
  { name: 'A4', w: 8.25, h: 11.75 },
]

const ins_prop = db.prepare('INSERT INTO proportions (id, name, width_inches, height_inches, category) VALUES (?, ?, ?, ?, ?)')
for (const s of paperSizes) { const id = uid(); ins_prop.run(id, s.name, s.w, s.h, 'PAPER'); proportions.paper.push({ id, ...s }) }
for (const s of cardSizes) { const id = uid(); ins_prop.run(id, s.name, s.w, s.h, 'CARD'); proportions.card.push({ id, ...s }) }
for (const s of stickerSizes) { const id = uid(); ins_prop.run(id, s.name, s.w, s.h, 'STICKER'); proportions.sticker.push({ id, ...s }) }
console.log('Proportions:', paperSizes.length + cardSizes.length + stickerSizes.length)

// ── 4. Paper Types (35 paper + 5 card + 2 sticker = 42 paper_types) ──────────
const paperTypes = []
const ins_pt = db.prepare('INSERT INTO paper_types (id, brand_id, gsm_id, proportion_id, category, variant) VALUES (?, ?, ?, ?, ?, ?)')

// Paper combos - pick realistic combinations
const paperCombos = [
  // Sonali
  { brand: 0, gsm: 4, prop: 0, variant: '' },       // Sonali 80gsm 23x36
  { brand: 0, gsm: 2, prop: 0, variant: '' },       // Sonali 60gsm 23x36
  { brand: 0, gsm: 3, prop: 1, variant: '' },       // Sonali 70gsm 20x30
  { brand: 0, gsm: 4, prop: 2, variant: '' },       // Sonali 80gsm 17x22
  { brand: 0, gsm: 4, prop: 4, variant: 'PACKET' }, // Sonali 80gsm A4 PACKET
  // Desh
  { brand: 1, gsm: 4, prop: 0, variant: '' },       // Desh 80gsm 23x36
  { brand: 1, gsm: 2, prop: 0, variant: '' },       // Desh 60gsm 23x36
  { brand: 1, gsm: 3, prop: 0, variant: '' },       // Desh 70gsm 23x36
  { brand: 1, gsm: 5, prop: 1, variant: '' },       // Desh 100gsm 20x30
  // Bengal
  { brand: 2, gsm: 4, prop: 0, variant: '' },       // Bengal 80gsm 23x36
  { brand: 2, gsm: 2, prop: 1, variant: '' },       // Bengal 60gsm 20x30
  { brand: 2, gsm: 6, prop: 0, variant: '' },       // Bengal 120gsm 23x36
  // Fresh - carbon papers
  { brand: 3, gsm: 0, prop: 0, variant: 'CB White' },  // Fresh Carbon 47gsm 23x36 CB White
  { brand: 3, gsm: 0, prop: 0, variant: 'CF White' },  // Fresh Carbon 47gsm 23x36 CF White
  { brand: 3, gsm: 0, prop: 0, variant: 'CFB Yellow' }, // Fresh Carbon 47gsm 23x36 CFB Yellow
  { brand: 3, gsm: 0, prop: 1, variant: 'CB White' },  // Fresh Carbon 47gsm 20x30 CB White
  { brand: 3, gsm: 1, prop: 0, variant: 'CB White' },  // Fresh Carbon 55gsm 23x36 CB White
  // Star
  { brand: 4, gsm: 4, prop: 0, variant: '' },       // Star 80gsm 23x36
  { brand: 4, gsm: 3, prop: 0, variant: '' },       // Star 70gsm 23x36
  { brand: 4, gsm: 2, prop: 1, variant: '' },       // Star 60gsm 20x30
  { brand: 4, gsm: 5, prop: 3, variant: '' },       // Star 100gsm 22x28
  // Moon
  { brand: 5, gsm: 4, prop: 0, variant: '' },       // Moon 80gsm 23x36
  { brand: 5, gsm: 3, prop: 1, variant: '' },       // Moon 70gsm 20x30
  { brand: 5, gsm: 6, prop: 0, variant: '' },       // Moon 120gsm 23x36
  // Sun
  { brand: 6, gsm: 4, prop: 0, variant: '' },       // Sun 80gsm 23x36
  { brand: 6, gsm: 2, prop: 0, variant: '' },       // Sun 60gsm 23x36
  { brand: 6, gsm: 5, prop: 0, variant: '' },       // Sun 100gsm 23x36
  // Rainbow - color papers
  { brand: 7, gsm: 4, prop: 0, variant: 'Red' },    // Rainbow Color 80gsm 23x36 Red
  { brand: 7, gsm: 4, prop: 0, variant: 'Blue' },   // Rainbow Color 80gsm 23x36 Blue
  { brand: 7, gsm: 4, prop: 0, variant: 'Green' },  // Rainbow Color 80gsm 23x36 Green
  { brand: 7, gsm: 4, prop: 1, variant: 'Red' },    // Rainbow Color 80gsm 20x30 Red
  // More plain papers
  { brand: 0, gsm: 5, prop: 0, variant: '' },       // Sonali 100gsm 23x36
  { brand: 1, gsm: 6, prop: 0, variant: '' },       // Desh 120gsm 23x36
  { brand: 2, gsm: 3, prop: 0, variant: '' },       // Bengal 70gsm 23x36
  { brand: 4, gsm: 6, prop: 0, variant: '' },       // Star 120gsm 23x36
]

for (const c of paperCombos) {
  const id = uid()
  const b = brands.paper[c.brand], g = gsms.paper[c.gsm], p = proportions.paper[c.prop]
  ins_pt.run(id, b.id, g.id, p.id, 'PAPER', c.variant)
  const varLabel = c.variant
    ? (c.variant.startsWith('CB') || c.variant.startsWith('CF') ? ' Carbon Paper' : ' Color Paper')
    : ''
  const label = `${b.name}${varLabel} ${g.value}gsm ${Math.min(p.w,p.h)}x${Math.max(p.w,p.h)}${c.variant ? ' ' + c.variant : ''}`
  paperTypes.push({ id, label, category: 'PAPER', brandName: b.name, gsm: g.value, w: p.w, h: p.h, variant: c.variant })
}

// Card combos (5)
const cardCombos = [
  { brand: 0, gsm: 0, prop: 0 }, // Royal Card 180gsm 20x30
  { brand: 0, gsm: 1, prop: 0 }, // Royal Card 230gsm 20x30
  { brand: 0, gsm: 2, prop: 0 }, // Royal Card 300gsm 20x30
  { brand: 1, gsm: 0, prop: 1 }, // Premium Card 180gsm 22x28
  { brand: 1, gsm: 1, prop: 1 }, // Premium Card 230gsm 22x28
]
for (const c of cardCombos) {
  const id = uid()
  const b = brands.card[c.brand], g = gsms.card[c.gsm], p = proportions.card[c.prop]
  ins_pt.run(id, b.id, g.id, p.id, 'CARD', '')
  const label = `${b.name} ${g.value}gsm ${Math.min(p.w,p.h)}x${Math.max(p.w,p.h)}`
  paperTypes.push({ id, label, category: 'CARD', brandName: b.name, gsm: g.value, w: p.w, h: p.h, variant: '' })
}

// Sticker combos (2)
const stickerCombos = [
  { brand: 0, gsm: 0, prop: 0 }, // StickyMax 80gsm A4
  { brand: 0, gsm: 1, prop: 0 }, // StickyMax 120gsm A4
]
for (const c of stickerCombos) {
  const id = uid()
  const b = brands.sticker[c.brand], g = gsms.sticker[c.gsm], p = proportions.sticker[c.prop]
  ins_pt.run(id, b.id, g.id, p.id, 'STICKER', '')
  const label = `${b.name} ${g.value}gsm ${Math.min(p.w,p.h)}x${Math.max(p.w,p.h)}`
  paperTypes.push({ id, label, category: 'STICKER', brandName: b.name, gsm: g.value, w: p.w, h: p.h, variant: '' })
}

console.log('Paper types:', paperTypes.length)

// ── 5. Accessory Types & Accessories (8 accessories) ─────────────────────────
const accessoryTypes = []
const ins_at = db.prepare('INSERT INTO accessory_types (id, name) VALUES (?, ?)')
for (const n of ['Carbon Roll', 'Binding Tape', 'Envelope', 'File Folder', 'Stapler Pin', 'Rubber Band']) {
  const id = uid(); ins_at.run(id, n); accessoryTypes.push({ id, name: n })
}

const accessories = []
const ins_acc = db.prepare('INSERT INTO accessories (id, accessory_type_id, brand_id, gsm_id) VALUES (?, ?, ?, ?)')
const accCombos = [
  { type: 0, brand: 0 }, // Carbon Roll - Fresh
  { type: 0, brand: 1 }, // Carbon Roll - Star
  { type: 1, brand: 2 }, // Binding Tape - Local
  { type: 2, brand: 2 }, // Envelope - Local
  { type: 3, brand: 2 }, // File Folder - Local
  { type: 4, brand: 2 }, // Stapler Pin - Local
  { type: 5, brand: 2 }, // Rubber Band - Local
  { type: 1, brand: 0 }, // Binding Tape - Fresh
]
for (const c of accCombos) {
  const id = uid()
  const at = accessoryTypes[c.type], ab = brands.accessory[c.brand], ag = gsms.accessory[0]
  ins_acc.run(id, at.id, ab.id, ag.id)
  const label = `${at.name} ${ab.name}`
  accessories.push({ id, label })
}
console.log('Accessories:', accessories.length)

// Total items = 42 paper_types + 8 accessories = 50
const allItems = [
  ...paperTypes.map(pt => ({ ...pt, isPaper: true })),
  ...accessories.map(acc => ({ ...acc, isPaper: false })),
]
console.log('Total items:', allItems.length)

// ── 6. Suppliers ──────────────────────────────────────────────────────────────
const suppliers = []
const ins_sup = db.prepare('INSERT INTO suppliers (id, name, phone, address) VALUES (?, ?, ?, ?)')
const supplierData = [
  { name: 'Dhaka Paper House', phone: '01711-222333', address: 'Bangshal, Dhaka' },
  { name: 'Mitali Traders', phone: '01811-444555', address: 'Islampur, Dhaka' },
  { name: 'Khan Brothers', phone: '01911-666777', address: 'Chawkbazar, Chittagong' },
  { name: 'Star Accessories Ltd', phone: '01611-888999', address: 'Nawabpur, Dhaka' },
]
for (const s of supplierData) {
  const id = uid(); ins_sup.run(id, s.name, s.phone, s.address); suppliers.push({ id, ...s })
}
console.log('Suppliers:', suppliers.length)

// ── 7. Customers ──────────────────────────────────────────────────────────────
const customers = []
const ins_cust = db.prepare('INSERT INTO customers (id, name, organization, phone, address, is_walk_in) VALUES (?, ?, ?, ?, ?, ?)')
const customerData = [
  { name: 'Rahim Uddin', org: 'Rahim Printing Press', phone: '01712-111222', addr: 'Mirpur, Dhaka' },
  { name: 'Karim Sheikh', org: 'Sheikh & Sons Press', phone: '01812-333444', addr: 'Uttara, Dhaka' },
  { name: 'Jamal Hossain', org: 'Jamal Stationers', phone: '01912-555666', addr: 'Motijheel, Dhaka' },
  { name: 'Faruk Ahmed', org: 'Faruk Press Works', phone: '01612-777888', addr: 'Gulshan, Dhaka' },
  { name: 'Nasir Ali', org: 'Ali Paper Mart', phone: '01512-999000', addr: 'Dhanmondi, Dhaka' },
  { name: 'Babul Mia', org: 'Babul Printing', phone: '01712-121212', addr: 'Banani, Dhaka' },
  { name: 'Sohel Rana', org: 'Rana Enterprise', phone: '01812-343434', addr: 'Tejgaon, Dhaka' },
  { name: 'Arif Khan', org: 'Khan Offset Press', phone: '01912-565656', addr: 'Mohammadpur, Dhaka' },
  { name: 'Ripon Das', org: 'Das Brothers', phone: '01612-787878', addr: 'Wari, Dhaka' },
  { name: 'Mamun Rashid', org: 'Rashid Traders', phone: '01512-909090', addr: 'Lalbagh, Dhaka' },
  { name: 'Shakil Ahmed', org: null, phone: '01712-454545', addr: 'Badda, Dhaka' },
  { name: 'Hasan Mahmud', org: 'Mahmud Press', phone: '01812-676767', addr: 'Shyamoli, Dhaka' },
]
for (const c of customerData) {
  const id = uid(); ins_cust.run(id, c.name, c.org, c.phone, c.addr, 0); customers.push({ id, ...c })
}
console.log('Customers:', customers.length)

// ── 8. Purchases + Stock Ledger (stock up all 50 items) ──────────────────────
const ins_purchase = db.prepare('INSERT INTO purchases (id, paper_type_id, accessory_id, category, quantity_reams, cost_per_ream_poisha, extra_cost_per_unit_poisha, total_cost_poisha, supplier_name, supplier_id, purchase_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
const ins_stock = db.prepare('INSERT INTO stock_ledger (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')

let purchaseCount = 0
// Purchase paper types - each gets 1-3 purchases in late March / early April
for (const pt of paperTypes) {
  const numPurchases = 1 + Math.floor(Math.random() * 2) // 1-2 purchases
  for (let p = 0; p < numPurchases; p++) {
    const purchId = uid()
    const suppIdx = Math.floor(Math.random() * 3) // first 3 suppliers for paper
    const reams = 5 + Math.floor(Math.random() * 20) // 5-24 reams
    const sheetsPerReam = 500
    const totalSheets = reams * sheetsPerReam
    // Cost per ream: based on gsm and size
    const baseCost = (pt.gsm * 2 + 100) * 100 // poisha per ream, roughly
    const costPerReam = baseCost + Math.floor(Math.random() * 5000)
    const extraCost = Math.floor(Math.random() * 500)
    const totalCost = reams * (costPerReam + extraCost)
    const day = p === 0 ? (25 + Math.floor(Math.random() * 5)) : (1 + Math.floor(Math.random() * 10))
    const month = p === 0 ? '03' : '04'
    const purchDate = `2026-${month}-${String(day).padStart(2, '0')}`
    const createdAt = `${purchDate} 10:00:00`

    ins_purchase.run(purchId, pt.id, null, pt.category, reams, costPerReam, extraCost, totalCost, suppliers[suppIdx].name, suppliers[suppIdx].id, purchDate, createdAt)
    ins_stock.run(uid(), pt.id, null, 'PURCHASE', totalSheets, purchId, createdAt)
    purchaseCount++
  }
}

// Purchase accessories
for (const acc of accessories) {
  const purchId = uid()
  const reams = 10 + Math.floor(Math.random() * 50) // accessories use "units" as reams
  const costPerUnit = 500 + Math.floor(Math.random() * 3000) // 5-35 BDT each
  const totalCost = reams * costPerUnit
  const purchDate = `2026-03-${String(25 + Math.floor(Math.random() * 5)).padStart(2, '0')}`
  const createdAt = `${purchDate} 10:00:00`

  ins_purchase.run(purchId, null, acc.id, 'ACCESSORY', reams, costPerUnit, 0, totalCost, suppliers[3].name, suppliers[3].id, purchDate, createdAt)
  ins_stock.run(uid(), null, acc.id, 'PURCHASE', reams, purchId, createdAt)
  purchaseCount++
}
console.log('Purchases:', purchaseCount)

// ── 9. Orders + Order Lines + Invoices + Invoice Lines across April 2026 ─────
const ins_order = db.prepare('INSERT INTO orders (id, customer_id, order_date, status, invoice_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
const ins_ol = db.prepare('INSERT INTO order_lines (id, order_id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_pieces, quantity_sheets, selling_price_per_piece_poisha, line_total_poisha, cost_per_piece_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
const ins_invoice = db.prepare('INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal_poisha, total_poisha, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
const ins_il = db.prepare('INSERT INTO invoice_lines (id, invoice_id, paper_type_id, accessory_id, cut_width_inches, cut_height_inches, quantity_sheets, selling_price_per_sheet_poisha, line_total_poisha, area_ratio, full_sheets_consumed, cost_per_full_sheet_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, waste_sheets, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')

let orderCount = 0
let invoiceNum = 0

// Generate 4-8 orders per day for 30 days of April
for (let day = 1; day <= 30; day++) {
  // Skip Fridays (day of week check - April 2026: Apr 1 is Wednesday)
  // Apr 1 = Wed(3), Apr 3 = Fri(5), Apr 10 = Fri, Apr 17 = Fri, Apr 24 = Fri
  const dateObj = new Date(2026, 3, day) // month is 0-indexed
  if (dateObj.getDay() === 5) continue // Skip Friday

  const orderDate = `2026-04-${String(day).padStart(2, '0')}`
  const numOrders = 3 + Math.floor(Math.random() * 6) // 3-8 orders per day

  for (let o = 0; o < numOrders; o++) {
    const orderId = uid()
    const custIdx = Math.floor(Math.random() * customers.length)
    const customer = customers[custIdx]

    // 85% of orders are BILLED, 10% PENDING, 5% VOID
    const rand = Math.random()
    const status = rand < 0.85 ? 'BILLED' : rand < 0.95 ? 'PENDING' : 'VOID'

    let invoiceId = null
    const createdAt = `${orderDate} ${String(9 + Math.floor(Math.random() * 9)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}:00`

    // Each order has 1-4 line items
    const numLines = 1 + Math.floor(Math.random() * 4)
    const usedItems = new Set()
    const orderLines = []

    for (let l = 0; l < numLines; l++) {
      let itemIdx
      do { itemIdx = Math.floor(Math.random() * allItems.length) } while (usedItems.has(itemIdx))
      usedItems.add(itemIdx)
      const item = allItems[itemIdx]

      if (item.isPaper) {
        // Paper item - sell cut pieces
        const cutW = [4, 5, 6, 8, 8.25, 8.5, 10, 11][Math.floor(Math.random() * 8)]
        const cutH = [6, 8, 10, 11, 11.75, 13, 14, 15][Math.floor(Math.random() * 8)]
        const qtyPieces = (5 + Math.floor(Math.random() * 200)) * 5 // multiples of 5, 25-1025
        // Pieces per sheet calculation (approximate)
        const fullW = item.w || 23, fullH = item.h || 36
        const piecesPerSheet = Math.max(1, Math.floor((fullW / cutW)) * Math.floor((fullH / cutH)))
        const qtySheets = Math.ceil(qtyPieces / piecesPerSheet)

        // Cost per piece based on gsm
        const costPerPiece = Math.round((item.gsm || 80) * 0.3 + 5 + Math.random() * 10) * 100 // poisha
        const sellingPerPiece = Math.round(costPerPiece * (1.1 + Math.random() * 0.3)) // 10-40% markup
        const lineTotal = Math.round(qtyPieces * sellingPerPiece)
        const costTotal = Math.round(qtyPieces * costPerPiece)
        const profit = lineTotal - costTotal
        const margin = lineTotal > 0 ? (profit * 100) / lineTotal : 0

        orderLines.push({
          id: uid(), paperId: item.id, accId: null,
          cutW, cutH, qtyPieces, qtySheets,
          sellingPerPiece, lineTotal, costPerPiece, costTotal,
          profit, margin, label: item.label
        })
      } else {
        // Accessory item
        const qtyPieces = 1 + Math.floor(Math.random() * 20)
        const costPerPiece = (200 + Math.floor(Math.random() * 2000)) * 100 // 200-2200 BDT in poisha
        const sellingPerPiece = Math.round(costPerPiece * (1.15 + Math.random() * 0.25))
        const lineTotal = qtyPieces * sellingPerPiece
        const costTotal = qtyPieces * costPerPiece
        const profit = lineTotal - costTotal
        const margin = lineTotal > 0 ? (profit * 100) / lineTotal : 0

        orderLines.push({
          id: uid(), paperId: null, accId: item.id,
          cutW: null, cutH: null, qtyPieces, qtySheets: qtyPieces,
          sellingPerPiece, lineTotal, costPerPiece, costTotal,
          profit, margin, label: item.label
        })
      }
    }

    const orderTotal = orderLines.reduce((s, l) => s + l.lineTotal, 0)

    // Create invoice for BILLED orders
    if (status === 'BILLED') {
      invoiceNum++
      invoiceId = uid()
      const invNumber = `2026-${invoiceNum}`
      ins_invoice.run(invoiceId, invNumber, customer.id, orderDate, orderTotal, orderTotal, 'ACTIVE', createdAt)

      // Invoice lines
      for (const ol of orderLines) {
        const sellingPerSheet = ol.qtySheets > 0 ? Math.round(ol.lineTotal / ol.qtySheets) : ol.sellingPerPiece
        const costPerSheet = ol.qtySheets > 0 ? Math.round(ol.costTotal / ol.qtySheets) : ol.costPerPiece
        ins_il.run(uid(), invoiceId, ol.paperId, ol.accId, ol.cutW, ol.cutH, ol.qtySheets, sellingPerSheet, ol.lineTotal, 1, ol.qtySheets, costPerSheet, ol.costTotal, ol.profit, ol.margin, 0, createdAt)
      }
    }

    ins_order.run(orderId, customer.id, orderDate, status, invoiceId, null, createdAt)

    for (const ol of orderLines) {
      ins_ol.run(ol.id, orderId, ol.paperId, ol.accId, ol.cutW, ol.cutH, ol.qtyPieces, ol.qtySheets, ol.sellingPerPiece, ol.lineTotal, ol.costPerPiece, ol.costTotal, ol.profit, ol.margin, ol.label, createdAt)

      // Stock ledger SALE entries for non-VOID orders
      if (status !== 'VOID') {
        ins_stock.run(uid(), ol.paperId, ol.accId, 'SALE', -ol.qtySheets, orderId, createdAt)
      }
    }

    orderCount++
  }
}
console.log('Orders:', orderCount, '| Invoices:', invoiceNum)

// ── 10. Payments (partial payments for some customers) ───────────────────────
const ins_payment = db.prepare('INSERT INTO payments (id, customer_id, amount_poisha, payment_date, payment_method, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
let paymentCount = 0

// For each customer, pay 50-90% of their total invoices
for (const cust of customers) {
  const row = db.prepare('SELECT COALESCE(SUM(total_poisha), 0) as total FROM invoices WHERE customer_id = ? AND status = ?').get(cust.id, 'ACTIVE')
  const totalOwed = row.total
  if (totalOwed <= 0) continue

  const payRatio = 0.5 + Math.random() * 0.4 // 50-90%
  const totalPay = Math.round(totalOwed * payRatio)

  // Split into 2-4 payments across April
  const numPayments = 2 + Math.floor(Math.random() * 3)
  let remaining = totalPay
  for (let p = 0; p < numPayments; p++) {
    const amount = p === numPayments - 1 ? remaining : Math.round(remaining / (numPayments - p) * (0.8 + Math.random() * 0.4))
    if (amount <= 0) continue
    remaining -= amount
    const payDay = 5 + Math.floor(Math.random() * 25)
    const payDate = `2026-04-${String(payDay).padStart(2, '0')}`
    const method = Math.random() < 0.6 ? 'CASH' : Math.random() < 0.5 ? 'BANK_TRANSFER' : 'CHECK'
    ins_payment.run(uid(), cust.id, amount, payDate, method, null, `${payDate} 12:00:00`)
    paymentCount++
  }
}
console.log('Payments:', paymentCount)

}) // end transaction

run()
console.log('\nSeed complete!')
db.close()
process.exit(0)
