# PaperTrail — Press & Paper Business Accounting Software

## Overview

Desktop accounting application for a press and paper business. The business **buys paper in reams** (500 sheets) and **sells cut portions** of those sheets in custom sizes. The core problem: they lose visibility into per-order profitability because the buy and sell units don't match. This software bridges that gap.

**Target user:** A small press/paper shop in Bangladesh. 1-3 operators. Dense, data-entry-heavy workflows.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Electron |
| Frontend | React + TypeScript |
| UI components | shadcn/ui (Radix + Tailwind) |
| Database (local) | SQLite (via better-sqlite3 or drizzle-orm) |
| ORM | Drizzle ORM |
| PDF generation | @react-pdf/renderer or jsPDF |
| Charts | Recharts |
| Build tool | Vite + electron-builder |
| Cloud sync | Deferred — design DB layer with a sync-friendly schema (UUIDs, timestamps, soft deletes) |

---

## Data Model

### Paper Catalog

The catalog defines what paper types exist. Three orthogonal dimensions, all user-extendable:

- **Brand** — e.g., Bashundhara, TK, Creative
- **GSM** — e.g., 120, 100, 80
- **Proportion (Size)** — e.g., D/D 23×36", D/C 20×30" (stored as name + width + height in inches)

A **Paper Type** is the combination: `Brand × GSM × Proportion`. Example: *Bashundhara 120gsm D/D 23×36"*.

```
brands:        { id, name, created_at }
gsm_options:   { id, value, created_at }
proportions:   { id, name, width_inches, height_inches, created_at }
paper_types:   { id, brand_id, gsm_id, proportion_id, created_at }
```

### Inventory / Stock

Stock is tracked at the `paper_type` level in **reams** and **sheets**.

```
stock_ledger: {
  id (UUID),
  paper_type_id,
  transaction_type (PURCHASE | SALE | ADJUSTMENT | VOID_REVERSAL),
  quantity_sheets (positive for in, negative for out),
  reference_id (purchase_id or sale_line_id),
  created_at
}
```

**Current stock** = `SUM(quantity_sheets) WHERE paper_type_id = X`. Displayed as both sheets and reams (÷500).

### Purchases

```
purchases: {
  id (UUID),
  paper_type_id,
  quantity_reams,
  cost_per_ream (BDT),
  total_cost (BDT),
  supplier_name (nullable text),
  purchase_date,
  notes (nullable),
  created_at
}
```

On purchase creation → insert into `stock_ledger` with `+quantity_reams × 500` sheets.

**Average cost** is computed as: `SUM(cost_per_ream × quantity_reams) / SUM(quantity_reams)` across all purchases for a paper type with remaining stock.

### Customers

```
customers: {
  id (UUID),
  name,
  organization (nullable),
  phone (nullable),
  address (nullable),
  is_walk_in (boolean, default false),
  created_at
}
```

One special system record: **"Walk-in Customer"** (`is_walk_in = true`). Used for anonymous cash sales.

### Invoices (Sales)

```
invoices: {
  id (UUID),
  invoice_number (TEXT, format: "YYYY-NNNN", e.g., "2026-0001"),
  customer_id,
  invoice_date,
  subtotal (BDT),
  total (BDT),
  status (ACTIVE | VOID),
  void_reason (nullable),
  voided_at (nullable),
  notes (nullable),
  created_at
}

invoice_lines: {
  id (UUID),
  invoice_id,
  paper_type_id,
  cut_width_inches,
  cut_height_inches,
  quantity_sheets,
  selling_price_per_sheet (BDT),
  line_total (BDT),

  -- Computed/stored for profit tracking:
  area_ratio,           -- (cut_w × cut_h) / (full_w × full_h)
  full_sheets_consumed, -- quantity_sheets × area_ratio
  cost_per_full_sheet,  -- avg cost at time of sale (snapshot)
  cost_total,           -- full_sheets_consumed × cost_per_full_sheet
  profit,               -- line_total - cost_total
  profit_margin_pct,    -- (profit / line_total) × 100

  -- Waste tracking:
  waste_sheets,         -- full_sheets_consumed - (usable output in full-sheet equivalents)
  created_at
}
```

**Area ratio calculation:**
```
area_ratio = (cut_width × cut_height) / (full_sheet_width × full_sheet_height)
full_sheets_consumed = quantity_sheets × area_ratio
```

Example: Selling 3000 sheets of 11.5×18 from D/D 23×36:
- area_ratio = (11.5 × 18) / (23 × 36) = 207 / 828 = 0.25
- full_sheets_consumed = 3000 × 0.25 = 750 sheets = 1.5 reams

**Waste calculation:**
- Theoretical pieces per sheet = floor(full_width / cut_width) × floor(full_height / cut_height)
- Also check rotated orientation: floor(full_width / cut_height) × floor(full_height / cut_width)
- Use the better of the two orientations
- Waste = full_sheets_consumed − (quantity_sheets / best_pieces_per_sheet)
- If area_ratio perfectly divides (like 1/4), waste is 0

**On invoice creation:**
1. For each line item, compute all derived fields
2. Deduct `full_sheets_consumed` from stock_ledger
3. Snapshot the average cost at time of sale

**On invoice void:**
1. Set status = VOID
2. Reverse stock deductions (insert positive stock_ledger entry with type VOID_REVERSAL)
3. Do NOT delete the invoice — preserve audit trail

### Payments (Accounts Receivable)

```
payments: {
  id (UUID),
  customer_id,
  amount (BDT),
  payment_date,
  payment_method (CASH | BANK_TRANSFER | CHECK | OTHER),
  notes (nullable),
  created_at
}
```

**Customer balance** = `SUM(invoice totals WHERE status=ACTIVE) - SUM(payments)` for that customer.

Payments are applied against the customer's **overall balance**, not specific invoices.

---

## Invoice Numbering

Format: `YYYY-NNNN` (e.g., `2026-0001`)

- Auto-incrementing within each year
- Resets to 0001 on January 1st
- Voided invoices keep their number (gap is expected and acceptable)

---

## Key Screens & Workflows

### 1. Dashboard (Home)

**Dense, data-rich layout.** Revenue and profit focused.

- **Today's summary cards:** Total sales (BDT), Total profit (BDT), Avg profit margin (%), Number of invoices
- **Sales chart:** Daily sales/profit for the last 30 days (bar or line chart)
- **Recent invoices:** Table of last 10-20 invoices with customer, total, profit, status
- **Low stock alerts:** Paper types below a configurable threshold (in reams)

### 2. Paper Catalog Management

- Table listing all paper types (Brand × GSM × Size) with current stock
- Inline quick-add for new brands, GSM values, and proportions
- Each can be added independently; paper types are created by combining them
- Cannot delete a brand/gsm/proportion that is referenced by stock or invoices (soft constraint)

### 3. Purchase Entry

- Form: Select paper type (or quick-add new), quantity in reams, cost per ream, supplier name (optional), date
- On save: stock is updated immediately
- Purchase history table with filters by date range, paper type, supplier

### 4. New Sale / Invoice Creation

This is the **most critical workflow**. Must be fast and efficient.

**Step 1 — Header:**
- Select or create customer (searchable dropdown with "Walk-in" option)
- Invoice date (defaults to today)

**Step 2 — Line items (repeatable):**
- Select paper type from catalog (searchable dropdown with quick-add)
- Enter cut size: width × height (inches)
- Enter quantity (in sheets)
- Enter selling price per sheet (BDT)
- **Instant calculation shown:** area ratio, full sheets consumed, cost basis, profit, profit margin %
- Add more line items as needed

**Step 3 — Review & Save:**
- Shows invoice summary: all line items, subtotal, total, total profit, overall margin
- Save → generates invoice number, deducts stock, records sale
- Option to generate PDF immediately

### 5. Invoice List & Management

- Filterable table: date range, customer, status (active/void)
- Click to view invoice detail
- "Void" button with required reason
- "Generate PDF" button
- Search by invoice number

### 6. Customer Management

- Customer list with name, org, phone, outstanding balance
- Click into customer → see all invoices, all payments, running balance
- "Record Payment" button → amount, date, method, notes

### 7. Payments

- Record payment against a customer
- Payment history with filters
- Outstanding balances report

### 8. Inventory / Stock View

- Table: Paper type | Current stock (reams) | Current stock (sheets) | Avg cost/ream | Total value
- Stock movement history per paper type (purchases in, sales out, adjustments)
- Low stock highlighting

### 9. Reports

In-app viewable reports:

- **Sales report:** Daily/weekly/monthly sales totals and profit
- **Profit analysis:** By paper type, by customer, by time period
- **Stock report:** Current inventory valuation, stock movement summary
- **Customer balances:** All customers with outstanding amounts

---

## PDF Invoice Format

Simple, professional layout:

```
[Business Name & Address]
                                        Invoice #: 2026-0042
                                        Date: 2026-03-24

Bill To:
  [Customer Name]
  [Organization]

─────────────────────────────────────────────────────────────
  #  | Paper Type          | Cut Size  | Qty   | Rate  | Amount
─────────────────────────────────────────────────────────────
  1  | Bashundhara 120 D/D | 11.5×18"  | 3000  | 2.50  | 7,500
  2  | TK 100 D/C          | 10×15"    | 1500  | 1.80  | 2,700
─────────────────────────────────────────────────────────────
                                          Subtotal: 10,200 BDT
                                             Total: 10,200 BDT

  Previous Balance:  15,000 BDT
  This Invoice:      10,200 BDT
  Total Outstanding: 25,200 BDT
```

---

## Currency

BDT (Bangladeshi Taka) only. No tax/VAT fields. Stored as integers in **poisha** (1 BDT = 100 poisha) to avoid floating point issues. Displayed as BDT with 2 decimal places.

---

## Design Direction

**Dense & data-rich.** Optimized for speed of data entry, not aesthetics.

- Compact tables with minimal padding
- Keyboard-navigable forms (Tab through fields)
- Muted color palette — let data stand out
- Light theme default (dark mode toggle as stretch goal)
- Monospace numbers in tables for alignment
- Color-coded profit margins (green = good, yellow = thin, red = loss)

---

## Project Structure

```
tajul/
├── electron/
│   ├── main.ts              # Electron main process
│   ├── preload.ts           # Preload script (IPC bridge)
│   └── database/
│       ├── schema.ts         # Drizzle schema definitions
│       ├── migrations/       # SQL migrations
│       └── db.ts             # Database connection & init
├── src/
│   ├── App.tsx
│   ├── main.tsx              # React entry point
│   ├── components/
│   │   ├── ui/               # shadcn/ui components
│   │   ├── layout/           # Shell, sidebar, header
│   │   ├── dashboard/        # Dashboard widgets
│   │   ├── catalog/          # Paper catalog CRUD
│   │   ├── purchases/        # Purchase entry & history
│   │   ├── sales/            # Invoice creation & management
│   │   ├── customers/        # Customer management
│   │   ├── payments/         # Payment recording
│   │   ├── inventory/        # Stock views
│   │   └── reports/          # Report views
│   ├── lib/
│   │   ├── calculations.ts   # Cut ratios, profit, waste formulas
│   │   ├── ipc.ts            # IPC renderer-side helpers
│   │   ├── pdf.ts            # Invoice PDF generation
│   │   └── utils.ts          # Formatting, currency helpers
│   ├── hooks/                # React hooks for data fetching
│   └── types/                # Shared TypeScript types
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
├── electron-builder.yml
└── SPEC.md
```

---

## Sync-Ready Design Decisions

Even though cloud sync is deferred, the schema is designed for it:

- All primary keys are **UUIDs** (not auto-increment integers)
- All records have **created_at** timestamps
- Deletes are **soft** (voided, not removed)
- Stock is a **ledger** (append-only log), not a mutable counter — merge-friendly

---

## Open Questions (To Confirm with Uncle)

1. **Business name & address** for invoice header — needed before invoice PDF can be finalized
2. **Low stock threshold** — what ream count should trigger an alert? (configurable, but need a sensible default)
3. **Payment terms** — is there a standard credit period (30 days, 60 days), or is it informal?
4. **Common cut sizes** — would a "favorites" or "recent cuts" feature speed things up? Pre-populate common sizes?
5. **Multi-location** — is there only one shop, or could this expand to multiple locations?

---

## Implementation Phases

### Phase 1 — Foundation
- Electron + React + TypeScript project setup with Vite
- SQLite database with Drizzle ORM schema & migrations
- IPC bridge between main and renderer processes
- App shell: sidebar navigation, layout components

### Phase 2 — Paper Catalog & Inventory
- Brand / GSM / Proportion CRUD
- Paper type management (combination of the three)
- Stock view (read-only at this point)

### Phase 3 — Purchases
- Purchase entry form
- Stock ledger updates on purchase
- Purchase history view
- Average cost calculation

### Phase 4 — Sales & Invoicing (Core)
- Customer management (CRUD + walk-in)
- Invoice creation workflow with line items
- Cut size → area ratio → profit calculations
- Waste tracking
- Stock deduction on sale
- Invoice list, detail view, void functionality
- Invoice number generation (YYYY-NNNN)

### Phase 5 — Payments & Credit
- Payment recording against customer balance
- Customer balance computation
- Outstanding balances view

### Phase 6 — Dashboard & Reports
- Daily summary dashboard with charts
- Sales, profit, stock, and customer balance reports

### Phase 7 — PDF & Polish
- Invoice PDF generation & export
- Low stock alerts
- Keyboard navigation optimization
- Edge case handling & error states

### Phase 8 (Future) — Cloud Sync
- Backend service selection
- Sync protocol implementation
- Conflict resolution strategy
