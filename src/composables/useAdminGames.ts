import { onScopeDispose, reactive, ref } from 'vue'
import { adminApi, type AdminGame, type AdminGameList, type AdminGamesQuery } from '@/api/client'
import { withRequestTimeout } from '@/utils/requestTimeout'

export function useAdminGames() {
  const games = ref<AdminGame[]>([])
  const page = ref(1)
  const total = ref(0)
  const loading = ref(false)
  const error = ref('')
  const filters = reactive({ q: '', categoryId: '', resourceType: '' as '' | 'free' | 'member', status: '' as '' | AdminGame['status'] })
  // Component-local LRU: at most six pages / sixty rows, each fresh for 30s.
  const cache = new Map<string, { result: AdminGameList; expires: number }>()
  let controller: AbortController | undefined
  let generation = 0
  const query = (): AdminGamesQuery => ({ q: filters.q, page: page.value, categoryId: filters.categoryId ? Number(filters.categoryId) : undefined, resourceType: filters.resourceType || undefined, status: filters.status || undefined })

  function cancel() { generation++; controller?.abort(); controller = undefined; loading.value = false }
  function invalidate() { cancel(); cache.clear() }
  async function load(force = false) {
    cancel()
    if (force) cache.clear()
    const version = generation
    const request = query()
    const key = JSON.stringify(request)
    for (const [entryKey, entry] of cache) if (entry.expires <= Date.now()) cache.delete(entryKey)
    error.value = ''
    const apply = (result: AdminGameList) => { games.value = result.games; total.value = result.pagination.total; page.value = result.pagination.page }
    const cached = cache.get(key)
    if (cached) { cache.delete(key); cache.set(key, cached); apply(cached.result); return }
    const active = new AbortController()
    controller = active
    loading.value = true
    try {
      const result = await withRequestTimeout(signal => adminApi.games(request, signal), 15000, active.signal)
      if (version !== generation) return
      apply(result)
      cache.set(JSON.stringify({ ...request, page: result.pagination.page }), { result, expires: Date.now() + 30000 })
      while (cache.size > 6) cache.delete(cache.keys().next().value!)
    } catch (cause) {
      if (version !== generation || active.signal.aborted) return
      games.value = []
      error.value = cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : '请求超时，请重试。'
    } finally {
      if (version === generation) { loading.value = false; controller = undefined }
    }
  }
  onScopeDispose(invalidate)
  return { games, page, total, loading, error, filters, load, cancel, invalidate }
}
