import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { autoUpdater } from 'electron-updater'
import { initDatabase, getDb } from './database/db'
import { runBackup, getBackupInfo, setCloudBackupPath, restoreFromBackup, restoreFromFile, scheduleBackupAfterWrite, stopBackupTimer } from './backup'

// Global error handlers — log and show dialog so crashes aren't silent
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  dialog.showErrorBox('Unexpected Error', err.message)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
  dialog.showErrorBox('Unexpected Error', String(reason))
})

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(process.env.VITE_PUBLIC!, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  // Backup before quitting
  try {
    stopBackupTimer()
    runBackup()
  } catch { /* don't block quit */ }
  app.quit()
  win = null
})

app.whenReady().then(() => {
  // Clear corrupted Chromium disk cache (inside whenReady so app paths are available)
  try {
    const userData = app.getPath('userData')
    for (const dir of ['Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Code Cache']) {
      const p = path.join(userData, dir)
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
    }
  } catch {
    // ignore — cache dirs may be locked
  }

  initDatabase()
  registerIpcHandlers()
  createWindow()

  // Auto-update (only in production builds)
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-downloaded', (info) => {
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded. The app will restart to apply the update.`,
        buttons: ['Restart Now', 'Later'],
      }).then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall()
      })
    })

    autoUpdater.on('error', (err) => {
      // Silently log — don't show error dialog for update failures
      console.log('Auto-update check failed (no internet or repo not accessible):', err.message)
    })

    autoUpdater.checkForUpdates().catch(() => {
      // Swallow — no internet or repo not accessible
    })
  }
})

function registerIpcHandlers() {
  // Generic DB query handler
  ipcMain.handle('db:execute', async (_event, { sql, params }) => {
    const db = getDb()
    try {
      const stmt = db.prepare(sql)
      if (sql.trimStart().toUpperCase().startsWith('SELECT') || sql.trimStart().toUpperCase().startsWith('WITH')) {
        return { success: true, data: stmt.all(...(params || [])) }
      } else {
        const result = stmt.run(...(params || []))
        scheduleBackupAfterWrite()
        return { success: true, data: result }
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('db:executeMany', async (_event, { statements }) => {
    const db = getDb()
    const transaction = db.transaction(() => {
      const results: any[] = []
      for (const { sql, params } of statements) {
        const stmt = db.prepare(sql)
        if (sql.trimStart().toUpperCase().startsWith('SELECT') || sql.trimStart().toUpperCase().startsWith('WITH')) {
          results.push(stmt.all(...(params || [])))
        } else {
          results.push(stmt.run(...(params || [])))
        }
      }
      return results
    })
    try {
      const results = transaction()
      scheduleBackupAfterWrite()
      return { success: true, data: results }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Backup IPC handlers
  ipcMain.handle('backup:run', async () => {
    try { return { success: true, data: runBackup() } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('backup:info', async () => {
    try { return { success: true, data: getBackupInfo() } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('backup:setCloudPath', async (_event, folderPath: string | null) => {
    try { setCloudBackupPath(folderPath); return { success: true } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('backup:restore', async (_event, fileName: string) => {
    if (!win) return { success: false, error: 'No window' }
    const { dialog } = await import('electron')
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Restore Backup',
      message: `Restore from ${fileName}? This will replace all current data. The app will restart.`,
      buttons: ['Cancel', 'Restore'],
      defaultId: 0,
    })
    if (confirm.response !== 1) return { success: false, error: 'Cancelled' }

    // Checkpoint WAL, then close DB before restoring
    try {
      const db = getDb()
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.close()
    } catch { /* ignore */ }

    const result = restoreFromBackup(fileName)
    if (result.success) {
      // Reinitialize DB from restored file and reload window
      initDatabase()
      if (win) win.reload()
    }
    return result
  })

  ipcMain.handle('backup:pickFolder', async () => {
    if (!win) return { success: false, error: 'No window' }
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Cloud Backup Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return { success: true, data: null }
    return { success: true, data: result.filePaths[0] }
  })

  ipcMain.handle('backup:restoreFromFile', async () => {
    if (!win) return { success: false, error: 'No window' }
    const { dialog } = await import('electron')

    const pick = await dialog.showOpenDialog(win, {
      title: 'Select Backup File to Restore',
      filters: [{ name: 'Database', extensions: ['db'] }],
      properties: ['openFile'],
    })
    if (pick.canceled || pick.filePaths.length === 0) return { success: false, error: 'Cancelled' }

    const filePath = pick.filePaths[0]
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Restore from File',
      message: `Restore from "${path.basename(filePath)}"?\n\nThis will replace ALL current data. The app will restart.`,
      buttons: ['Cancel', 'Restore'],
      defaultId: 0,
    })
    if (confirm.response !== 1) return { success: false, error: 'Cancelled' }

    try {
      const db = getDb()
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.close()
    } catch { /* ignore */ }

    const result = restoreFromFile(filePath)
    if (result.success) {
      initDatabase()
      if (win) win.reload()
    }
    return result
  })
}
