/**
 * IPC helpers for renderer process to communicate with the main process DB.
 */

declare global {
  interface Window {
    electronAPI: {
      dbExecute: (sql: string, params?: any[]) => Promise<{ success: boolean; data?: any; error?: string }>
      dbExecuteMany: (statements: { sql: string; params?: any[] }[]) => Promise<{ success: boolean; data?: any[]; error?: string }>
    }
  }
}

export async function dbQuery<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const result = await window.electronAPI.dbExecute(sql, params)
  if (!result.success) throw new Error(result.error)
  return result.data as T[]
}

export async function dbRun(sql: string, params?: any[]): Promise<any> {
  const result = await window.electronAPI.dbExecute(sql, params)
  if (!result.success) throw new Error(result.error)
  return result.data
}

export async function dbTransaction(statements: { sql: string; params?: any[] }[]): Promise<any[]> {
  const result = await window.electronAPI.dbExecuteMany(statements)
  if (!result.success) throw new Error(result.error)
  return result.data!
}
