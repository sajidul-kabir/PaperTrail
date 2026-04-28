import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  dbExecute: (sql: string, params?: any[]) =>
    ipcRenderer.invoke('db:execute', { sql, params }),
  dbExecuteMany: (statements: { sql: string; params?: any[] }[]) =>
    ipcRenderer.invoke('db:executeMany', { statements }),
  backupRun: () => ipcRenderer.invoke('backup:run'),
  backupInfo: () => ipcRenderer.invoke('backup:info'),
  backupSetCloudPath: (path: string | null) => ipcRenderer.invoke('backup:setCloudPath', path),
  backupRestore: (fileName: string) => ipcRenderer.invoke('backup:restore', fileName),
  backupPickFolder: () => ipcRenderer.invoke('backup:pickFolder'),
  backupRestoreFromFile: () => ipcRenderer.invoke('backup:restoreFromFile'),
  factoryReset: () => ipcRenderer.invoke('db:factoryReset'),
})
