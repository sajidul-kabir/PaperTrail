import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { getDb } from './database/db'

const MAX_LOCAL_BACKUPS = 10
let backupTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function getDbPath(): string {
  return path.join(app.getPath('userData'), 'papertrail.db')
}

function getLocalBackupDir(): string {
  return path.join(app.getPath('userData'), 'backups')
}

function getCloudBackupPath(): string | null {
  try {
    const db = getDb()
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'cloud_backup_path'`).get() as { value: string } | undefined
    return row?.value || null
  } catch {
    return null
  }
}

function timestamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da}-${h}${mi}`
}

export function runBackup(): { local: string | null; cloud: string | null; error: string | null } {
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) {
    return { local: null, cloud: null, error: 'Database file not found' }
  }

  // Checkpoint WAL so all recent writes are flushed to the main .db file
  try {
    const db = getDb()
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch { /* ignore — DB may be closed during quit */ }

  // Skip backup if DB is essentially empty (< 10KB = fresh/wiped DB)
  const dbSize = fs.statSync(dbPath).size
  if (dbSize < 10240) {
    return { local: null, cloud: null, error: null }
  }

  let localPath: string | null = null
  let cloudPath: string | null = null

  // 1. Local backup
  try {
    const backupDir = getLocalBackupDir()
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

    const fileName = `papertrail-${timestamp()}.db`
    localPath = path.join(backupDir, fileName)
    fs.copyFileSync(dbPath, localPath)

    // Cleanup old backups — keep last MAX_LOCAL_BACKUPS
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('papertrail-') && f.endsWith('.db'))
      .sort()
      .reverse()

    for (let i = MAX_LOCAL_BACKUPS; i < files.length; i++) {
      try { fs.unlinkSync(path.join(backupDir, files[i])) } catch { /* ignore */ }
    }
  } catch (err: any) {
    return { local: null, cloud: null, error: `Local backup failed: ${err.message}` }
  }

  // 2. Cloud backup (optional)
  const cloudDir = getCloudBackupPath()
  if (cloudDir) {
    try {
      if (!fs.existsSync(cloudDir)) fs.mkdirSync(cloudDir, { recursive: true })
      cloudPath = path.join(cloudDir, 'papertrail-latest.db')
      fs.copyFileSync(dbPath, cloudPath)
    } catch (err: any) {
      // Cloud backup failure is non-fatal
      console.error('Cloud backup failed:', err.message)
      cloudPath = null
    }
  }

  return { local: localPath, cloud: cloudPath, error: null }
}

export function getBackupInfo(): {
  localDir: string
  localBackups: { name: string; size: number; date: string }[]
  cloudPath: string | null
  dbSize: number
} {
  const localDir = getLocalBackupDir()
  let localBackups: { name: string; size: number; date: string }[] = []

  try {
    if (fs.existsSync(localDir)) {
      localBackups = fs.readdirSync(localDir)
        .filter(f => f.startsWith('papertrail-') && f.endsWith('.db'))
        .sort()
        .reverse()
        .map(f => {
          const stat = fs.statSync(path.join(localDir, f))
          return { name: f, size: stat.size, date: stat.mtime.toISOString() }
        })
    }
  } catch { /* ignore */ }

  let dbSize = 0
  try { dbSize = fs.statSync(getDbPath()).size } catch { /* ignore */ }

  return {
    localDir,
    localBackups,
    cloudPath: getCloudBackupPath(),
    dbSize,
  }
}

export function restoreFromBackup(backupFileName: string): { success: boolean; error: string | null } {
  const backupDir = getLocalBackupDir()
  const backupPath = path.join(backupDir, backupFileName)

  if (!fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup file not found' }
  }

  // Don't restore tiny (empty) backups
  const stat = fs.statSync(backupPath)
  if (stat.size < 10240) {
    return { success: false, error: 'This backup is empty and cannot be restored' }
  }

  const dbPath = getDbPath()
  try {
    // Remove WAL/SHM files so SQLite doesn't mix old journal with restored DB
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    fs.copyFileSync(backupPath, dbPath)
    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export function restoreFromFile(filePath: string): { success: boolean; error: string | null } {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'File not found' }
  }

  const stat = fs.statSync(filePath)
  if (stat.size < 10240) {
    return { success: false, error: 'This file is too small to be a valid database' }
  }

  const dbPath = getDbPath()
  try {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    fs.copyFileSync(filePath, dbPath)
    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export function setCloudBackupPath(folderPath: string | null): void {
  const db = getDb()
  if (folderPath) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('cloud_backup_path', ?)`).run(folderPath)
  } else {
    db.prepare(`DELETE FROM settings WHERE key = 'cloud_backup_path'`).run()
  }
}

/**
 * Schedule a backup after a write operation.
 * Debounced to 5 seconds — if multiple writes happen in quick succession
 * (e.g. a transaction with 10 statements), only one backup runs.
 */
export function scheduleBackupAfterWrite(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const result = runBackup()
    if (result.error) console.error('Backup error:', result.error)
  }, 5000)
}

export function startBackupTimer(): void {
  if (backupTimer) return
  backupTimer = setInterval(() => {
    const result = runBackup()
    if (result.error) console.error('Backup error:', result.error)
  }, 30 * 60 * 1000)
}

export function stopBackupTimer(): void {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
}
