import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'

interface BackupInfo {
  localDir: string
  localBackups: { name: string; size: number; date: string }[]
  cloudPath: string | null
  dbSize: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SettingsPage() {
  const { addToast } = useToast()
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [backing, setBacking] = useState(false)
  const [picking, setPicking] = useState(false)
  const [restoring, setRestoring] = useState(false)

  async function loadInfo() {
    setLoading(true)
    try {
      const result = await window.electronAPI.backupInfo()
      if (result.success) setInfo(result.data)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { loadInfo() }, [])

  async function handleBackupNow() {
    setBacking(true)
    try {
      const result = await window.electronAPI.backupRun()
      if (result.success && result.data) {
        const d = result.data
        if (d.error) {
          addToast({ title: 'Backup failed', description: d.error, variant: 'destructive' })
        } else {
          addToast({
            title: 'Backup complete',
            description: `Local: saved${d.cloud ? ' + Cloud: synced' : ''}`,
          })
        }
      }
      loadInfo()
    } catch (err: any) {
      addToast({ title: 'Backup failed', description: err.message, variant: 'destructive' })
    } finally { setBacking(false) }
  }

  async function handleRestore(fileName: string) {
    setRestoring(true)
    try {
      const result = await window.electronAPI.backupRestore(fileName)
      if (!result.success) {
        if (result.error !== 'Cancelled') {
          addToast({ title: 'Restore failed', description: result.error, variant: 'destructive' })
        }
      }
      // If successful, the app restarts automatically
    } catch (err: any) {
      addToast({ title: 'Restore failed', description: err.message, variant: 'destructive' })
    } finally { setRestoring(false) }
  }

  async function handleRestoreFromFile() {
    setRestoring(true)
    try {
      const result = await window.electronAPI.backupRestoreFromFile()
      if (!result.success) {
        if (result.error !== 'Cancelled') {
          addToast({ title: 'Restore failed', description: result.error, variant: 'destructive' })
        }
      }
    } catch (err: any) {
      addToast({ title: 'Restore failed', description: err.message, variant: 'destructive' })
    } finally { setRestoring(false) }
  }

  async function handlePickFolder() {
    setPicking(true)
    try {
      const result = await window.electronAPI.backupPickFolder()
      if (result.success && result.data) {
        await window.electronAPI.backupSetCloudPath(result.data)
        addToast({ title: 'Cloud backup folder set', description: result.data })
        loadInfo()
      }
    } catch (err: any) {
      addToast({ title: 'Failed', description: err.message, variant: 'destructive' })
    } finally { setPicking(false) }
  }

  async function handleRemoveCloud() {
    try {
      await window.electronAPI.backupSetCloudPath(null)
      addToast({ title: 'Cloud backup removed' })
      loadInfo()
    } catch (err: any) {
      addToast({ title: 'Failed', description: err.message, variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Backup and data management.</p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : info && (
        <>
          {/* Database info */}
          <Card>
            <CardHeader className="pb-2"><CardTitle>Database</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Size: </span>
                  <span className="font-medium">{formatBytes(info.dbSize)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Location: </span>
                  <span className="font-mono text-xs text-muted-foreground">{info.localDir.replace(/\\backups$/, '')}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Auto backup */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Auto Backup</CardTitle>
                <Badge variant="secondary" className="text-[10px]">After every change + on quit</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Local backups: </span>
                  <span className="font-medium">{info.localBackups.length} files</span>
                  <span className="text-muted-foreground ml-2">(keeps last 10)</span>
                </div>
                <div className="flex gap-2">
                  {info.localBackups.filter(b => b.size > 10240).length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => handleRestore(info.localBackups.filter(b => b.size > 10240)[0].name)} disabled={restoring}>
                      {restoring ? 'Restoring...' : 'Restore Latest'}
                    </Button>
                  )}
                  <Button size="sm" onClick={handleBackupNow} disabled={backing}>
                    {backing ? 'Backing up...' : 'Backup Now'}
                  </Button>
                </div>
              </div>

              {info.localBackups.length > 0 && (
                <div className="rounded-md border max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-1.5 px-3 font-medium">File</th>
                        <th className="text-right py-1.5 px-3 font-medium">Size</th>
                        <th className="text-right py-1.5 px-3 font-medium">Date</th>
                        <th className="py-1.5 px-3 w-16" />
                      </tr>
                    </thead>
                    <tbody>
                      {info.localBackups.map((b, i) => {
                        const isReal = b.size > 10240
                        return (
                        <tr key={b.name} className={`border-b ${i === 0 && isReal ? 'bg-primary/5' : ''} ${!isReal ? 'opacity-40' : ''}`}>
                          <td className="py-1.5 px-3 font-mono">{b.name}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">{formatBytes(b.size)}</td>
                          <td className="py-1.5 px-3 text-right text-muted-foreground whitespace-nowrap">{new Date(b.date).toLocaleString()}</td>
                          <td className="py-1.5 px-3">
                            {isReal && (
                              <button onClick={() => handleRestore(b.name)} disabled={restoring}
                                className="text-xs text-primary hover:underline">Restore</button>
                            )}
                          </td>
                        </tr>
                        )})}

                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-3 text-xs text-muted-foreground">
                Backups stored in: <span className="font-mono">{info.localDir}</span>
              </div>
            </CardContent>
          </Card>

          {/* Cloud backup */}
          <Card>
            <CardHeader className="pb-2"><CardTitle>Cloud Backup</CardTitle></CardHeader>
            <CardContent>
              {info.cloudPath ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="text-[10px]">Active</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{info.cloudPath}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A copy of the database is saved as <span className="font-mono">papertrail-latest.db</span> in this folder on every backup.
                    If this folder is synced by Google Drive, OneDrive, or Dropbox, your data is automatically backed up to the cloud.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handlePickFolder} disabled={picking}>Change Folder</Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={handleRemoveCloud}>Remove</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Set a cloud-synced folder (Google Drive, OneDrive, Dropbox) to automatically back up your database to the cloud.
                  </p>
                  <Button size="sm" onClick={handlePickFolder} disabled={picking}>
                    {picking ? 'Selecting...' : 'Choose Folder'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Restore from file */}
          <Card>
            <CardHeader className="pb-2"><CardTitle>Restore from File</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Restore from any <span className="font-mono text-foreground">.db</span> backup file — from Google Drive, USB, or another location.
                  Use this after a fresh Windows install to recover your data from the cloud backup.
                </p>
                <Button size="sm" variant="outline" onClick={handleRestoreFromFile} disabled={restoring}>
                  {restoring ? 'Restoring...' : 'Choose File & Restore'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
