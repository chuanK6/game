import { expect, test, type Page } from '@playwright/test'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import worker from '../../worker/src/index'
import { hashPassword } from '../../worker/src/auth'
import type { AppEnv } from '../../worker/src/types'

async function authFixture() {
  const database = new DatabaseSync(':memory:')
  for (const name of ['0001_initial.sql', '0002_auth_attempts.sql', '0003_game_description_format.sql']) {
    database.exec(readFileSync(new URL(`../../worker/migrations/${name}`, import.meta.url), 'utf8'))
  }
  database.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
    .run('session_admin', await hashPassword('Session123456'))
  function prepare(sql: string) {
    const statement = database.prepare(sql)
    let values: SQLInputValue[] = []
    return {
      sql,
      bind(...bindings: SQLInputValue[]) { values = bindings; return this },
      async all() { return { results: statement.all(...values) } },
      async first() { return statement.get(...values) ?? null },
      async run() {
        const result = statement.run(...values)
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    }
  }
  const bindings = {
    DB: { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => Promise.all(statements.map(statement => /^\s*SELECT/i.test(statement.sql) ? statement.all() : statement.run())) },
    APP_ENV: 'test', ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
  } as unknown as AppEnv['Bindings']
  return { bindings, close: () => database.close() }
}

async function login(page: Page) {
  await page.getByLabel('用户名').fill('session_admin')
  await page.getByLabel('密码', { exact: true }).fill('Session123456')
  await page.locator('.auth-submit').click()
}

test('过期会话响应晚于登录返回时不清除新 Cookie，个人中心和后台刷新后仍可使用', async ({ page, context }) => {
  const fixture = await authFixture()
  let releaseOldResponse!: () => void
  const oldResponseGate = new Promise<void>(resolve => { releaseOldResponse = resolve })
  let oldRequestReady!: () => void
  const oldRequestStarted = new Promise<void>(resolve => { oldRequestReady = resolve })
  try {
    await context.addCookies([{ name: 'youlun_session', value: 'expired-token', url: 'http://127.0.0.1:5173' }])
    await page.route('**/api/**', async route => {
      const request = route.request()
      if (!new URL(request.url()).pathname.startsWith('/api/')) return route.fallback()
      const response = await worker.request(request.url(), {
        method: request.method(), headers: await request.allHeaders(), body: request.postDataBuffer() ?? undefined,
      }, fixture.bindings)
      if (new URL(request.url()).pathname === '/api/health') {
        oldRequestReady()
        await oldResponseGate
      }
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() })
    })
    await page.goto('/')
    await page.evaluate(() => {
      void fetch('/api/health', { credentials: 'include' }).then(() => { document.documentElement.dataset.oldSessionResponse = 'done' })
    })
    await oldRequestStarted
    await page.locator('.header-actions a[href="/auth"]').click()
    await login(page)
    await expect(page).toHaveURL('http://127.0.0.1:5173/')
    releaseOldResponse()
    await expect(page.locator('html')).toHaveAttribute('data-old-session-response', 'done')
    const cookie = (await context.cookies()).find(cookie => cookie.name === 'youlun_session')
    expect(cookie?.value).toBeTruthy()
    expect(cookie?.value).not.toBe('expired-token')
    expect(cookie?.httpOnly).toBe(true)
    await page.getByRole('link', { name: '进入个人中心' }).click()
    await expect(page.locator('.profile-user')).toContainText('session_admin')
    await expect(page.locator('.el-message--error')).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.profile-user')).toContainText('session_admin')
    await page.goto('/admin')
    await expect(page.locator('.admin-toolbar h1')).toBeVisible()
    await expect(page.locator('.el-message--error')).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.admin-toolbar h1')).toBeVisible()
    await expect(page.locator('.el-message--error')).toHaveCount(0)
  } finally {
    releaseOldResponse()
    await page.unrouteAll({ behavior: 'wait' }).catch(() => {})
    fixture.close()
  }
})

test('浏览器拒绝保存 Cookie 时停留登录页并提示原因，不显示已登录头像', async ({ page }) => {
  const fixture = await authFixture()
  try {
    await page.route('**/api/**', async route => {
      const request = route.request()
      if (!new URL(request.url()).pathname.startsWith('/api/')) return route.fallback()
      const response = await worker.request(request.url(), {
        method: request.method(), headers: await request.allHeaders(), body: request.postDataBuffer() ?? undefined,
      }, fixture.bindings)
      const headers = Object.fromEntries(response.headers)
      delete headers['set-cookie']
      await route.fulfill({ status: response.status, headers, body: await response.text() })
    })
    await page.goto('/auth')
    await login(page)
    await expect(page.getByText('登录会话未能保存，请允许此网站使用 Cookie 后重试。')).toBeVisible()
    await expect(page).toHaveURL(/\/auth$/)
    await expect(page.getByRole('link', { name: '进入个人中心' })).toHaveCount(0)
    await expect(page.getByText('欢迎回来', { exact: true })).toHaveCount(0)
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); fixture.close() }
})

test('身份及受保护接口禁止缓存，失效会话不返回清 Cookie，HTTPS 登录保持安全 Cookie', async () => {
  const fixture = await authFixture()
  try {
    const login = await worker.request('https://youlang.cc.cd/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://youlang.cc.cd' },
      body: JSON.stringify({ username: 'session_admin', password: 'Session123456' }),
    }, fixture.bindings)
    expect(login.status).toBe(200)
    const cookie = login.headers.get('Set-Cookie')!
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(cookie).toContain(attribute)
    for (const path of ['/auth/me', '/membership/orders', '/admin/overview']) {
      const valid = await worker.request(`https://youlang.cc.cd/api${path}`, { headers: { Cookie: cookie.split(';')[0]! } }, fixture.bindings)
      expect(valid.status).toBe(200)
      expect(valid.headers.get('Cache-Control')).toBe('no-store')
      const stale = await worker.request(`https://youlang.cc.cd/api${path}`, { headers: { Cookie: 'youlun_session=expired-token' } }, fixture.bindings)
      expect(stale.status).toBe(path === '/auth/me' ? 200 : 401)
      expect(stale.headers.get('Set-Cookie')).toBeNull()
      expect(stale.headers.get('Cache-Control')).toBe('no-store')
    }
    const logout = await worker.request('https://youlang.cc.cd/api/auth/logout', {
      method: 'POST', headers: { Cookie: cookie.split(';')[0]!, Origin: 'https://youlang.cc.cd' },
    }, fixture.bindings)
    expect(logout.status).toBe(200)
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0')
    const afterLogout = await worker.request('https://youlang.cc.cd/api/admin/overview', { headers: { Cookie: cookie.split(';')[0]! } }, fixture.bindings)
    expect(afterLogout.status).toBe(401)
  } finally { fixture.close() }
})
