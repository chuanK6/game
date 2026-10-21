import { expect, test, type Page } from '@playwright/test'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { Hono } from 'hono'
import worker from '../../worker/src/index'
import admin from '../../worker/src/admin'
import type { AppEnv } from '../../worker/src/types'

function fixture() {
  const db = new DatabaseSync(':memory:')
  const directory = new URL('../../worker/migrations/', import.meta.url)
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, directory), 'utf8'))
  db.exec("INSERT INTO categories (name, slug) VALUES ('动作', 'action')")
  const game = { name: '旧游戏', slug: 'old-game', coverUrl: '/assets/hero/hero-1.webp', description: '这是一段超过十个字符的游戏介绍。', descriptionFormat: 'markdown', minConfig: ['内存：8GB'], categoryId: 1, resourceType: 'free', resourceStatus: 'available', status: 'published', publishAt: '2020-01-01', tagIds: [], downloads: [] }
  const operator = { id: 1, username: '测试管理员', avatarUrl: null, role: 'admin' as const, isSuper: false, memberType: 'none' as const, memberExpireAt: null, isMember: false }
  function prepare(sql: string) {
    const statement = db.prepare(sql)
    let values: SQLInputValue[] = []
    return { sql, bind(...bindings: SQLInputValue[]) { values = bindings; return this },
      async all() { return { results: statement.all(...values) } },
      async first() { return statement.get(...values) ?? null },
      async run() { const row = statement.run(...values); return { meta: { changes: Number(row.changes), last_row_id: Number(row.lastInsertRowid) } } } }
  }
  const bindings = { DB: { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    db.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(/^\s*SELECT/i.test(statement.sql) ? await statement.all() : await statement.run())
      db.exec('COMMIT')
      return results
    } catch (cause) { db.exec('ROLLBACK'); throw cause }
  } }, APP_ENV: 'test', ALLOWED_ORIGIN: 'http://127.0.0.1:5173' } as unknown as AppEnv['Bindings']
  const request = (path: string, init: RequestInit = {}, role: 'admin' | 'user' | null = 'admin') => {
    if (!path.startsWith('/api/admin')) return worker.request(`http://127.0.0.1:5173${path}`, init, bindings)
    const app = new Hono<AppEnv>()
    app.use('*', async (context, next) => { if (role) context.set('user', { ...operator, role }); await next() })
    app.route('/api/admin', admin)
    return app.request(`http://127.0.0.1:5173${path}`, init, bindings)
  }
  const write = (path: string, body: unknown, method = 'POST') => request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const insert = (title: string, date: string, status = 'published', popup = 1, content = '## 公告内容\n\n**更新说明**，欢迎回来。') => Number(db.prepare('INSERT INTO announcements (title, content, status, show_popup, created_at) VALUES (?, ?, ?, ?, ?)').run(title, content, status, popup, date).lastInsertRowid)
  return { db, game, operator, request, write, insert, close: () => db.close() }
}

async function routeApi(page: Page, data: ReturnType<typeof fixture>, loggedIn = false) {
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return route.fallback()
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { ok: true, data: loggedIn ? data.operator : null } })
    const response = await data.request(url.pathname + url.search, { method: request.method(), body: request.postDataBuffer() ?? undefined, headers: await request.allHeaders() })
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
  })
}

test('公告真实接口：权限、CRUD、校验、组合查询、分页与创建时间排序', async () => {
  const data = fixture()
  try {
    const old = data.insert('旧公告', '2025-01-01 00:00:00')
    const newest = data.insert('最新公告', '2026-10-21 00:00:00')
    const draft = data.insert('隐藏草稿', '2099-01-01 00:00:00', 'draft')
    const archived = data.insert('隐藏归档', '2099-01-01 00:00:00', 'archived')
    for (const role of [null, 'user'] as const) {
      for (const [path, method] of [['', 'GET'], ['', 'POST'], [`/${old}`, 'GET'], [`/${old}`, 'PUT'], [`/${old}`, 'DELETE']]) {
        expect((await data.request(`/api/admin/announcements${path}`, { method }, role)).status).toBe(role ? 403 : 401)
      }
    }
    for (const id of [draft, archived]) expect((await data.request(`/api/announcements/${id}`)).status).toBe(404)
    expect((await (await data.request('/api/announcements/latest')).json()).data.id).toBe(newest)
    const payload = { title: '修改旧公告', content: '更新旧内容', status: 'published', showPopup: true }
    expect((await data.write(`/api/admin/announcements/${old}`, payload, 'PUT')).status).toBe(200)
    expect((await (await data.request('/api/announcements/latest')).json()).data.id).toBe(newest)
    for (let i = 0; i < 23; i++) data.insert(`分页公告${i}`, '2024-01-01 00:00:00', 'draft', 0)
    const list = (await (await data.request('/api/admin/announcements?q=分页&status=draft&showPopup=0&page=999')).json()).data
    expect(list.pagination).toEqual({ page: 3, pageSize: 10, total: 23 })
    expect(list.items).toHaveLength(3)
    expect(list.items[0]).not.toHaveProperty('content')
    for (const body of [{ ...payload, title: ' ' }, { ...payload, content: ' ' }, { ...payload, content: 'a'.repeat(30001) }, { ...payload, status: 'bad' }, { ...payload, showPopup: 1 }]) expect((await data.write('/api/admin/announcements', body)).status).toBe(400)
    for (const query of ['page=0', 'status=bad', 'showPopup=true']) expect((await data.request(`/api/admin/announcements?${query}`)).status).toBe(400)
    const created = await data.write('/api/admin/announcements', { ...payload, title: '新建公告', showPopup: false })
    expect(created.status).toBe(201)
    const id = (await created.json()).data.id
    expect((await (await data.request(`/api/admin/announcements/${id}`)).json()).data.show_popup).toBe(0)
    expect((await (await data.request('/api/announcements/latest?popup=1')).json()).data.id).toBe(newest)
    expect((await data.request(`/api/admin/announcements/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await data.request(`/api/announcements/${id}`)).status).toBe(404)
    expect((await data.request(`/api/admin/announcements/${id}`, { method: 'DELETE' })).status).toBe(404)
  } finally { data.close() }
})

test('置顶真实接口：优先排序、组合筛选、草稿隔离与旧客户端兼容', async () => {
  const data = fixture()
  try {
    const old = (await (await data.write('/api/admin/games', { ...data.game, isPinned: true })).json()).data.id
    await data.write('/api/admin/games', { ...data.game, name: '新游戏', slug: 'new-game', publishAt: '2026-10-21', isPinned: false })
    await data.write('/api/admin/games', { ...data.game, name: '置顶草稿', slug: 'draft-game', status: 'draft', isPinned: true })
    const list = (await (await data.request('/api/games?pageSize=1')).json())
    expect(list.data[0]).toMatchObject({ id: old, isPinned: true })
    expect(list.data[0]).not.toHaveProperty('downloads')
    expect(list.pagination.total).toBe(2)
    const filtered = (await (await data.request('/api/games?year=2026&resourceType=free')).json()).data
    expect(filtered).toHaveLength(1)
    expect(filtered[0].slug).toBe('new-game')
    await data.write(`/api/admin/games/${old}`, data.game, 'PUT')
    expect((await (await data.request(`/api/admin/games/${old}`)).json()).data.is_pinned).toBe(1)
    await data.write(`/api/admin/games/${old}`, { ...data.game, isPinned: false }, 'PUT')
    expect((await (await data.request('/api/games')).json()).data[0].slug).toBe('new-game')
    expect((await data.write('/api/admin/games', { ...data.game, isPinned: 'yes' })).status).toBe(400)
  } finally { data.close() }
})

test('公告弹窗：自动显示、Markdown安全、历史分页返回、两种关闭与铃铛入口', async ({ page }, testInfo) => {
  const data = fixture()
  try {
    for (let i = 0; i < 12; i++) data.insert(`往期公告${i}`, '2025-01-01 00:00:00')
    data.insert('最新公告标题', '2026-10-21 00:00:00', 'published', 1, '## 更新日志\n\n**加粗公告**\n\n<script>window.announcementXss = true</script>\n\n[危险链接](javascript:alert(1))')
    await routeApi(page, data)
    await page.goto('/games')
    const dialog = page.getByRole('dialog', { name: '网站公告', exact: true })
    await expect(dialog.getByRole('heading', { name: '最新公告标题' })).toBeVisible()
    await expect(dialog.locator('.markdown-content strong')).toHaveText('加粗公告')
    expect(await page.evaluate(() => (window as unknown as { announcementXss?: boolean }).announcementXss)).toBeUndefined()
    await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0)
    await dialog.getByRole('button', { name: '往期公告', exact: true }).click()
    await expect(dialog.locator('.announcement-history li')).toHaveCount(10)
    await dialog.locator('.btn-next').click()
    await expect(dialog.locator('.announcement-history li')).toHaveCount(3)
    await dialog.locator('.announcement-history button').first().click()
    await expect(dialog.getByRole('heading', { name: /往期公告/ })).toBeVisible()
    await dialog.getByRole('button', { name: '返回公告列表' }).click()
    await expect(dialog.locator('.announcement-history li')).toHaveCount(3)
    await dialog.getByRole('button', { name: '本次关闭' }).click()
    await expect(dialog).not.toBeVisible()
    await page.getByRole('link', { name: '游浪首页' }).click()
    await expect(page).toHaveURL('/')
    await expect(dialog).not.toBeVisible()
    await page.reload()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '本日关闭' }).click()
    await expect(dialog).not.toBeVisible()
    await page.reload()
    await expect(page.locator('.site-header')).toBeVisible()
    await expect(dialog).not.toBeVisible()
    await page.getByRole('button', { name: '查看网站公告' }).click()
    await expect(dialog.getByRole('heading', { name: '最新公告标题' })).toBeVisible()
    await dialog.getByRole('button', { name: '本次关闭' }).click()
    await page.evaluate(() => localStorage.setItem('youlun-announcements-dismissed-date', '2020-01-01'))
    await page.reload()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '本次关闭' }).click()
    await page.getByRole('button', { name: '切换到夜间模式' }).click()
    await page.getByRole('button', { name: '查看网站公告' }).click()
    await expect(dialog.getByRole('heading', { name: '最新公告标题' })).toBeVisible()
    await page.screenshot({ path: `.wrangler/announcements-${testInfo.project.name}.png`, animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); data.close() }
})

test('后台公告第二导航支持新建、点击标题编辑、取消、筛选和删除', async ({ page }, testInfo) => {
  const data = fixture()
  try {
    await routeApi(page, data, true)
    await page.goto('/admin')
    await expect(page.locator('.admin-sidebar nav button').nth(1)).toHaveText('公告管理')
    await page.getByRole('button', { name: '公告管理', exact: true }).click()
    await page.getByRole('button', { name: '新增公告', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '新增公告', exact: true })
    await editor.getByRole('button', { name: '保存公告' }).click()
    await expect(editor.getByText('请输入 1～100 字符的公告标题')).toBeVisible()
    await editor.getByLabel('公告标题').fill('站点更新')
    expect((await editor.getByRole('checkbox', { name: '进入网站时自动弹出' }).boundingBox())!.width).toBeLessThanOrEqual(20)
    await editor.getByLabel('公告正文 Markdown').fill('## 新功能\n\n支持 **Markdown** 公告。')
    await editor.getByLabel('发布状态', { exact: true }).selectOption('published')
    await editor.getByRole('button', { name: '保存公告' }).click()
    await expect(editor).not.toBeVisible()
    await expect(page.locator('.announcement-table tbody')).toContainText('站点更新')
    await page.getByRole('button', { name: '站点更新', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '编辑公告', exact: true })
    await edit.getByLabel('公告标题').fill('取消的修改')
    await edit.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('button', { name: '站点更新', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '站点更新', exact: true }).click()
    await edit.getByLabel('公告标题').fill('更新后公告')
    await edit.getByLabel('发布状态', { exact: true }).selectOption('archived')
    await page.screenshot({ path: `.wrangler/announcement-editor-${testInfo.project.name}.png`, animations: 'disabled' })
    await edit.getByRole('button', { name: '保存公告' }).click()
    await expect(edit).not.toBeVisible()
    const filters = page.getByRole('form', { name: '公告筛选' })
    await filters.getByLabel('发布状态').selectOption('published')
    await expect(page.locator('.announcement-table tbody')).toContainText('暂无公告')
    await filters.getByLabel('发布状态').selectOption('archived')
    await expect(page.locator('.announcement-table tbody')).toContainText('更新后公告')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: '删除更新后公告', exact: true }).click()
    await expect(page.locator('.announcement-table tbody')).toContainText('暂无公告')
    expect(data.db.prepare('SELECT COUNT(*) AS total FROM announcements').get()!.total).toBe(0)
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); data.close() }
})

test('游戏编辑保存置顶并在公开卡片左上角显示标记', async ({ page }) => {
  const data = fixture()
  try {
    await data.write('/api/admin/games', { ...data.game, isPinned: false })
    await routeApi(page, data, true)
    await page.goto('/admin')
    await page.getByRole('button', { name: '游戏资源', exact: true }).click()
    await page.locator('.game-list-table').getByRole('button', { name: '编辑', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '编辑游戏', exact: true })
    await editor.getByLabel('置顶游戏', { exact: true }).check()
    expect((await editor.getByLabel('置顶游戏', { exact: true }).boundingBox())!.width).toBeLessThanOrEqual(20)
    await editor.getByRole('button', { name: '保存游戏', exact: true }).click()
    await expect(editor).not.toBeVisible()
    await expect(page.locator('.admin-pinned-label')).toHaveText('置顶')
    await page.getByRole('link', { name: '回到网站', exact: true }).click()
    await page.goto('/games')
    await expect(page.locator('.game-card .pinned-badge')).toHaveText('置顶')
    expect(data.db.prepare('SELECT is_pinned FROM games WHERE slug = ?').get('old-game')!.is_pinned).toBe(1)
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); data.close() }
})

test('无自动弹窗公告时安静浏览，铃铛仍能查看公告且失败后可重试', async ({ page }) => {
  const data = fixture()
  try {
    data.insert('手动公告', '2026-10-21 00:00:00', 'published', 0)
    await routeApi(page, data)
    await page.goto('/games')
    await expect(page.locator('#catalog-results')).toHaveAttribute('aria-busy', 'false')
    const dialog = page.getByRole('dialog', { name: '网站公告', exact: true })
    await expect(dialog).not.toBeVisible()
    await page.route('**/api/announcements/latest', route => route.fulfill({ status: 503, json: { ok: false, error: { code: 'OFFLINE', message: '公告暂时不可用' } } }))
    await page.getByRole('button', { name: '查看网站公告' }).click()
    await expect(dialog.getByRole('alert')).toContainText('公告暂时不可用')
    await page.unroute('**/api/announcements/latest')
    await dialog.getByRole('button', { name: '重新加载' }).click()
    await expect(dialog.getByRole('heading', { name: '手动公告' })).toBeVisible()
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); data.close() }
})
