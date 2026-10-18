import type { GameSummary, Taxonomy } from '@/types/game'

export type CatalogPage = { games: GameSummary[]; pagination: { page: number; pageSize: number; total: number } }
export type CatalogFilters = { years: number[]; categories: Taxonomy[]; tags: Taxonomy[] }
const pages = new Map<string, { data: CatalogPage; expires: number }>()
let filters: { data: CatalogFilters; expires: number } | undefined
let revision = 0
export const catalogRevision = () => revision
export const catalogKey = (query: Record<string, string | number>) => JSON.stringify(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))

export function readCatalogPage(key: string) {
  for (const [entryKey, entry] of pages) if (entry.expires <= Date.now()) pages.delete(entryKey)
  const entry = pages.get(key)
  if (!entry) return null
  pages.delete(key)
  pages.set(key, entry)
  return entry.data
}
export function writeCatalogPage(key: string, data: CatalogPage, expectedRevision: number) {
  if (expectedRevision !== revision) return
  pages.delete(key)
  pages.set(key, { data, expires: Date.now() + 30000 })
  while (pages.size > 6) pages.delete(pages.keys().next().value!)
}
export function readCatalogFilters() { return filters && filters.expires > Date.now() ? filters.data : null }
export function writeCatalogFilters(data: CatalogFilters, expectedRevision: number) {
  if (expectedRevision === revision) filters = { data, expires: Date.now() + 30000 }
}
export function invalidateCatalogCache() { revision++; pages.clear(); filters = undefined }
