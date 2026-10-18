import { expect, test, type Page } from '@playwright/test'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import worker from '../../worker/src/index'
import type { AppEnv } from '../../worker/src/types'

function catalogFixture(count = 180) {
  const database = new DatabaseSync(':memory:')
  database.exec(readFileSync(new URL('../../worker/migrations/0001_initial.sql', import.meta.url), 'utf8'))
  database.exec(readFileSync(new URL('../../worker/migrations/0003_game_description_format.sql', import.meta.url), 'utf8'))
  database.exec("INSERT INTO categories (name, slug) VALUES ('动作', 'action'), ('冒险', 'adventure')")
  database.exec("INSERT INTO tags (name, slug) VALUES ('开放世界', 'open-world'), ('多人合作', 'coop'), ('旧标签', 'old-tag')")
  const insert = database.prepare("INSERT INTO games (name, slug, cover_url, description, min_config, category_id, resource_type, status, publish_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)")
  for (let i = 1; i <= count; i++) {
    insert.run(`测试游戏 ${i}`, `test-game-${i}`, '/assets/hero/hero-1.webp', '一起探索世界并建造基地，测试图文介绍。', '["操作系统：Windows 10"]', i % 2 + 1, i % 3 ? 'free' : 'member', i % 2 ? '2026-10-01' : '2025-10-01')
    database.prepare('INSERT INTO game_tags (game_id, tag_id) VALUES (?, 1)').run(i)
    if (i % 3 === 0) database.prepare('INSERT INTO game_tags (game_id, tag_id) VALUES (?, 2)').run(i)
  }
  database.prepare("INSERT INTO games (name, slug, cover_url, description, category_id, status, publish_at) VALUES ('隐藏草稿', 'hidden-draft', '/cover.png', '未发布的游戏介绍。', 1, 'draft', '2024-01-01')").run()
  database.exec("UPDATE tags SET status = 'disabled' WHERE slug = 'old-tag'")
  function prepare(sql: string) {
    const statement = database.prepare(sql)
    let values: SQLInputValue[] = []
    return { sql, bind(...bindings: SQLInputValue[]) { values = bindings; return this },
      async all() { return { results: statement.all(...values) } },
      async first() { return statement.get(...values) ?? null },
      async run() { const row = statement.run(...values); return { meta: { changes: Number(row.changes), last_row_id: Number(row.lastInsertRowid) } } } }
  }
  const bindings = { DB: { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => Promise.all(statements.map(statement => statement.all())) }, APP_ENV: 'test', ALLOWED_ORIGIN: 'http://127.0.0.1:5173' } as unknown as AppEnv['Bindings']
  return { database, bindings, close: () => database.close() }
}
async function routeCatalog(page: Page, fixture: ReturnType<typeof catalogFixture>) {
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (!path.startsWith('/api/')) return route.fallback()
    if (path === '/api/auth/me') return route.fulfill({ json: { ok: true, data: null } })
    const response = await worker.request(request.url(), { method: request.method() }, fixture.bindings)
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
  })
}
const ready = (page: Page) => expect(page.locator('#catalog-results')).toHaveAttribute('aria-busy', 'false')

test('公开筛选支持发布年份、会员权限及分类标签组合，计数分页一致', async () => {
  const fixture = catalogFixture()
  try {
    const filters = await worker.request('/api/game-filters', {}, fixture.bindings)
    expect(filters.status).toBe(200)
    expect((await filters.json()).data).toMatchObject({ years: [2026, 2025], tags: [{ name: '多人合作', slug: 'coop' }, { name: '开放世界', slug: 'open-world' }] })
    const response = await worker.request('/api/games?year=2026&resourceType=member&category=adventure&tags=coop,open-world&pageSize=8', {}, fixture.bindings)
    const { data, pagination } = await response.json()
    expect(pagination).toMatchObject({ page: 1, pageSize: 8, total: 30 })
    expect(data).toHaveLength(8)
    expect(data.every((game: { publishAt: string; resourceType: string; category: { slug: string } }) => game.publishAt.startsWith('2026') && game.resourceType === 'member' && game.category.slug === 'adventure')).toBe(true)
    expect(JSON.stringify(data)).not.toContain('description')
    const overflow = await worker.request('/api/games?year=2026&resourceType=member&page=999&pageSize=8', {}, fixture.bindings)
    const last = await overflow.json()
    expect(last.pagination).toMatchObject({ page: 4, total: 30 })
    expect(last.data).toHaveLength(6)
    const invalidTag = await worker.request('/api/games?tags=old-tag', {}, fixture.bindings)
    expect((await invalidTag.json()).data).toEqual([])
    for (const query of ['year=1899', 'year=nope', 'resourceType=invalid', 'page=100001', 'page=1.5', `tags=${Array(21).fill('coop').join(',')}`]) expect((await worker.request(`/api/games?${query}`, {}, fixture.bindings)).status).toBe(400)
  } finally { fixture.close() }
})

test('顶部筛选组合与清除生效，详情返回恢复页码条件和滚动位置', async ({ page }, testInfo) => {
  const fixture = catalogFixture()
  try {
    await routeCatalog(page, fixture)
    await page.goto('/games')
    await ready(page)
    const filter = page.getByRole('region', { name: '游戏筛选', exact: true })
    // The filter section is above, rather than next to, the grid.
    const filterBounds = await filter.boundingBox()
    const resultsBounds = await page.locator('#catalog-results').boundingBox()
    expect(filterBounds!.y + filterBounds!.height).toBeLessThanOrEqual(resultsBounds!.y)
    await filter.getByRole('group', { name: '发布年份', exact: true }).getByRole('button', { name: '2026', exact: true }).click()
    await filter.getByRole('group', { name: '资源权限', exact: true }).getByRole('button', { name: '会员资源', exact: true }).click()
    await filter.getByRole('group', { name: '分类', exact: true }).getByRole('button', { name: '冒险', exact: true }).click()
    await filter.getByRole('group', { name: /标签/ }).getByRole('button', { name: '多人合作', exact: true }).click()
    await ready(page)
    await expect(page.locator('.results-header')).toContainText('30 个结果')
    expect(new URL(page.url()).searchParams.get('tags')).toBe('coop')
    await page.screenshot({ path: `.wrangler/catalog-filters-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' })
    await page.locator('.results-pagination .btn-next').click()
    await ready(page)
    await expect(page).toHaveURL(/page=2/)
    await page.locator('.game-card').first().scrollIntoViewIfNeeded()
    const scroll = await page.evaluate(() => window.scrollY)
    const listPath = new URL(page.url()).pathname + new URL(page.url()).search
    await page.locator('.game-card').first().click()
    await expect(page.getByRole('heading', { name: /测试游戏/, level: 1 })).toBeVisible()
    await page.getByRole('link', { name: '返回游戏库', exact: true }).click()
    await expect(page).toHaveURL(`http://127.0.0.1:5173${listPath}`)
    await ready(page)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0)
    await page.locator('.catalog-selected').getByRole('button', { name: '2026 年' }).click()
    await ready(page)
    expect(new URL(page.url()).searchParams.has('year')).toBe(false)
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
    await page.getByRole('button', { name: '重置', exact: true }).click()
    await ready(page)
    await expect(page.locator('.results-header')).toContainText('180 个结果')
    await page.getByRole('button', { name: '切换到夜间模式' }).click()
    await page.screenshot({ path: `.wrangler/catalog-dark-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); fixture.close() }
})

test('公开分页缓存限制六页、30秒过期，浏览器后退及响应式切换保持有效页码', async ({ page }, testInfo) => {
  const fixture = catalogFixture()
  try {
    await routeCatalog(page, fixture)
    const counts = new Map<string, number>()
    await page.route('**/api/games?*', async route => {
      const url = new URL(route.request().url())
      const key = `${url.searchParams.get('pageSize')}:${url.searchParams.get('page')}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      await route.fallback()
    })
    await page.goto('/games')
    await ready(page)
    const size = testInfo.project.name.startsWith('mobile') ? 8 : 20
    for (let p = 2; p <= 8; p++) {
      await page.locator('.results-pagination .btn-next').click()
      await expect(page).toHaveURL(new RegExp(`page=${p}(?:&|$)`))
      await ready(page)
    }
    await page.goBack()
    await ready(page)
    await expect(page.locator('.catalog-page-label')).toContainText('第 7 /')
    expect(counts.get(`${size}:7`)).toBe(1)
    await page.locator('.results-pagination').getByRole('listitem', { name: 'page 1', exact: true }).click()
    await ready(page)
    expect(counts.get(`${size}:1`)).toBe(2)
    await page.clock.install()
    await page.clock.fastForward(31000)
    await page.locator('.results-pagination .btn-next').click()
    await ready(page)
    expect(counts.get(`${size}:2`)).toBe(2)
    await page.setViewportSize(size === 20 ? { width: 390, height: 844 } : { width: 1440, height: 900 })
    await ready(page)
    await expect(page.locator('.game-card')).toHaveCount(size === 20 ? 8 : 20)
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
    await page.getByRole('button', { name: '刷新游戏列表' }).click()
    await ready(page)
    expect(counts.get(`${size === 20 ? 8 : 20}:1`)).toBe(2)
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); fixture.close() }
})

test('迟到列表响应不会覆盖新条件，离开列表不会被搜索防抖拉回', async ({ page }) => {
  const fixture = catalogFixture()
  let release: (() => void) | undefined
  try {
    await routeCatalog(page, fixture)
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/games?*', async route => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('year') !== '2025') return route.fallback()
      await gate
      await route.fulfill({ json: { ok: true, data: [], pagination: { page: 1, pageSize: 20, total: 0 } } }).catch(() => {})
    })
    await page.goto('/games')
    await ready(page)
    const years = page.getByRole('group', { name: '发布年份', exact: true })
    await years.getByRole('button', { name: '2025', exact: true }).click()
    await years.getByRole('button', { name: '2026', exact: true }).click()
    await ready(page)
    release!()
    await expect(page.locator('.results-header')).toContainText('90 个结果')
    await page.getByRole('textbox', { name: '搜索游戏名称', exact: true }).fill('待提交搜索')
    await page.getByRole('link', { name: '游浪首页', exact: true }).click()
    await expect(page.getByRole('heading', { name: '下一段冒险，从这里启程' })).toBeVisible()
    await page.clock.install()
    await page.clock.fastForward(1000)
    await expect(page).toHaveURL('http://127.0.0.1:5173/')
  } finally { release?.(); await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); fixture.close() }
})

test('坏图显示占位，筛选加载失败可重试，非法页码回退且搜索限制80字符', async ({ page }, testInfo) => {
  const fixture = catalogFixture(26)
  try {
    await routeCatalog(page, fixture)
    let attempts = 0
    await page.route('**/api/game-filters', async route => {
      if (++attempts === 1) return route.fulfill({ status: 503, json: { ok: false, error: { code: 'UNAVAILABLE', message: '筛选不可用' } } })
      await route.fallback()
    })
    await page.route('**/assets/hero/hero-1.webp', route => route.abort())
    await page.goto('/games?page=999')
    await ready(page)
    await expect(page.locator('.filter-load-error')).toBeVisible()
    await page.getByRole('button', { name: '重新加载筛选项' }).click()
    await expect(page.getByRole('group', { name: '发布年份' }).getByRole('button', { name: '2026' })).toBeVisible()
    const lastPage = testInfo.project.name.startsWith('mobile') ? 4 : 2
    await expect(page).toHaveURL(new RegExp(`page=${lastPage}`))
    await expect(page.locator('.game-cover-fallback')).toHaveCount(testInfo.project.name.startsWith('mobile') ? 2 : 6)
    await expect(page.getByRole('textbox', { name: '搜索游戏名称' })).toHaveAttribute('maxlength', '80')
    await page.goto('/games?page=-3')
    await ready(page)
    await expect(page.locator('.catalog-page-label')).toContainText('第 1 /')
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); fixture.close() }
})

test('缓存过期后的慢速详情返回等待列表就绪再恢复位置', async ({ page }) => {
  const fixture = catalogFixture()
  let release: (() => void) | undefined
  try {
    await routeCatalog(page, fixture)
    await page.goto('/games?year=2026&page=2')
    await ready(page)
    await page.locator('.game-card').last().scrollIntoViewIfNeeded()
    const position = await page.evaluate(() => window.scrollY)
    await page.locator('.game-card').last().click()
    await expect(page.getByRole('heading', { level: 1, name: /测试游戏/ })).toBeVisible()
    await page.clock.install()
    await page.clock.fastForward(31000)
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/games?*', async route => { await gate; await route.fallback() })
    await page.getByRole('link', { name: '返回游戏库', exact: true }).click()
    await expect(page.locator('#catalog-results')).toHaveAttribute('aria-busy', 'true')
    await expect(page).toHaveURL(/year=2026&page=2/)
    release!()
    await ready(page)
    // Hover transforms and browser anchoring may round the scroll by a few pixels.
    await expect.poll(() => page.evaluate(expected => Math.abs(window.scrollY - expected), position)).toBeLessThanOrEqual(5)
  } finally { release?.(); await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); fixture.close() }
})
