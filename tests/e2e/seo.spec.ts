import { expect, test, type Page } from '@playwright/test'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import worker from '../../worker/src/index'
import type { AppEnv } from '../../worker/src/types'

const hostileName = '测试 & 游戏 </title><script>window.seoInjected=true</script>'
const description = '探索开放世界，与朋友一起建造基地。'.repeat(20)

function fixture(count = 2) {
  const database = new DatabaseSync(':memory:')
  for (const file of ['0001_initial.sql', '0003_game_description_format.sql', '0005_announcements_and_pinned_games.sql']) {
    database.exec(readFileSync(new URL(`../../worker/migrations/${file}`, import.meta.url), 'utf8'))
  }
  database.exec("INSERT INTO categories (name, slug) VALUES ('冒险', 'adventure')")
  const insert = database.prepare("INSERT INTO games (name, slug, cover_url, description, description_format, category_id, status, resource_type, publish_at, updated_at) VALUES (?, ?, '/cover.png', ?, ?, 1, 'published', 'member', '2026-10-21', '2026-10-21 09:00:00')")
  database.exec('BEGIN')
  for (let index = 1; index <= count; index++) {
    insert.run(index === 1 ? hostileName : `测试游戏 ${index}`, `seo-game-${index}`,
      index === 1 ? `# 游戏介绍\n\n**${description}**\n\n![截图](https://example.com/image.png)` : '这是第二个游戏的介绍。',
      index === 1 ? 'markdown' : 'plain')
  }
  database.exec("INSERT INTO game_downloads (game_id, provider, label, url) VALUES (1, '网盘', '会员链接', 'https://private.example.com/secret-download')")
  database.exec("INSERT INTO games (name, slug, cover_url, description, category_id, status) VALUES ('秘密草稿', 'secret-draft', '/cover.png', '不公开的正文', 1, 'draft'), ('已下架', 'offline-game', '/cover.png', '下架正文', 1, 'offline')")
  database.exec("INSERT INTO games (name, slug, cover_url, description, category_id, status, deleted_at) VALUES ('已删除', 'deleted-game', '/cover.png', '删除正文', 1, 'published', CURRENT_TIMESTAMP)")
  database.exec('COMMIT')
  const reads: string[] = []
  function prepare(sql: string) {
    reads.push(sql)
    const statement = database.prepare(sql)
    let values: SQLInputValue[] = []
    return {
      bind(...bindings: SQLInputValue[]) { values = bindings; return this },
      async first() { return statement.get(...values) ?? null },
      async all() { return { results: statement.all(...values) } },
    }
  }
  const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const bindings = {
    APP_ENV: 'test', ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
    DB: { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => Promise.all(statements.map(statement => statement.all())) },
    ASSETS: { fetch: async (request: Request) => {
      const path = new URL(request.url).pathname
      if (path === '/assets/app.js') return new Response('const asset = true', { headers: { 'Content-Type': 'text/javascript', ETag: 'asset-tag' } })
      if (request.headers.has('If-None-Match')) return new Response(null, { status: 304, headers: { ETag: 'index-tag' } })
      if (path === '/googled4ad848484c407b4.html' || path === '/BingSiteAuth.xml') return new Response(
        readFileSync(new URL(`../../public${path}`, import.meta.url)),
        { headers: { 'Content-Type': path.endsWith('.xml') ? 'application/xml' : 'text/html' } },
      )
      return new Response(source, { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: 'index-tag', 'Last-Modified': 'old-index' } })
    } },
  } as unknown as AppEnv['Bindings']
  return { database, bindings, reads, close: () => database.close() }
}

async function interceptApi(page: Page, data: ReturnType<typeof fixture>) {
  await page.route('**/api/**', async route => {
    const request = route.request()
    if (!new URL(request.url()).pathname.startsWith('/api/')) return route.fallback()
    const response = await worker.request(request.url(), { method: request.method() }, data.bindings)
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() })
  })
}

test('首个 HTML 响应包含独立标题、纯文本简介与正式 canonical，会员地址不公开', async () => {
  const data = fixture()
  try {
    const response = await worker.request('https://example.workers.dev/games/seo-game-1?utm_source=test', {}, data.bindings)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('测试 &amp; 游戏 &lt;/title&gt;&lt;script&gt;window.seoInjected=true&lt;/script&gt;｜游浪</title>')
    expect(html).toContain('<link rel="canonical" href="https://youlang.cc.cd/games/seo-game-1" />')
    expect(html).toContain('<meta name="robots" content="index, follow"')
    expect(html).toContain('<meta name="msvalidate.01" content="D7B773EF012EE6DEFDAAF4518C4B3902" />')
    expect(html).not.toContain('https://private.example.com/')
    expect(html).not.toContain('<script>window.seoInjected')
    expect(response.headers.get('ETag')).toBeNull()
    expect(response.headers.get('Last-Modified')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Robots-Tag')).toBe('index, follow')
    const snippet = /<meta name="description" content="([^"]*)"/.exec(html)![1]!
    expect(Array.from(snippet)).toHaveLength(160)
    expect(snippet).toMatch(/^游戏介绍 探索开放世界/)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).not.toMatch(/\*\*|!\[|https:\/\/example\.com/)
    expect(data.reads.every(sql => !/sessions|users|game_downloads/.test(sql))).toBe(true)
    const conditional = await worker.request('/games/seo-game-2', { headers: { 'If-None-Match': 'index-tag' } }, data.bindings)
    expect(conditional.status).toBe(200)
    expect(await conditional.text()).toContain('<title>测试游戏 2｜游浪</title>')
  } finally { data.close() }
})

test('robots 与分片 sitemap 只列公开游戏，更新或下架自动生效', async () => {
  const data = fixture(1001)
  try {
    const robots = await worker.request('/robots.txt', {}, data.bindings)
    expect(robots.headers.get('Content-Type')).toContain('text/plain')
    expect(await robots.text()).toContain('Sitemap: https://youlang.cc.cd/sitemap.xml')
    const renderingRules = await worker.request('/robots.txt', {}, data.bindings)
    const rules = await renderingRules.text()
    for (const path of ['/api/games', '/api/game-filters', '/api/categories', '/api/tags']) expect(rules).toContain(`Allow: ${path}`)
    expect(rules).toContain('Disallow: /api/')
    expect(rules).toContain('Disallow: /api/games/*/downloads')
    const sitemap = await worker.request('/sitemap.xml', {}, data.bindings)
    expect(sitemap.headers.get('Content-Type')).toContain('application/xml')
    expect(await sitemap.text()).toContain('/sitemaps/games-2.xml')
    const first = await worker.request('/sitemaps/games-1.xml', {}, data.bindings)
    const firstXml = await first.text()
    expect(firstXml.match(/<url>/g)).toHaveLength(1000)
    expect(firstXml).toContain('<lastmod>2026-10-21T09:00:00.000Z</lastmod>')
    expect(firstXml).not.toMatch(/secret-draft|offline-game|deleted-game|secret-download/)
    const second = await worker.request('/sitemaps/games-2.xml', {}, data.bindings)
    expect(await second.text()).toContain('/games/seo-game-1001')
    const pages = await worker.request('/sitemaps/pages.xml', {}, data.bindings)
    expect(await pages.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://youlang.cc.cd/</loc></url><url><loc>https://youlang.cc.cd/games</loc></url></urlset>')
    data.database.exec("UPDATE games SET status = 'offline' WHERE slug = 'seo-game-1001'")
    const updated = await worker.request('/sitemap.xml', {}, data.bindings)
    expect(await updated.text()).not.toContain('/sitemaps/games-2.xml')
    expect((await worker.request('/sitemaps/games-2.xml', {}, data.bindings)).status).toBe(404)
    expect((await worker.request('/sitemaps/games-0.xml', {}, data.bindings)).status).toBe(404)
  } finally { data.close() }
})

test('个人后台、筛选搜索和无效页面不收录，静态资源及接口仍正常', async () => {
  const data = fixture()
  try {
    for (const path of ['/auth?redirect=/admin', '/profile', '/admin', '/feedback', '/games?q=游戏', '/games?category=adventure', '/games?page=bad']) {
      const response = await worker.request(path, {}, data.bindings)
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow')
      expect(await response.text()).toContain('<meta name="robots" content="noindex, follow"')
    }
    for (const path of ['/games/secret-draft', '/games/offline-game', '/games/deleted-game', '/games/missing', '/missing-page']) {
      const response = await worker.request(path, {}, data.bindings)
      expect(response.status).toBe(404)
      expect(response.headers.get('Location')).toBeNull()
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    }
    const secondPage = await worker.request('/games?page=2', {}, data.bindings)
    expect(await secondPage.text()).toContain('href="https://youlang.cc.cd/games?page=2"')
    expect(secondPage.headers.get('X-Robots-Tag')).toBe('index, follow')
    const asset = await worker.request('/assets/app.js', {}, data.bindings)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('ETag')).toBe('asset-tag')
    const api = await worker.request('/api/games/seo-game-1', {}, data.bindings)
    expect(api.status).toBe(200)
    expect(api.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(JSON.stringify(await api.json())).not.toContain('secret-download')
  } finally { data.close() }
})

test('公开页面尾部斜杠跳转到规范网址，保留筛选参数且详情仍允许收录', async () => {
  const data = fixture()
  try {
    for (const [path, target] of [['/games/', '/games'], ['/games/?page=2', '/games?page=2'], ['/games/seo-game-1/', '/games/seo-game-1']]) {
      const response = await worker.request(`https://youlang.cc.cd${path}`, {}, data.bindings)
      expect(response.status).toBe(308)
      expect(response.headers.get('Location')).toBe(`https://youlang.cc.cd${target}`)
      const normalized = await worker.request(response.headers.get('Location')!, {}, data.bindings)
      expect(normalized.status).toBe(200)
      expect(normalized.headers.get('X-Robots-Tag')).toBe('index, follow')
    }
  } finally { data.close() }
})

test('Google 与 Bing 验证文件保持原始内容，Google HTML 不会被当作不存在的页面', async () => {
  const data = fixture()
  try {
    for (const path of ['/googled4ad848484c407b4.html', '/BingSiteAuth.xml']) {
      const response = await worker.request(path, {}, data.bindings)
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync(new URL(`../../public${path}`, import.meta.url)))
    }
    const bing = await worker.request('/BingSiteAuth.xml', { headers: { 'If-None-Match': 'index-tag' } }, data.bindings)
    expect(bing.status).toBe(200)
    expect(bing.headers.get('Cache-Control')).toBe('no-store')
    expect(bing.headers.get('ETag')).toBeNull()
    expect(await bing.text()).toBe(readFileSync(new URL('../../public/BingSiteAuth.xml', import.meta.url), 'utf8'))
    const home = await worker.request('/', {}, data.bindings)
    const html = await home.text()
    expect(html).toContain('<meta name="msvalidate.01" content="D7B773EF012EE6DEFDAAF4518C4B3902" />')
    expect(data.reads).toEqual([])
  } finally { data.close() }
})

test('真实 Worker 静态资源保留 Google 验证文件的 HTML 后缀，首页继续可访问', async ({ request }) => {
  for (const path of ['/googled4ad848484c407b4.html', '/BingSiteAuth.xml']) {
    const response = await request.get(`http://127.0.0.1:8787${path}`, { maxRedirects: 0 })
    expect(response.status()).toBe(200)
    expect(await response.body()).toEqual(readFileSync(new URL(`../../public${path}`, import.meta.url)))
  }
  const home = await request.get('http://127.0.0.1:8787/', { maxRedirects: 0 })
  expect(home.status()).toBe(200)
  const html = await home.text()
  expect(html).toContain('<title>游浪 - PC 游戏资源库</title>')
  expect(html).toContain('<meta name="msvalidate.01" content="D7B773EF012EE6DEFDAAF4518C4B3902" />')
})

test('站内切页、详情间跳转和返回及时更新 SEO，简介截断且没有注入', async ({ page }) => {
  const data = fixture()
  try {
    await interceptApi(page, data)
    await page.goto('/games/seo-game-1')
    await expect(page).toHaveTitle(`${hostileName}｜游浪`)
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', /^游戏介绍 探索开放世界.*…$/)
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', 'https://youlang.cc.cd/games/seo-game-1')
    expect(await page.evaluate(() => 'seoInjected' in window)).toBe(false)
    await page.getByRole('link', { name: '返回游戏库' }).click()
    await expect(page).toHaveTitle('全部游戏｜游浪')
    await page.locator('.game-card').filter({ hasText: '测试游戏 2' }).click()
    await expect(page).toHaveTitle('测试游戏 2｜游浪')
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', '这是第二个游戏的介绍。')
    await page.goBack()
    await expect(page).toHaveTitle('全部游戏｜游浪')
    await page.goto('/games?q=测试')
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
    await page.goto('/auth')
    await expect(page).toHaveTitle('登录与注册｜游浪')
    await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0)
    await page.goto('/missing-page')
    await expect(page).toHaveTitle('页面不存在｜游浪')
    await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); data.close() }
})

test('详情失败和迟到响应不会把旧游戏标题带到其他页面', async ({ page }) => {
  const data = fixture()
  let release: (() => void) | undefined
  try {
    await interceptApi(page, data)
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/games/seo-game-1', async route => { await gate; await route.fallback() })
    await page.goto('/games/seo-game-1')
    await expect(page.locator('.detail-loading')).toBeVisible()
    await page.getByRole('link', { name: '游浪首页', exact: true }).click()
    release!()
    await expect(page).toHaveTitle('游浪 - PC 游戏资源库')
    await page.goto('/games/missing')
    await expect(page.getByRole('heading', { name: '游戏不可用' })).toBeVisible()
    await expect(page).toHaveTitle('游戏不可用｜游浪')
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
    await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0)
  } finally { release?.(); await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); data.close() }
})

test('公开详情接口被阻止或暂时失败时保留服务端 index，只有确认404才设noindex', async ({ page }) => {
  const data = fixture()
  try {
    await interceptApi(page, data)
    await page.route('**/games/seo-game-1', async route => {
      if (route.request().resourceType() !== 'document') return route.fallback()
      const response = await worker.request(route.request().url(), {}, data.bindings)
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() })
    })
    let failure: 'blocked' | 'server' | 'missing' = 'blocked'
    await page.route('**/api/games/seo-game-1', async route => {
      if (failure === 'blocked') return route.abort('blockedbyclient')
      return route.fulfill({ status: failure === 'missing' ? 404 : 503,
        json: { ok: false, error: { code: failure === 'missing' ? 'GAME_NOT_FOUND' : 'TEMPORARILY_UNAVAILABLE', message: '暂时无法加载' } } })
    })
    for (const mode of ['blocked', 'server'] as const) {
      failure = mode
      await page.goto('/games/seo-game-1')
      await expect(page.locator('.detail-error')).toBeVisible()
      await expect(page).toHaveTitle(`${hostileName}｜游浪`)
      await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'index, follow')
      await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', 'https://youlang.cc.cd/games/seo-game-1')
    }
    failure = 'missing'
    await page.goto('/games/seo-game-1')
    await expect(page.locator('.detail-error')).toBeVisible()
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); data.close() }
})

test('站内进入公开详情的加载阶段不产生noindex，真正缺失的页面保持服务端noindex', async ({ page }) => {
  const data = fixture()
  let release: (() => void) | undefined
  try {
    await interceptApi(page, data)
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/games/seo-game-1', async route => { await gate; await route.fallback() })
    await page.goto('/games')
    await page.locator('.game-card').filter({ hasText: hostileName }).click()
    await expect(page.locator('.detail-loading')).toBeVisible()
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'index, follow')
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', 'https://youlang.cc.cd/games/seo-game-1')
    release!()
    await expect(page).toHaveTitle(`${hostileName}｜游浪`)
    await page.route('**/games/missing', async route => {
      if (route.request().resourceType() !== 'document') return route.fallback()
      const response = await worker.request(route.request().url(), {}, data.bindings)
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() })
    })
    await page.goto('/games/missing')
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
    await expect(page.getByRole('heading', { name: '游戏不可用' })).toBeVisible()
  } finally { release?.(); await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); data.close() }
})
