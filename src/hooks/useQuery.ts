import { useState, useEffect, useCallback } from 'react'
import { dbQuery } from '@/lib/ipc'

interface UseQueryResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useQuery<T = any>(sql: string, params?: any[], deps?: any[]): UseQueryResult<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await dbQuery<T>(sql, params)
      setData(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [sql, ...(deps || [])])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { data, loading, error, refetch: fetch }
}
