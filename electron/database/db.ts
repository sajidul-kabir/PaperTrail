import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'papertrail.db')
}

export function closeDatabase() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
    try { db.close() } catch { /* ignore */ }
    db = null
  }
}

export function initDatabase() {
  const dbPath = getDbPath()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  // Run migrations with FK off (table recreation needs it), then enable
  db.pragma('foreign_keys = OFF')
  runMigrations(db)
  db.pragma('foreign_keys = ON')
}
