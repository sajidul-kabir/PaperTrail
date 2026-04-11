import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  dbExecute: (sql: string, params?: any[]) =>
    ipcRenderer.invoke('db:execute', { sql, params }),
  dbExecuteMany: (statements: { sql: string; params?: any[] }[]) =>
    ipcRenderer.invoke('db:executeMany', { statements }),
})
