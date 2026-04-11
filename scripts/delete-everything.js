/**
 * delete-everything.js
 *
 * Deletes ALL data from every table in the PaperTrail database.
 * Preserves table structure, migrations, and settings.
 * Re-inserts the default Walk-in Customer.
 *
 * Usage: node scripts/delete-everything.js
 *
 * WARNING: This is destructive and irreversible. Back up your database first.
 */

const path = require('path')
const Database = require('better-sqlite3')
const { app } = require('electron')

// Resolve DB path — same logic as electron/database/db.ts
let dbPath
try {
  // If running inside Electron
  dbPath = path.join(app.getPath('userData'), 'papertrail.db')
} catch {
  // Fallback: look for the DB in common Electron userData locations
  const os = require('os')
  const platform = process.platform
  const appName = 'papertrail'

  if (platform === 'win32') {
    dbPath = path.join(os.homedir(), 'AppData', 'Roaming', appName, 'papertrail.db')
  } else if (platform === 'darwin') {
    dbPath = path.join(os.homedir(), 'Library', 'Application Support', appName, 'papertrail.db')
  } else {
    dbPath = path.join(os.homedir(), '.config', appName, 'papertrail.db')
  }
}

console.log(`Database path: ${dbPath}`)

const fs = require('fs')
if (!fs.existsSync(dbPath)) {
  console.error('Database file not found at:', dbPath)
  console.error('If your DB is elsewhere, edit dbPath in this script.')
  process.exit(1)
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF') // Disable FK checks during deletion

// Order matters — delete child tables before parent tables
const tables = [
  // Ledgers & line items (no children depend on these)
  'cutting_stock',
  'order_lines',
  'invoice_lines',
  'transfer_lines',
  'stock_ledger',

  // Transaction headers
  'orders',
  'invoices',
  'transfers',
  'payments',
  'purchases',

  // Catalog & reference
  'paper_types',
  'accessories',
  'accessory_types',
  'proportions',
  'gsm_options',
  'brands',
  'suppliers',

  // Customers (after orders/invoices/payments)
  'customers',
]

console.log('\n--- Deleting all data ---\n')

const deleteAll = db.transaction(() => {
  for (const table of tables) {
    try {
      const info = db.prepare(`DELETE FROM ${table}`).run()
      console.log(`  ${table}: ${info.changes} rows deleted`)
    } catch (err) {
      console.log(`  ${table}: skipped (${err.message})`)
    }
  }

  // Re-insert the default Walk-in Customer
  try {
    db.prepare(
      `INSERT INTO customers (id, name, organization, phone, address, is_walk_in, created_at)
       VALUES ('walk-in', 'Walk-in Customer', NULL, NULL, NULL, 1, datetime('now'))`
    ).run()
    console.log('\n  Re-inserted default Walk-in Customer.')
  } catch {
    console.log('\n  Walk-in Customer already exists or could not be inserted.')
  }
})

deleteAll()

db.pragma('foreign_keys = ON')
db.close()

console.log('\nDone. All data has been deleted.\n')
