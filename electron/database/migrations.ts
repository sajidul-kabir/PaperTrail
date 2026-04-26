import type Database from 'better-sqlite3'

const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS brands (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS gsm_options (
        id TEXT PRIMARY KEY,
        value INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS proportions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width_inches REAL NOT NULL,
        height_inches REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(width_inches, height_inches)
      );

      CREATE TABLE IF NOT EXISTS paper_types (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL REFERENCES brands(id),
        gsm_id TEXT NOT NULL REFERENCES gsm_options(id),
        proportion_id TEXT NOT NULL REFERENCES proportions(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(brand_id, gsm_id, proportion_id)
      );

      CREATE TABLE IF NOT EXISTS stock_ledger (
        id TEXT PRIMARY KEY,
        paper_type_id TEXT NOT NULL REFERENCES paper_types(id),
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT', 'VOID_REVERSAL')),
        quantity_sheets INTEGER NOT NULL,
        reference_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY,
        paper_type_id TEXT NOT NULL REFERENCES paper_types(id),
        quantity_reams INTEGER NOT NULL,
        cost_per_ream_poisha INTEGER NOT NULL,
        total_cost_poisha INTEGER NOT NULL,
        supplier_name TEXT,
        purchase_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        organization TEXT,
        phone TEXT,
        address TEXT,
        is_walk_in INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO customers (id, name, is_walk_in) VALUES ('walk-in', 'Walk-in Customer', 1);

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        invoice_date TEXT NOT NULL,
        subtotal_poisha INTEGER NOT NULL DEFAULT 0,
        total_poisha INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'VOID')),
        void_reason TEXT,
        voided_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        paper_type_id TEXT NOT NULL REFERENCES paper_types(id),
        cut_width_inches REAL NOT NULL,
        cut_height_inches REAL NOT NULL,
        quantity_sheets INTEGER NOT NULL,
        selling_price_per_sheet_poisha INTEGER NOT NULL,
        line_total_poisha INTEGER NOT NULL,
        area_ratio REAL NOT NULL,
        full_sheets_consumed REAL NOT NULL,
        cost_per_full_sheet_poisha INTEGER NOT NULL,
        cost_total_poisha INTEGER NOT NULL,
        profit_poisha INTEGER NOT NULL,
        profit_margin_pct REAL NOT NULL,
        waste_sheets REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        amount_poisha INTEGER NOT NULL,
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'CASH' CHECK(payment_method IN ('CASH', 'BANK_TRANSFER', 'CHECK', 'OTHER')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO settings (key, value) VALUES ('business_name', 'PaperTrail Press');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('business_address', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('business_phone', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('low_stock_threshold_reams', '5');

      CREATE INDEX IF NOT EXISTS idx_stock_ledger_paper ON stock_ledger(paper_type_id);
      CREATE INDEX IF NOT EXISTS idx_purchases_paper ON purchases(paper_type_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
      CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
    `,
  },
  {
    version: 2,
    sql: `
      -- Recreate brands with category-scoped uniqueness
      CREATE TABLE brands_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, category)
      );
      INSERT INTO brands_new (id, name, created_at) SELECT id, name, created_at FROM brands;
      DROP TABLE brands;
      ALTER TABLE brands_new RENAME TO brands;

      -- Recreate gsm_options with category-scoped uniqueness
      CREATE TABLE gsm_options_new (
        id TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(value, category)
      );
      INSERT INTO gsm_options_new (id, value, created_at) SELECT id, value, created_at FROM gsm_options;
      DROP TABLE gsm_options;
      ALTER TABLE gsm_options_new RENAME TO gsm_options;

      -- Recreate proportions with category-scoped uniqueness
      CREATE TABLE proportions_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width_inches REAL NOT NULL,
        height_inches REAL NOT NULL,
        category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(width_inches, height_inches, category)
      );
      INSERT INTO proportions_new (id, name, width_inches, height_inches, created_at) SELECT id, name, width_inches, height_inches, created_at FROM proportions;
      DROP TABLE proportions;
      ALTER TABLE proportions_new RENAME TO proportions;

      -- Add category to paper_types
      ALTER TABLE paper_types ADD COLUMN category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER'));

      -- Add category to purchases
      ALTER TABLE purchases ADD COLUMN category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER'));
    `,
  },
  {
    version: 3,
    sql: `
      -- Fix: if v2 already ran with ALTER TABLE approach (no table recreation),
      -- the old unique constraints still exist. Recreate tables to fix.
      -- This is safe to run even if v2 already did it correctly.

      CREATE TABLE IF NOT EXISTS brands_fix (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, category)
      );
      INSERT OR IGNORE INTO brands_fix (id, name, category, created_at)
        SELECT id, name, COALESCE(category, 'PAPER'), created_at FROM brands;
      DROP TABLE IF EXISTS brands;
      ALTER TABLE brands_fix RENAME TO brands;

      CREATE TABLE IF NOT EXISTS gsm_options_fix (
        id TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(value, category)
      );
      INSERT OR IGNORE INTO gsm_options_fix (id, value, category, created_at)
        SELECT id, value, COALESCE(category, 'PAPER'), created_at FROM gsm_options;
      DROP TABLE IF EXISTS gsm_options;
      ALTER TABLE gsm_options_fix RENAME TO gsm_options;

      CREATE TABLE IF NOT EXISTS proportions_fix (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width_inches REAL NOT NULL,
        height_inches REAL NOT NULL,
        category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(width_inches, height_inches, category)
      );
      INSERT OR IGNORE INTO proportions_fix (id, name, width_inches, height_inches, category, created_at)
        SELECT id, name, width_inches, height_inches, COALESCE(category, 'PAPER'), created_at FROM proportions;
      DROP TABLE IF EXISTS proportions;
      ALTER TABLE proportions_fix RENAME TO proportions;
    `,
  },
  {
    version: 4,
    sql: `
      -- Accessories table
      CREATE TABLE IF NOT EXISTS accessories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Make purchases work with accessories: add accessory_id, make paper_type_id nullable
      CREATE TABLE purchases_new (
        id TEXT PRIMARY KEY,
        paper_type_id TEXT REFERENCES paper_types(id),
        accessory_id TEXT REFERENCES accessories(id),
        category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER', 'ACCESSORY')),
        quantity_reams REAL NOT NULL,
        cost_per_ream_poisha INTEGER NOT NULL,
        total_cost_poisha INTEGER NOT NULL,
        supplier_name TEXT,
        purchase_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO purchases_new (id, paper_type_id, category, quantity_reams, cost_per_ream_poisha, total_cost_poisha, supplier_name, purchase_date, notes, created_at)
        SELECT id, paper_type_id, COALESCE(category,'PAPER'), quantity_reams, cost_per_ream_poisha, total_cost_poisha, supplier_name, purchase_date, notes, created_at FROM purchases;
      DROP TABLE purchases;
      ALTER TABLE purchases_new RENAME TO purchases;
      CREATE INDEX IF NOT EXISTS idx_purchases_paper ON purchases(paper_type_id);

      -- Make stock_ledger work with accessories
      CREATE TABLE stock_ledger_new (
        id TEXT PRIMARY KEY,
        paper_type_id TEXT REFERENCES paper_types(id),
        accessory_id TEXT REFERENCES accessories(id),
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT', 'VOID_REVERSAL')),
        quantity_sheets INTEGER NOT NULL,
        reference_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO stock_ledger_new (id, paper_type_id, transaction_type, quantity_sheets, reference_id, created_at)
        SELECT id, paper_type_id, transaction_type, quantity_sheets, reference_id, created_at FROM stock_ledger;
      DROP TABLE stock_ledger;
      ALTER TABLE stock_ledger_new RENAME TO stock_ledger;
      CREATE INDEX IF NOT EXISTS idx_stock_ledger_paper ON stock_ledger(paper_type_id);
      CREATE INDEX IF NOT EXISTS idx_stock_ledger_accessory ON stock_ledger(accessory_id);

      -- Make invoice_lines work with accessories
      CREATE TABLE invoice_lines_new (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        paper_type_id TEXT REFERENCES paper_types(id),
        accessory_id TEXT REFERENCES accessories(id),
        cut_width_inches REAL,
        cut_height_inches REAL,
        quantity_sheets INTEGER NOT NULL,
        selling_price_per_sheet_poisha INTEGER NOT NULL,
        line_total_poisha INTEGER NOT NULL,
        area_ratio REAL NOT NULL DEFAULT 0,
        full_sheets_consumed REAL NOT NULL DEFAULT 0,
        cost_per_full_sheet_poisha INTEGER NOT NULL DEFAULT 0,
        cost_total_poisha INTEGER NOT NULL DEFAULT 0,
        profit_poisha INTEGER NOT NULL DEFAULT 0,
        profit_margin_pct REAL NOT NULL DEFAULT 0,
        waste_sheets REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO invoice_lines_new (id, invoice_id, paper_type_id, cut_width_inches, cut_height_inches, quantity_sheets, selling_price_per_sheet_poisha, line_total_poisha, area_ratio, full_sheets_consumed, cost_per_full_sheet_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, waste_sheets, created_at)
        SELECT id, invoice_id, paper_type_id, cut_width_inches, cut_height_inches, quantity_sheets, selling_price_per_sheet_poisha, line_total_poisha, area_ratio, full_sheets_consumed, cost_per_full_sheet_poisha, cost_total_poisha, profit_poisha, profit_margin_pct, waste_sheets, created_at FROM invoice_lines;
      DROP TABLE invoice_lines;
      ALTER TABLE invoice_lines_new RENAME TO invoice_lines;
      CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
    `,
  },
  {
    version: 5,
    sql: `
      -- Modify stock_ledger: add TRANSFER_OUT to transaction_type CHECK
      CREATE TABLE stock_ledger_v5 (
        id TEXT PRIMARY KEY,
        paper_type_id TEXT REFERENCES paper_types(id),
        accessory_id TEXT REFERENCES accessories(id),
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT', 'VOID_REVERSAL', 'TRANSFER_OUT')),
        quantity_sheets INTEGER NOT NULL,
        reference_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO stock_ledger_v5 (id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at)
        SELECT id, paper_type_id, accessory_id, transaction_type, quantity_sheets, reference_id, created_at FROM stock_ledger;
      DROP TABLE stock_ledger;
      ALTER TABLE stock_ledger_v5 RENAME TO stock_ledger;
      CREATE INDEX IF NOT EXISTS idx_stock_ledger_paper ON stock_ledger(paper_type_id);
      CREATE INDEX IF NOT EXISTS idx_stock_ledger_accessory ON stock_ledger(accessory_id);

      -- Transfers table (transfer slip header)
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY,
        transfer_number TEXT NOT NULL UNIQUE,
        transfer_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Transfer lines (each line on a slip)
      CREATE TABLE IF NOT EXISTS transfer_lines (
        id TEXT PRIMARY KEY,
        transfer_id TEXT NOT NULL REFERENCES transfers(id),
        paper_type_id TEXT REFERENCES paper_types(id),
        accessory_id TEXT REFERENCES accessories(id),
        quantity_units REAL NOT NULL,
        quantity_sheets INTEGER NOT NULL,
        cut_width_inches REAL,
        cut_height_inches REAL,
        pieces_per_sheet INTEGER NOT NULL DEFAULT 1,
        total_cut_pieces INTEGER NOT NULL,
        waste_area_per_sheet REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_transfer_lines_transfer ON transfer_lines(transfer_id);

      -- Cutting stock ledger (append-only, like stock_ledger)
      CREATE TABLE IF NOT EXISTS cutting_stock (
        id TEXT PRIMARY KEY,
        paper_type_id TEXT REFERENCES paper_types(id),
        accessory_id TEXT REFERENCES accessories(id),
        cut_width_inches REAL,
        cut_height_inches REAL,
        quantity_pieces INTEGER NOT NULL,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('TRANSFER_IN', 'SALE', 'ADJUSTMENT', 'VOID_REVERSAL')),
        reference_id TEXT,
        cost_per_piece_poisha REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cutting_stock_paper ON cutting_stock(paper_type_id);
      CREATE INDEX IF NOT EXISTS idx_cutting_stock_accessory ON cutting_stock(accessory_id);
    `,
  },
  {
    version: 6,
    sql: `
      -- Suppliers table
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Add supplier_id to purchases
      ALTER TABLE purchases ADD COLUMN supplier_id TEXT REFERENCES suppliers(id);

      -- Orders table (individual orders, before billing)
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        order_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'BILLED', 'VOID')),
        invoice_id TEXT REFERENCES invoices(id),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);

      -- Order lines table
      CREATE TABLE IF NOT EXISTS order_lines (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id),
        paper_type_id TEXT REFERENCES paper_types(id),
        accessory_id TEXT REFERENCES accessories(id),
        cut_width_inches REAL,
        cut_height_inches REAL,
        quantity_pieces INTEGER NOT NULL,
        selling_price_per_piece_poisha REAL NOT NULL,
        line_total_poisha INTEGER NOT NULL,
        cost_per_piece_poisha REAL NOT NULL DEFAULT 0,
        cost_total_poisha INTEGER NOT NULL DEFAULT 0,
        profit_poisha INTEGER NOT NULL DEFAULT 0,
        profit_margin_pct REAL NOT NULL DEFAULT 0,
        label TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
    `,
  },
  {
    version: 7,
    sql: `
      -- 1. Update brands check constraint
      CREATE TABLE brands_v7 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('PAPER', 'CARD', 'STICKER', 'ACCESSORY')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, category)
      );
      INSERT INTO brands_v7 (id, name, category, created_at)
        SELECT id, name, category, created_at FROM brands;
      DROP TABLE brands;
      ALTER TABLE brands_v7 RENAME TO brands;

      -- 2. Update gsm_options check constraint
      CREATE TABLE gsm_options_v7 (
        id TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('PAPER', 'CARD', 'STICKER', 'ACCESSORY')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(value, category)
      );
      INSERT INTO gsm_options_v7 (id, value, category, created_at)
        SELECT id, value, category, created_at FROM gsm_options;
      DROP TABLE gsm_options;
      ALTER TABLE gsm_options_v7 RENAME TO gsm_options;

      -- 3. Create accessory_types table
      CREATE TABLE IF NOT EXISTS accessory_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 4. Migrate existing accessory names to accessory_types
      INSERT OR IGNORE INTO accessory_types (id, name, created_at)
        SELECT id, name, created_at FROM accessories;

      -- 5. Create default brand and pound for existing accessories
      INSERT OR IGNORE INTO brands (id, name, category) VALUES ('default-acc-brand', 'None', 'ACCESSORY');
      INSERT OR IGNORE INTO gsm_options (id, value, category) VALUES ('default-acc-pound', 0, 'ACCESSORY');

      -- 6. Recreate accessories table as a combination table
      CREATE TABLE accessories_v7 (
        id TEXT PRIMARY KEY,
        accessory_type_id TEXT NOT NULL REFERENCES accessory_types(id),
        brand_id TEXT NOT NULL REFERENCES brands(id),
        gsm_id TEXT NOT NULL REFERENCES gsm_options(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(accessory_type_id, brand_id, gsm_id)
      );

      -- Migrate old accessories to new structure using the defaults
      INSERT INTO accessories_v7 (id, accessory_type_id, brand_id, gsm_id, created_at)
        SELECT id, id, 'default-acc-brand', 'default-acc-pound', created_at FROM accessories;

      DROP TABLE accessories;
      ALTER TABLE accessories_v7 RENAME TO accessories;
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE cutting_stock ADD COLUMN custom_label TEXT;
    `,
  },
  {
    version: 9,
    sql: `
      -- Add variant column to paper_types for carbon/color paper sub-types
      CREATE TABLE paper_types_v9 (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL REFERENCES brands(id),
        gsm_id TEXT NOT NULL REFERENCES gsm_options(id),
        proportion_id TEXT NOT NULL REFERENCES proportions(id),
        category TEXT NOT NULL DEFAULT 'PAPER' CHECK(category IN ('PAPER', 'CARD', 'STICKER')),
        variant TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(brand_id, gsm_id, proportion_id, category, variant)
      );
      INSERT INTO paper_types_v9 (id, brand_id, gsm_id, proportion_id, category, variant, created_at)
        SELECT id, brand_id, gsm_id, proportion_id, category, '', created_at FROM paper_types;
      DROP TABLE paper_types;
      ALTER TABLE paper_types_v9 RENAME TO paper_types;
    `,
  },
  {
    version: 10,
    sql: `
      -- Add unit label to gsm_options (e.g. 'lb', 'litre' for accessories; empty for paper/card/sticker which use 'gsm')
      ALTER TABLE gsm_options ADD COLUMN unit TEXT NOT NULL DEFAULT '';
      UPDATE gsm_options SET unit = 'lb' WHERE category = 'ACCESSORY';
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE order_lines ADD COLUMN quantity_sheets INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 12,
    sql: `
      ALTER TABLE customers ADD COLUMN previous_balance_poisha INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 13,
    sql: `
      CREATE TABLE IF NOT EXISTS supplier_payments (
        id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id),
        amount_poisha INTEGER NOT NULL,
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'CASH'
          CHECK(payment_method IN ('CASH', 'BANK_TRANSFER', 'CHECK', 'OTHER')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
    `,
  },
  {
    version: 14,
    sql: `
      ALTER TABLE suppliers ADD COLUMN previous_outstanding_poisha INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 15,
    sql: `
      ALTER TABLE purchases ADD COLUMN extra_cost_per_unit_poisha INTEGER NOT NULL DEFAULT 0;
    `,
  },
]

export function runMigrations(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`)

  const applied = new Set(
    db.prepare('SELECT version FROM _migrations').all().map((r: any) => r.version)
  )

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      db.exec(migration.sql)
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(migration.version)
    }
  }
}
