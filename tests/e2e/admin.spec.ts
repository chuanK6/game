import { expect, test } from '@playwright/test'
import { Hono } from 'hono'
import admin from '../../worker/src/admin'
import { serializeUser } from '../../worker/src/auth'
import type { AppEnv } from '../../worker/src/types'

type UserRow = Parameters<typeof serializeUser>[0] & {
  status: 'active'
  member_started_at: string | null
  created_at: string
}

function userRow(id: number, username: string, memberType: UserRow['member_type'], expiry: string | null): UserRow {
  return { id, username, avatar_url: null, role: 'user', status: 'active', member_type: memberType,
    member_expire_at: expiry, member_started_at: null, created_at: '2026-01-01 00:00:00' }
}

// Exercise the real admin GET handler with stored database rows, without
// creating privileged accounts or modifying the local development database.
function adminFixture(rows: UserRow[]) {
  const operator = serializeUser({ ...userRow(999, '后台测试管理员', 'none', null), role: 'admin' })
  const app = new Hono<AppEnv>()
  app.use('*', async (context, next) => { context.set('user', operator); await next() })
  app.route('/admin', admin)
  const database = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) }
  const bindings = { DB: database } as unknown as AppEnv['Bindings']
  return { operator, list: () => app.request('/admin/users', {}, bindings) }
}

test('后台用户接口正确识别到期、无效、有效及终身会员，保留管理员角色', async () => {
  const rows = [
    userRow(1, '已到期', 'monthly', '2020-01-01 00:00:00'),
    userRow(2, '刚到期', 'monthly', new Date().toISOString()),
    userRow(3, '无到期时间', 'monthly', null),
    userRow(4, '无效时间', 'monthly', 'invalid-date'),
    userRow(5, '有效月度', 'monthly', '2099-01-01 00:00:00'),
    userRow(6, '带时区月度', 'monthly', '2099-01-01T08:00:00+08:00'),
    userRow(7, '终身', 'lifetime', null),
    userRow(8, '普通', 'none', null),
    { ...userRow(9, '会员已到期的管理员', 'monthly', '2020-01-01 00:00:00'), role: 'admin' as const },
  ]
  const response = await adminFixture(rows).list()
  expect(response.status).toBe(200)
  const payload = await response.json() as { data: UserRow[] }
  expect(payload.data.map((row) => row.member_type)).toEqual(['none', 'none', 'none', 'none', 'monthly', 'monthly', 'lifetime', 'none', 'none'])
  expect(payload.data[0]?.member_expire_at).toBe('2020-01-01 00:00:00')
  expect(payload.data[8]?.role).toBe('admin')
})

test('用户管理保存到期时间后显示普通用户，分类与标签可正常操作', async ({ page }, testInfo) => {
  const rows = [userRow(1, '过期用户', 'monthly', '2020-01-01 00:00:00'),
    userRow(2, '有效用户', 'monthly', '2099-01-01 00:00:00'), userRow(3, '终身用户', 'lifetime', null)]
  const fixture = adminFixture(rows)
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { ok: true, data: fixture.operator } }))
  await page.route('**/api/admin/overview', (route) => route.fulfill({ json: { ok: true, data: { users: 3, games: 0, pendingOrders: 0, openFeedback: 0 } } }))
  await page.route('**/api/admin/users', async (route) => {
    const response = await fixture.list()
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
  })
  await page.route('**/api/admin/users/2', async (route) => {
    const update = route.request().postDataJSON() as { memberType: UserRow['member_type']; memberExpireAt: string | null }
    rows[1]!.member_type = update.memberType
    rows[1]!.member_expire_at = update.memberExpireAt
    await route.fulfill({ json: { ok: true, data: null } })
  })
  await page.route('**/api/admin/categories', (route) => route.fulfill({ json: { ok: true, data: [{ id: 1, name: '模拟经营', slug: 'simulation', sort: 10, status: 'active' }] } }))
  await page.route('**/api/admin/tags', (route) => route.fulfill({ json: { ok: true, data: [{ id: 1, name: '休闲', slug: 'casual', sort: 0, status: 'active' }] } }))

  await page.goto('/admin')
  await page.getByRole('button', { name: '用户管理', exact: true }).click()
  const expired = page.getByRole('row').filter({ hasText: '过期用户' })
  const active = page.getByRole('row').filter({ hasText: '有效用户' })
  const lifetime = page.getByRole('row').filter({ hasText: '终身用户' })
  await expect(expired.getByRole('combobox').nth(2)).toHaveValue('none')
  await expect(active.getByRole('combobox').nth(2)).toHaveValue('monthly')
  await expect(lifetime.getByRole('combobox').nth(2)).toHaveValue('lifetime')
  await active.locator('input[type="datetime-local"]').fill('2020-01-01T08:00')
  await active.getByRole('button', { name: '保存', exact: true }).click()
  await expect(active.getByRole('combobox').nth(2)).toHaveValue('none')
  await expect(active.locator('input[type="datetime-local"]')).toHaveCount(0)
  await expect(lifetime.getByRole('combobox').nth(2)).toHaveValue('lifetime')

  await page.getByRole('button', { name: '分类与标签', exact: true }).click()
  await expect(page.locator('.taxonomy-table')).toHaveCount(2)
  await page.locator('.taxonomy-table').first().getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '编辑分类' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.locator('.taxonomy-table').last().getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '编辑标签' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.el-message')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('.admin-table-wrap').evaluateAll((tables) => tables.forEach((table) => { table.scrollLeft = table.scrollWidth }))
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: `test-results/admin-taxonomy-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' })
})
