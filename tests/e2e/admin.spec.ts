import { expect, test, type Page } from '@playwright/test'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import admin from '../../worker/src/admin'
import { serializeUser } from '../../worker/src/auth'
import type { AppEnv } from '../../worker/src/types'

function fixture(extra = 0) {
  const sqlite = new DatabaseSync(':memory:')
  for (const name of ['0001_initial.sql', '0002_auth_attempts.sql', '0003_game_description_format.sql']) sqlite.exec(readFileSync(new URL(`../../worker/migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id, username, password_hash) VALUES (1, 's0xu', 'test')")
  sqlite.exec(readFileSync(new URL('../../worker/migrations/0004_user_management.sql', import.meta.url), 'utf8'))
  const insert = sqlite.prepare('INSERT INTO users (id, username, password_hash, role, member_type, member_expire_at) VALUES (?, ?, ?, ?, ?, ?)')
  insert.run(2, '测试管理员', 'test', 'admin', 'none', null)
  insert.run(3, '其他管理员', 'test', 'admin', 'monthly', '2020-01-01 00:00:00')
  insert.run(4, '过期用户', 'test', 'user', 'monthly', '2020-01-01 00:00:00')
  insert.run(5, '有效用户', 'test', 'user', 'monthly', '2099-01-01 00:00:00')
  insert.run(6, '终身用户', 'test', 'user', 'lifetime', null)
  insert.run(7, '无效时间', 'test', 'user', 'monthly', 'invalid-date')
  insert.run(8, '无到期时间', 'test', 'user', 'monthly', null)
  insert.run(9, '带时区月度', 'test', 'user', 'monthly', '2099-01-01T08:00:00+08:00')
  insert.run(10, '临期用户', 'test', 'user', 'monthly', new Date(Date.now() + 3 * 86400000).toISOString())
  sqlite.exec("UPDATE users SET last_login_at = '2026-10-19 08:30:00' WHERE id = 5")
  for (let i = 0; i < extra; i++) insert.run(11 + i, `分页用户${i}`, 'test', 'user', 'none', null)
  sqlite.exec("INSERT INTO categories (name, slug) VALUES ('模拟经营', 'simulation')")
  sqlite.exec("INSERT INTO tags (name, slug) VALUES ('休闲', 'casual')")
  function prepare(sql: string) {
    const statement = sqlite.prepare(sql)
    let values: SQLInputValue[] = []
    return { sql, bind(...bindings: SQLInputValue[]) { values = bindings; return this },
      async all() { return { results: statement.all(...values) } },
      async first() { return statement.get(...values) ?? null },
      async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } } }
  }
  const bindings = { DB: { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    sqlite.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(/^\s*SELECT/i.test(statement.sql) ? await statement.all() : await statement.run())
      sqlite.exec('COMMIT')
      return results
    } catch (error) { sqlite.exec('ROLLBACK'); throw error }
  } } } as unknown as AppEnv['Bindings']
  const operator = (id: number) => serializeUser(sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as Parameters<typeof serializeUser>[0])
  function request(path: string, id = 1, init: RequestInit = {}) {
    const app = new Hono<AppEnv>()
    app.use('*', async (context, next) => { if (id) context.set('user', operator(id)); await next() })
    app.route('/api/admin', admin)
    return app.request(`/api/admin${path}`, init, bindings)
  }
  const change = (path: string, id: number, body: unknown, method = 'PATCH') => request(path, id, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { sqlite, operator, request, change, close: () => sqlite.close() }
}

async function routeAdmin(page: Page, data: ReturnType<typeof fixture>, operatorId = 1) {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { ok: true, data: data.operator(operatorId) } }))
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), url = new URL(request.url())
    const response = await data.request(url.pathname.replace('/api/admin', '') + url.search, operatorId, {
      method: request.method(), headers: await request.allHeaders(), body: request.postDataBuffer() ?? undefined,
    })
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
  })
  await page.goto('/admin')
  await page.getByRole('button', { name: '用户管理', exact: true }).click()
  await expect(page.locator('.user-list-table tbody tr')).toHaveCount(10)
}

test('会员有效性、角色计数、组合筛选和超过200条数据使用服务端分页', async () => {
  const data = fixture(225)
  try {
    const first = await (await data.request('/users')).json()
    expect(first.data.counts).toEqual({ total: 235, admin: 3, user: 232 })
    expect(first.data.users).toHaveLength(10)
    expect(first.data.users[0]).toMatchObject({ username: 's0xu', is_super: 1 })
    const last = await (await data.request('/users?page=999')).json()
    expect(last.data.pagination).toMatchObject({ page: 24, total: 235 })
    expect(last.data.users).toHaveLength(5)
    const members = await (await data.request('/users?role=user&memberType=monthly&status=active')).json()
    expect(members.data.pagination.total).toBe(3)
    expect(members.data.users.map((user: { id: number }) => user.id).sort((a: number, b: number) => a - b)).toEqual([5, 9, 10])
    expect(members.data.counts).toEqual({ total: 3, admin: 0, user: 3 })
    for (const id of [4, 7, 8]) {
      const name = data.sqlite.prepare('SELECT username FROM users WHERE id = ?').get(id)!.username as string
      const user = await (await data.request(`/users?q=${encodeURIComponent(name)}&memberType=none`)).json()
      expect(user.data.users[0]).toMatchObject({ id, member_type: 'none' })
    }
    for (const query of ['page=0', 'page=1.5', 'role=super', 'status=broken', 'memberType=broken']) expect((await data.request(`/users?${query}`)).status).toBe(400)
  } finally { data.close() }
})

test('直接接口不能绕过超管、自身及其他管理员保护，只有超管可以任免', async () => {
  const data = fixture()
  try {
    expect((await data.request('/users', 0)).status).toBe(401)
    expect((await data.request('/users', 4)).status).toBe(403)
    data.sqlite.exec("UPDATE users SET username = '已改名超管' WHERE id = 1")
    expect(data.operator(1).isSuper).toBe(true)
    for (const id of [1, 2]) {
      for (const body of [{ status: 'disabled' }, { role: 'user' }, { memberType: 'lifetime' }]) expect((await data.change('/users/1', id, body)).status).toBe(403)
      expect((await data.request('/users/1', id, { method: 'DELETE' })).status).toBe(403)
    }
    for (const target of [2, 3]) {
      for (const body of [{ role: 'user' }, { status: 'disabled' }, { memberType: 'lifetime' }]) expect((await data.change(`/users/${target}`, 2, body)).status).toBe(403)
      expect((await data.request(`/users/${target}`, 2, { method: 'DELETE' })).status).toBe(403)
    }
    expect((await data.change('/users/4', 2, { role: 'admin' })).status).toBe(403)
    expect((await data.change('/users/4', 2, { is_super: 1, memberType: 'lifetime' })).status).toBe(400)
    expect((await data.change('/users/4', 2, { memberType: 'lifetime' })).status).toBe(200)
    expect((await data.change('/users/4', 1, { role: 'admin' })).status).toBe(200)
    expect((await data.change('/users/4', 2, { status: 'disabled' })).status).toBe(403)
    expect((await data.change('/users/4', 1, { role: 'user' })).status).toBe(200)
    expect(() => data.sqlite.exec("UPDATE users SET role = 'user' WHERE id = 1")).toThrow('SUPER_USER_PROTECTED')
    expect(() => data.sqlite.exec('DELETE FROM users WHERE id = 1')).toThrow('SUPER_USER_PROTECTED')
  } finally { data.close() }
})

test('批量整批预校验、撤销禁用会话、记录会员审计并拒绝受保护账号', async () => {
  const data = fixture()
  try {
    data.sqlite.exec("INSERT INTO sessions (user_id, token_hash, expire_at) VALUES (4, 'token', '2099-01-01')")
    for (const ids of [[4, 1], [4, 3], [4, 2]]) expect((await data.change('/users/bulk', 2, { action: 'disable', ids }, 'POST')).status).toBe(403)
    expect(data.sqlite.prepare('SELECT status FROM users WHERE id = 4').get()!.status).toBe('active')
    expect((await data.change('/users/bulk', 2, { action: 'membership', ids: [4, 5], memberType: 'monthly' }, 'POST')).status).toBe(400)
    expect((await data.change('/users/bulk', 2, { action: 'membership', ids: [4, 5, 4], memberType: 'monthly', memberExpireAt: '2099-01-01T00:00:00Z' }, 'POST')).status).toBe(200)
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM membership_changes').get()!.n).toBe(1)
    expect((await data.change('/users/bulk', 2, { action: 'disable', ids: [4, 5] }, 'POST')).status).toBe(200)
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n).toBe(0)
    expect(data.sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE id IN (4, 5) AND status = 'disabled'").get()!.n).toBe(2)
    expect((await data.change('/users/8', 2, { status: 'disabled' })).status).toBe(200)
    expect((await data.change('/users/bulk', 2, { action: 'disable', ids: [6, 999] }, 'POST')).status).toBe(404)
    expect(data.sqlite.prepare('SELECT status FROM users WHERE id = 6').get()!.status).toBe('active')
    expect((await data.request('/users/6', 2, { method: 'DELETE' })).status).toBe(200)
    expect((await (await data.request('/users?q=终身用户')).json()).data.pagination.total).toBe(0)
  } finally { data.close() }
})

test('工单和反馈服务端分页，工单开通会员不能绕过用户保护', async () => {
  const data = fixture()
  try {
    for (let i = 0; i < 215; i++) {
      data.sqlite.exec("INSERT INTO membership_orders (user_id, plan, payment_channel) VALUES (4, 'monthly', 'wechat')")
      data.sqlite.exec("INSERT INTO feedback (user_id, type, title, content) VALUES (4, 'website', '测试反馈', '测试反馈内容')")
    }
    for (const path of ['orders', 'feedback']) {
      const first = await (await data.request(`/${path}?q=过期用户`)).json()
      expect(first.data.items).toHaveLength(10)
      expect(first.data.pagination.total).toBe(215)
      const last = await (await data.request(`/${path}?page=999`)).json()
      expect(last.data.pagination.page).toBe(22)
      expect(last.data.items).toHaveLength(5)
      expect((await data.request(`/${path}?page=0`)).status).toBe(400)
    }
    for (const target of [1, 3]) {
      const inserted = data.sqlite.prepare("INSERT INTO membership_orders (user_id, plan, payment_channel) VALUES (?, 'monthly', 'wechat')").run(target)
      expect((await data.change(`/orders/${inserted.lastInsertRowid}`, 2, { status: 'approved' })).status).toBe(403)
      expect(data.sqlite.prepare('SELECT status FROM membership_orders WHERE id = ?').get(inserted.lastInsertRowid)!.status).toBe('pending')
    }
  } finally { data.close() }
})

test('抽屉编辑和取消、临期及登录展示、批量会员、删除确认和分类标签操作', async ({ page }, testInfo) => {
  const data = fixture()
  try {
    await routeAdmin(page, data)
    const expired = page.getByRole('row').filter({ hasText: '过期用户' })
    const active = page.getByRole('row').filter({ hasText: '有效用户' })
    await expect(expired.getByRole('combobox')).toHaveCount(0)
    await expect(expired).toContainText('普通')
    await expect(active).toContainText('2026-10-19 16:30:00')
    await expect(page.getByRole('row').filter({ hasText: '临期用户' })).toContainText('7 天内到期')
    const superRow = page.getByRole('row').filter({ hasText: 's0xu' })
    await expect(superRow.getByRole('button', { name: '编辑', exact: true })).toBeDisabled()
    await expect(superRow.getByRole('checkbox')).toBeDisabled()
    await active.getByRole('button', { name: '编辑', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '编辑用户' })
    await drawer.getByLabel('会员类型').selectOption('none')
    await drawer.getByRole('button', { name: '取消', exact: true }).click()
    await expect(active).toContainText('月度会员')
    await active.getByRole('button', { name: '编辑', exact: true }).click()
    await drawer.getByLabel('到期时间（北京时间）').fill('2020-01-01T08:00')
    await drawer.getByRole('button', { name: '保存', exact: true }).click()
    await expect(drawer).toBeHidden()
    await expect(active).toContainText('普通')
    await expect(active).toContainText('原到期')
    await expired.getByRole('checkbox').check()
    await active.getByRole('checkbox').check()
    await page.getByRole('button', { name: '批量设置会员', exact: true }).click()
    const bulk = page.getByRole('dialog', { name: '批量设置会员' })
    await bulk.getByLabel('会员类型').selectOption('lifetime')
    await bulk.getByRole('button', { name: '确认设置', exact: true }).click()
    await expect(bulk).toBeHidden()
    await expect(expired).toContainText('终身会员')
    await expect(active).toContainText('终身会员')
    await active.getByRole('button', { name: '删除有效用户', exact: true }).click()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(active).toBeVisible()
    await active.getByRole('button', { name: '删除有效用户', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(active).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '全部 (9)', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/admin-users-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: '分类与标签', exact: true }).click()
    await expect(page.locator('.taxonomy-table')).toHaveCount(1)
    await page.locator('.taxonomy-table').getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '编辑分类' })).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('group', { name: '分类与标签切换' }).getByRole('button', { name: '标签', exact: true }).click()
    await page.locator('.taxonomy-table').getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '编辑标签' })).toBeVisible()
  } finally { data.close() }
})

test('普通管理员限制、角色切换及翻页清空选择、筛选和批量禁用', async ({ page }) => {
  const data = fixture(15)
  try {
    await routeAdmin(page, data, 2)
    await expect(page.getByRole('row').filter({ hasText: '其他管理员' }).getByRole('button', { name: '编辑', exact: true })).toBeDisabled()
    await page.getByRole('tab', { name: '普通用户 (22)', exact: true }).click()
    await expect(page.locator('.user-list-table tbody tr')).toHaveCount(10)
    await page.getByRole('checkbox', { name: '全选当前页可操作用户' }).check()
    await expect(page.locator('.user-bulk-bar')).toContainText('已选 10 项')
    await page.locator('.admin-users .btn-next').click()
    await expect(page.locator('.user-bulk-bar')).toContainText('已选 0 项')
    await page.getByLabel('搜索用户名').fill('有效用户')
    await page.locator('.user-filters').getByRole('button', { name: '搜索', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: '有效用户' })
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '编辑用户' })
    await expect(drawer.getByLabel('角色', { exact: true })).toBeDisabled()
    await drawer.getByRole('button', { name: '取消', exact: true }).click()
    await row.getByRole('checkbox').check()
    await page.getByRole('button', { name: '批量禁用', exact: true }).click()
    await page.getByRole('button', { name: '确认禁用', exact: true }).click()
    await expect(row).toContainText('禁用')
    await page.getByLabel('账号状态', { exact: true }).selectOption('active')
    await expect(page.locator('.user-list-table')).toContainText('没有符合条件的用户')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  } finally { data.close() }
})

test('快速切换用户条件隔离过期响应，加载失败可重试，夜间手机布局无溢出', async ({ page }, testInfo) => {
  const data = fixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const pending = new Promise<void>(resolve => { started = resolve })
  try {
    await routeAdmin(page, data)
    await page.route('**/api/admin/users?**', async route => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('role') !== 'admin') return route.fallback()
      const response = await data.request('/users' + url.search)
      started()
      await gate
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() }).catch(() => {})
    })
    await page.getByRole('tab', { name: '管理员 (3)', exact: true }).click()
    await pending
    await page.getByRole('tab', { name: '普通用户 (7)', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: '有效用户' })).toBeVisible()
    release()
    await expect(page.locator('.user-list-table tbody .user-badge.admin')).toHaveCount(0)
    await expect(page.getByRole('row').filter({ hasText: 's0xu' })).toHaveCount(0)
    let fail = true
    await page.route('**/api/admin/users?**', route => fail
      ? route.fulfill({ status: 503, json: { ok: false, error: { code: 'UNAVAILABLE', message: '暂时不可用' } } })
      : route.fallback())
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('暂时不可用')
    fail = false
    await page.getByRole('button', { name: '重新加载', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: '有效用户' })).toBeVisible()
    await page.getByRole('button', { name: '切换到夜间模式', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `test-results/admin-users-dark-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' })
  } finally { release?.(); data.close() }
})

test('工单与反馈界面翻页、搜索回第一页及删除末页数据后自动回退', async ({ page }) => {
  const data = fixture()
  try {
    for (let i = 1; i <= 11; i++) {
      data.sqlite.exec("INSERT INTO membership_orders (user_id, plan, payment_channel) VALUES (4, 'monthly', 'wechat')")
      data.sqlite.prepare("INSERT INTO feedback (user_id, type, title, content) VALUES (4, 'website', ?, '反馈测试内容')").run(`分页反馈${i}`)
    }
    await routeAdmin(page, data)
    await page.getByRole('button', { name: '会员工单', exact: true }).click()
    await expect(page.locator('.admin-list-row')).toHaveCount(10)
    await page.locator('.admin-pagination .btn-next').click()
    await expect(page.locator('.admin-list-row')).toHaveCount(1)
    const confirmDialog = (dialog: import('@playwright/test').Dialog) => dialog.accept()
    page.on('dialog', confirmDialog)
    await page.getByRole('button', { name: '删除工单', exact: true }).click()
    await expect(page.locator('.admin-list-row')).toHaveCount(10)
    await expect(page.locator('.admin-pagination')).toContainText('共 10 条工单')
    await page.getByRole('button', { name: '反馈处理', exact: true }).click()
    await expect(page.locator('.feedback-admin-row')).toHaveCount(10)
    await page.locator('.admin-pagination .btn-next').click()
    await expect(page.locator('.feedback-admin-row')).toHaveCount(1)
    await page.getByPlaceholder('搜索用户名、标题或内容').fill('分页反馈11')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.locator('.feedback-admin-row')).toContainText('分页反馈11')
    await expect(page.locator('.admin-pagination')).toContainText('共 1 条反馈')
    await page.getByRole('button', { name: '删除反馈', exact: true }).click()
    await expect(page.getByText('暂无反馈', { exact: true })).toBeVisible()
    page.off('dialog', confirmDialog)
  } finally { data.close() }
})
