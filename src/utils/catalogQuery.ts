import type { LocationQuery } from 'vue-router'

export type CatalogQuery = { q: string; category: string; tags: string[]; year: string; resourceType: '' | 'free' | 'member'; page: number }
const first = (value: LocationQuery[string]) => String((Array.isArray(value) ? value[0] : value) ?? '')

export function normalizeCatalogQuery(query: LocationQuery): CatalogQuery {
  const rawPage = Number(first(query.page) || 1)
  const year = first(query.year)
  const access = first(query.resourceType)
  return {
    q: first(query.q).trim().slice(0, 80), category: first(query.category).trim().slice(0, 60),
    tags: [...new Set(first(query.tags).split(',').map(tag => tag.trim()).filter(tag => tag && tag.length <= 60))].sort().slice(0, 20),
    year: /^\d{4}$/.test(year) && Number(year) >= 1900 ? year : '',
    resourceType: access === 'free' || access === 'member' ? access : '',
    page: Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 100000 ? rawPage : 1,
  }
}

export function catalogRouteQuery(query: CatalogQuery): Record<string, string> {
  return { ...(query.q ? { q: query.q } : {}), ...(query.year ? { year: query.year } : {}),
    ...(query.resourceType ? { resourceType: query.resourceType } : {}), ...(query.category ? { category: query.category } : {}),
    ...(query.tags.length ? { tags: [...query.tags].sort().join(',') } : {}), ...(query.page > 1 ? { page: String(query.page) } : {}) }
}

export function catalogRequest(query: CatalogQuery, pageSize: number): Record<string, string | number> {
  return { ...catalogRouteQuery(query), page: query.page, pageSize }
}

export function safeCatalogPath(value: unknown): string | null {
  return typeof value === 'string' && (value === '/games' || value.startsWith('/games?')) ? value : null
}
