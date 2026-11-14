import { Hono, type Context } from 'hono'
import { escapeHtml, gameMetadata, normalizePagePath, pageMetadata, SITE_ORIGIN, unavailableGameMetadata, type SeoMetadata } from '../../src/utils/seo'
import type { AppEnv } from './types'

const seo = new Hono<AppEnv>()
const SITEMAP_PAGE_SIZE = 1000
const publishedGames = "FROM games g JOIN categories c ON c.id = g.category_id WHERE g.status = 'published' AND g.deleted_at IS NULL"
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

// Verification documents must be served byte-for-byte, including Google's HTML file.
seo.get('/googled4ad848484c407b4.html', context => context.env.ASSETS.fetch(context.req.raw))
seo.get('/BingSiteAuth.xml', async context => {
  const request = new Request(context.req.raw)
  request.headers.delete('If-None-Match')
  request.headers.delete('If-Modified-Since')
  const response = await context.env.ASSETS.fetch(request)
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', 'application/xml; charset=utf-8')
  headers.delete('ETag')
  headers.delete('Last-Modified')
  return new Response(response.body, { status: response.status, headers })
})

function xml(context: Context<AppEnv>, body: string, status: 200 | 404 = 200) {
  return context.body(body, status, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
}

function urlset(entries: string[]) {
  return `${XML_HEADER}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`
}

const pageEntries = [`<url><loc>${SITE_ORIGIN}/</loc></url>`, `<url><loc>${SITE_ORIGIN}/games</loc></url>`]

async function gameEntries(database: D1Database, page: number) {
  const result = await database.prepare(`SELECT g.slug, g.updated_at ${publishedGames} ORDER BY g.id ASC LIMIT ? OFFSET ?`)
    .bind(SITEMAP_PAGE_SIZE, (page - 1) * SITEMAP_PAGE_SIZE).all<{ slug: string; updated_at: string }>()
  return result.results.map(game => {
    // SQLite CURRENT_TIMESTAMP is UTC; do not invent a fresh lastmod on every crawl.
    const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(game.updated_at)
      ? `${game.updated_at.replace(' ', 'T')}Z` : game.updated_at
    const date = new Date(timestamp)
    const lastmod = Number.isNaN(date.getTime()) ? '' : `<lastmod>${date.toISOString()}</lastmod>`
    return `<url><loc>${escapeHtml(`${SITE_ORIGIN}/games/${encodeURIComponent(game.slug)}`)}</loc>${lastmod}</url>`
  })
}

seo.get('/robots.txt', context => context.text([
  'User-agent: *', 'Allow: /', 'Disallow: /api/',
  // Google needs the public data endpoints to render the Vue page body.
  'Allow: /api/games', 'Allow: /api/game-filters', 'Allow: /api/categories', 'Allow: /api/tags',
  'Disallow: /api/games/*/downloads', '',
  // Let crawlers read private/search pages to see their noindex directive.
  `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, '',
].join('\n'), 200, { 'Cache-Control': 'public, max-age=300' }))

seo.get('/sitemap.xml', async context => {
  const count = await context.env.DB.prepare(`SELECT COUNT(*) AS total ${publishedGames}`).first<{ total: number }>()
  if ((count?.total ?? 0) <= SITEMAP_PAGE_SIZE) {
    return xml(context, urlset([...pageEntries, ...await gameEntries(context.env.DB, 1)]))
  }
  // Keep every child map at the root so its URL scope includes /games/.
  const entries = [`<sitemap><loc>${SITE_ORIGIN}/sitemap-pages.xml</loc></sitemap>`]
  for (let page = 1; page <= Math.ceil((count?.total ?? 0) / SITEMAP_PAGE_SIZE); page++) {
    entries.push(`<sitemap><loc>${SITE_ORIGIN}/sitemap-games-${page}.xml</loc></sitemap>`)
  }
  return xml(context, `${XML_HEADER}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</sitemapindex>`)
})

seo.get('/sitemap-pages.xml', context => xml(context, urlset(pageEntries)))

seo.get('/:file', async (context, next) => {
  const file = context.req.param('file')
  if (!file.startsWith('sitemap-games-')) return next()
  const match = /^sitemap-games-([1-9]\d*)\.xml$/.exec(file)
  const page = match ? Number(match[1]) : 0
  if (!page || !Number.isSafeInteger(page) || page > 100000) return xml(context, urlset([]), 404)
  const entries = await gameEntries(context.env.DB, page)
  return xml(context, urlset(entries), entries.length ? 200 : 404)
})

// Previously submitted child-map URLs continue to resolve at a valid root URL.
seo.get('/sitemaps/pages.xml', context => context.redirect('/sitemap-pages.xml', 308))
seo.get('/sitemaps/:file', context => {
  if (!/^games-[1-9]\d*\.xml$/.test(context.req.param('file'))) return xml(context, urlset([]), 404)
  return context.redirect(`/sitemap-${context.req.param('file')}`, 308)
})

function metadataHtml(metadata: SeoMetadata, path: string) {
  return [
    `<title>${escapeHtml(metadata.title)}</title>`,
    `<meta name="description" content="${escapeHtml(metadata.description)}" />`,
    `<meta name="robots" content="${metadata.robots}" data-seo-path="${escapeHtml(path)}" />`,
    metadata.canonical ? `<link rel="canonical" href="${escapeHtml(metadata.canonical)}" />` : '',
  ].join('\n')
}

// Rewrite only head metadata; the existing Vue app continues to render the page body.
export async function serveSeoPage(context: Context<AppEnv>) {
  const url = new URL(context.req.url)
  const normalizedPath = normalizePagePath(url.pathname)
  if (url.pathname !== normalizedPath
    && (['/games', '/auth', '/profile', '/feedback', '/admin'].includes(normalizedPath) || /^\/games\/[^/]+$/.test(normalizedPath))) {
    url.pathname = normalizedPath
    return context.redirect(url.href, 308)
  }
  let metadata = pageMetadata(url.pathname, url.searchParams)
  let status: 200 | 404 = 200
  const knownPage = ['/', '/games', '/auth', '/profile', '/feedback', '/admin'].includes(url.pathname)
  const detail = /^\/games\/([^/]+)$/.exec(url.pathname)
  if (detail) {
    let slug = ''
    try { slug = decodeURIComponent(detail[1]!) } catch { /* Invalid encodings are missing pages. */ }
    const game = slug ? await context.env.DB.prepare(`SELECT g.name, g.slug, g.description, g.description_format ${publishedGames} AND g.slug = ?`)
      .bind(slug).first<{ name: string; slug: string; description: string; description_format: 'plain' | 'markdown' }>() : null
    if (!game) { status = 404; metadata = unavailableGameMetadata() }
    else metadata = gameMetadata({ ...game, descriptionFormat: game.description_format })
  } else if (!knownPage) status = 404

  let assetRequest = context.req.raw
  if (knownPage || detail) {
    // An old validator for the shared index must not suppress a new per-game head.
    assetRequest = new Request(assetRequest)
    assetRequest.headers.delete('If-None-Match')
    assetRequest.headers.delete('If-Modified-Since')
  }
  const response = await context.env.ASSETS.fetch(assetRequest)
  if (!response.headers.get('Content-Type')?.includes('text/html')) return response
  if (response.status !== 200) return response
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Robots-Tag', metadata.robots)
  // These validators describe the unmodified static index, not the per-page head.
  for (const header of ['ETag', 'Last-Modified', 'Content-Length']) headers.delete(header)
  const html = (await response.text()).replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, () => metadataHtml(metadata, url.pathname))
  return new Response(html, { status, headers })
}

export default seo
