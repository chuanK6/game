import { expect, test, type Page } from '@playwright/test'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { Hono } from 'hono'
import admin from '../../worker/src/admin'
import worker from '../../worker/src/index'
import type { AppEnv, AuthUser } from '../../worker/src/types'

function screenshotPng() {
  const width = 480, height = 270
  const pixels = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4
    pixels.set([30 + Math.round(x / 5), 100 + Math.round(y / 3), 170, 255], offset)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  function chunk(type: string, data: Buffer) {
    const payload = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(payload))
    return Buffer.concat([length, payload, checksum])
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
const png = screenshotPng()
const legacyText = '# 原来的标题\n星号 *保持原样*，路径 C:\\Games\\demo\n\n安装后即可开始游戏。'
const operator: AuthUser = { id: 99, username: '图片测试管理员', avatarUrl: null, role: 'admin', memberType: 'none', memberExpireAt: null, isMember: false }

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../../worker/migrations/0001_initial.sql', import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO categories (name, slug) VALUES ('动作', 'action')")
  sqlite.prepare("INSERT INTO games (name, slug, cover_url, description, min_config, category_id, resource_type, status) VALUES (?, ?, ?, ?, ?, 1, 'free', 'published')")
    .run('旧游戏', 'legacy-game', 'https://res.cloudinary.com/demo/image/upload/legacy.jpg', legacyText, '["操作系统：Windows 10"]')
  sqlite.exec(readFileSync(new URL('../../worker/migrations/0003_game_description_format.sql', import.meta.url), 'utf8'))
  function prepare(sql: string) {
    const statement = sqlite.prepare(sql)
    let values: SQLInputValue[] = []
    return {
      sql,
      bind(...bindings: SQLInputValue[]) { values = bindings; return this },
      async all() { return { results: statement.all(...values) } },
      async first() { return statement.get(...values) ?? null },
      async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } },
    }
  }
  const database = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => Promise.all(statements.map((statement) => /^\s*SELECT/i.test(statement.sql) ? statement.all() : statement.run())) }
  // A stream-based bucket double lets the real handlers run without production writes.
  const objects = new Map<string, { bytes: Uint8Array; httpMetadata: { contentType: string; cacheControl: string } }>()
  function getObject(key: string) {
    const object = objects.get(key)
    if (!object) return null
    return { size: object.bytes.length, httpEtag: '"image-etag"', body: new Blob([object.bytes]).stream(),
      writeHttpMetadata(headers: Headers) { headers.set('Content-Type', object.httpMetadata.contentType) } }
  }
  const bucket = {
    async put(key: string, body: BodyInit, options: { httpMetadata: { contentType: string; cacheControl: string } }) {
      objects.set(key, { bytes: new Uint8Array(await new Response(body).arrayBuffer()), httpMetadata: options.httpMetadata })
    },
    get: async (key: string) => getObject(key), head: async (key: string) => getObject(key),
  }
  const bindings = { DB: database, MEDIA: bucket, MEDIA_PUBLIC_URL: 'https://cdn.youlang.cc.cd', ALLOWED_ORIGIN: 'http://127.0.0.1:5173' } as unknown as AppEnv['Bindings']
  const adminApp = new Hono<AppEnv>()
  adminApp.use('*', async (context, next) => {
    const role = context.req.header('X-Test-Role')
    if (role !== 'anonymous') context.set('user', { ...operator, role: role === 'user' ? 'user' : 'admin' })
    await next()
  })
  adminApp.route('/api/admin', admin)
  return { bindings, adminApp, objects, sqlite, close: () => sqlite.close() }
}

function uploadForm(bytes = png, mime = 'image/png', purpose = 'content') {
  const body = new FormData()
  body.append('file', new File([bytes], 'screenshot.png', { type: mime }))
  body.append('purpose', purpose)
  return body
}

test('图片上传要求管理员，检查实际大小、用途、类型和文件签名', async () => {
  const f = fixture()
  try {
    for (const [role, status] of [['anonymous', 401], ['user', 403]] as const) {
      const response = await f.adminApp.request('/api/admin/uploads/images', { method: 'POST', body: uploadForm(), headers: { 'X-Test-Role': role } }, f.bindings)
      expect(response.status).toBe(status)
    }
    for (const [body, status] of [
      [uploadForm(Buffer.from('<script>alert(1)</script>')), 415],
      [uploadForm(png, 'image/jpeg'), 415],
      [uploadForm(Buffer.alloc(0)), 400],
      [uploadForm(png, 'image/png', '../private'), 400],
      [uploadForm(Buffer.alloc(5 * 1024 * 1024 + 1)), 413],
      [uploadForm(Buffer.alloc(6 * 1024 * 1024)), 413],
    ] as const) {
      // Buffer the generated multipart body, as a network peer would, so early
      // cancellation does not hit Node's FormData producer after it closes.
      const request = new Request('http://localhost/api/admin/uploads/images', { method: 'POST', body })
      const response = await f.adminApp.request(request.url, { method: 'POST', body: await request.arrayBuffer(), headers: request.headers }, f.bindings)
      expect(response.status).toBe(status)
    }
    expect(f.objects.size).toBe(0)
    const response = await f.adminApp.request('https://site.example/api/admin/uploads/images', { method: 'POST', body: uploadForm() }, f.bindings)
    expect(response.status).toBe(201)
    const { data } = await response.json()
    expect(data.url).toBe(`https://cdn.youlang.cc.cd/${data.key}`)
    expect(data.key).toMatch(/^images\/content\/\d{4}\/\d{2}\/.+\.png$/)
    expect(f.objects.get(data.key)?.bytes).toEqual(new Uint8Array(png))
    const local = await f.adminApp.request('http://127.0.0.1/api/admin/uploads/images', { method: 'POST', body: uploadForm(png, 'image/png', 'cover') }, f.bindings)
    expect((await local.json()).data.url).toMatch(/^\/api\/media\/images\/cover\//)
  } finally { f.close() }
})

test('公开图片支持读取、HEAD、缓存与404，携带登录 Cookie 也不访问 D1', async () => {
  const f = fixture()
  try {
    const uploaded = await f.adminApp.request('/api/admin/uploads/images', { method: 'POST', body: uploadForm() }, f.bindings)
    const { data } = await uploaded.json()
    const bindings = { ...f.bindings, DB: { prepare() { throw new Error('Image must not query D1') } } } as unknown as AppEnv['Bindings']
    const path = `/api/media/${data.key}`
    const response = await worker.request(path, { headers: { Cookie: 'youlun_session=example' } }, bindings)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toContain('immutable')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(png))
    const head = await worker.request(path, { method: 'HEAD' }, bindings)
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const cached = await worker.request(path, { headers: { 'If-None-Match': 'W/"image-etag"' } }, bindings)
    expect(cached.status).toBe(304)
    expect((await worker.request('/api/media/private/file.png', {}, bindings)).status).toBe(404)
    expect((await worker.request(path.replace(/[^/]+$/, '00000000-0000-0000-0000-000000000000.png'), {}, bindings)).status).toBe(404)
  } finally { f.close() }
})

test('迁移兼容旧介绍与封面，新 Markdown 可保存和编辑，列表不携带正文和下载地址', async () => {
  const f = fixture()
  try {
    const legacy = await worker.request('/api/games/legacy-game', {}, f.bindings)
    expect((await legacy.json()).data).toMatchObject({ description: legacyText, descriptionFormat: 'plain', cover: 'https://res.cloudinary.com/demo/image/upload/legacy.jpg' })
    const payload = { name: '新游戏', slug: 'new-game', coverUrl: 'https://cdn.youlang.cc.cd/cover.png', description: '## 游戏介绍\n\n新的图文内容，支持图片展示。', descriptionFormat: 'markdown', minConfig: ['内存：8GB'], categoryId: 1, resourceType: 'member', resourceStatus: 'available', status: 'published', publishAt: null, tagIds: [], downloads: [{ provider: '网盘', label: '下载', url: 'https://private.example/download', sort: 0 }] }
    const create = await f.adminApp.request('/api/admin/games', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }, f.bindings)
    expect(create.status).toBe(201)
    const id = (await create.json()).data.id
    const detail = await worker.request('/api/games/new-game', {}, f.bindings)
    const game = (await detail.json()).data
    expect(game).toMatchObject({ descriptionFormat: 'markdown', description: payload.description })
    expect(JSON.stringify(game)).not.toContain('private.example')
    // Older clients omit the new field: edits retain the stored format.
    const { descriptionFormat: _, ...oldClientPayload } = payload
    const update = await f.adminApp.request(`/api/admin/games/${id}`, { method: 'PUT', body: JSON.stringify({ ...oldClientPayload, description: '保留原有格式的兼容性编辑，长度超过十字符。' }), headers: { 'Content-Type': 'application/json' } }, f.bindings)
    expect(update.status).toBe(200)
    expect(f.sqlite.prepare('SELECT description_format FROM games WHERE id = ?').get(id)?.description_format).toBe('markdown')
    const list = await worker.request('/api/games', {}, f.bindings)
    const data = (await list.json()).data
    expect(data).toHaveLength(2)
    expect(data.every((item: object) => !('description' in item) && !('minConfig' in item))).toBe(true)
    expect(JSON.stringify(data)).not.toContain('private.example')
  } finally { f.close() }
})

async function routeFixture(page: Page, f: ReturnType<typeof fixture>) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (!path.startsWith('/api/')) return route.fallback()
    if (path === '/api/auth/me') return route.fulfill({ json: { ok: true, data: operator } })
    if (path === '/api/admin/overview') return route.fulfill({ json: { ok: true, data: { users: 0, games: 1, pendingOrders: 0, openFeedback: 0 } } })
    const app = path.startsWith('/api/admin') ? f.adminApp : worker
    const response = await app.request(request.url(), { method: request.method(), headers: request.headers(), body: request.postDataBuffer() ?? undefined }, f.bindings)
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
  await page.route('https://res.cloudinary.com/**', (route) => route.fulfill({ contentType: 'image/png', body: png }))
}

test('后台转换旧介绍、上传插图、保存并重新编辑，支持全屏和手机预览', async ({ page }, testInfo) => {
  const f = fixture()
  const warnings: string[] = []
  page.on('pageerror', (error) => warnings.push(error.message))
  page.on('console', (message) => { if (message.text().includes('[Vue warn]')) warnings.push(message.text()) })
  try {
    await routeFixture(page, f)
    await page.goto('/admin')
    await page.getByRole('button', { name: '游戏资源', exact: true }).click()
    await page.getByRole('row').filter({ hasText: '旧游戏' }).getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('tab', { name: /游戏介绍/ }).click()
    await expect(page.getByLabel('游戏介绍（纯文本）')).toHaveValue(legacyText)
    await page.getByRole('button', { name: '转换为 Markdown', exact: true }).click()
    const conversion = page.getByRole('dialog', { name: '转换介绍预览', exact: true })
    await expect(conversion.locator('.markdown-content')).toContainText('# 原来的标题')
    await expect(conversion.locator('.markdown-content')).toContainText('星号 *保持原样*，路径 C:\\Games\\demo')
    await expect(conversion.locator('h1, strong')).toHaveCount(0)
    await page.getByRole('button', { name: '使用 Markdown', exact: true }).click()
    const source = page.getByRole('textbox', { name: '游戏介绍 Markdown' })
    await expect(source).toBeVisible()
    await source.fill('## 游戏特色\n\n可以探索世界并建造自己的基地。')
    await source.press('Control+End')
    await page.getByLabel('上传介绍图片', { exact: true }).setInputFiles({ name: '基地截图.png', mimeType: 'image/png', buffer: png })
    await expect(source).toHaveValue(/!\[基地截图\]\(\/api\/media\/images\/content\//)
    await page.getByRole('button', { name: '全屏编辑', exact: true }).click()
    const full = page.locator('.markdown-editor.is-fullscreen')
    await expect(full).toBeVisible()
    await page.getByRole('button', { name: '预览', exact: true }).click()
    await expect(full.locator('.markdown-content h2')).toHaveText('游戏特色')
    await expect(full.locator('.markdown-content img')).toBeVisible()
    const box = await full.boundingBox()
    expect(box!.height).toBeGreaterThan((page.viewportSize()?.height ?? 0) * 0.85)
    await page.screenshot({ path: `test-results/markdown-editor-${testInfo.project.name}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: '退出全屏编辑', exact: true }).click()
    await page.getByRole('button', { name: '保存游戏', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '编辑游戏', exact: true })).toBeHidden()
    await page.getByRole('row').filter({ hasText: '旧游戏' }).getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('tab', { name: /游戏介绍/ }).click()
    await expect(source).toHaveValue(/## 游戏特色/)
    await expect(source).toHaveValue(/images\/content/)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.goto('/games/legacy-game')
    await expect(page.locator('.detail-introduction .markdown-content h2')).toHaveText('游戏特色')
    await page.locator('.detail-introduction .markdown-content img').click()
    await expect(page.getByRole('dialog', { name: '基地截图', exact: true })).toBeVisible()
    await page.getByRole('dialog', { name: '基地截图', exact: true }).getByRole('button', { name: 'Close this dialog' }).click()
    await expect(page.getByRole('dialog', { name: '基地截图', exact: true })).toBeHidden()
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `test-results/markdown-detail-dark-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' })
    expect(warnings).toEqual([])
  } finally { f.close() }
})

test('Markdown 拦截脚本、HTML、危险链接及 SVG 图片，旧介绍仍按纯文本显示', async ({ page }) => {
  const f = fixture()
  try {
    await routeFixture(page, f)
    await page.goto('/games/legacy-game')
    await expect(page.locator('.description')).toHaveText(legacyText)
    await expect(page.locator('.detail-introduction h1')).toHaveCount(0)
    const malicious = '## 安全介绍\n\n<script>window.markdownXss=1</script>\n<img src=x onerror="window.markdownXss=2">\n\n[危险](javascript:alert(1))\n![SVG](data:image/svg+xml;base64,PHN2Zz4=)\n\n[官网](https://example.com)\n\n| 项目 | 配置 |\n| --- | --- |\n| 内存 | 8GB |'
    f.sqlite.prepare("UPDATE games SET description = ?, description_format = 'markdown'").run(malicious)
    await page.reload()
    const content = page.locator('.detail-introduction .markdown-content')
    await expect(content.getByRole('heading', { name: '安全介绍' })).toBeVisible()
    await expect(content.locator('script, iframe, img, [onerror], a[href^="javascript:"]')).toHaveCount(0)
    await expect(content.getByRole('link', { name: '官网' })).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(content.locator('table')).toContainText('8GB')
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).markdownXss)).toBeUndefined()
  } finally { f.close() }
})

test('新游戏默认 Markdown，封面上传、粘贴重试、拖拽插图可保存，上传中禁止保存', async ({ page }) => {
  const f = fixture()
  let releaseUpload: (() => void) | undefined
  try {
    await routeFixture(page, f)
    await page.goto('/admin')
    await page.getByRole('button', { name: '游戏资源', exact: true }).click()
    await page.getByRole('button', { name: '新增游戏', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新增游戏', exact: true })
    const source = dialog.getByRole('textbox', { name: '游戏介绍 Markdown' })
    await expect(source).toBeHidden()
    await dialog.locator('#game-name').fill('图文新游戏')
    await dialog.locator('#game-slug').fill('markdown-new-game')
    await dialog.locator('#game-category').selectOption('1')
    await dialog.getByLabel('选择封面文件').setInputFiles({ name: '封面.png', mimeType: 'image/png', buffer: png })
    await expect(dialog.locator('#game-cover')).toHaveValue(/^\/api\/media\/images\/cover\//)
    await dialog.getByRole('tab', { name: /最低配置/ }).click()
    await dialog.getByLabel('操作系统', { exact: true }).fill('Windows 10')
    await dialog.getByRole('tab', { name: /游戏介绍/ }).click()
    await source.fill('## 新游戏介绍\n\n可以一起探索和建造。')
    await source.press('Control+End')
    let attempts = 0
    const gate = new Promise<void>((resolve) => { releaseUpload = resolve })
    await page.route('**/api/admin/uploads/images', async (route) => {
      attempts++
      if (attempts === 1) return route.fulfill({ status: 503, json: { ok: false, error: { code: 'UNAVAILABLE', message: '上传暂时失败，请重试' } } })
      if (attempts === 2) await gate
      return route.fallback()
    })
    await source.evaluate((element, base64) => {
      const data = new DataTransfer()
      data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], '粘贴截图.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, png.toString('base64'))
    await expect(dialog.getByRole('alert')).toContainText('上传暂时失败')
    await expect(source).not.toHaveValue(/!\[/)
    await dialog.getByRole('button', { name: '重试失败图片' }).click()
    await expect(dialog.getByRole('button', { name: '保存游戏' })).toBeDisabled()
    await expect(source).toHaveAttribute('readonly', '')
    await dialog.getByRole('tab', { name: /基础信息/ }).click()
    await expect(dialog.getByRole('button', { name: '保存游戏' })).toBeDisabled()
    releaseUpload!()
    await expect(dialog.locator('.markdown-source')).toHaveValue(/!\[粘贴截图\]/)
    await dialog.getByRole('tab', { name: /游戏介绍/ }).click()
    await source.evaluate((element, base64) => {
      const data = new DataTransfer()
      data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], '拖拽截图.png', { type: 'image/png' }))
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
    }, png.toString('base64'))
    await expect(source).toHaveValue(/!\[拖拽截图\]/)
    await dialog.getByRole('button', { name: '保存游戏' }).click()
    await expect(dialog).toBeHidden()
    const row = f.sqlite.prepare('SELECT cover_url, description, description_format FROM games WHERE slug = ?').get('markdown-new-game')!
    expect(row.description_format).toBe('markdown')
    expect(row.cover_url).toMatch(/^\/api\/media\/images\/cover\//)
    expect(row.description).toContain('![粘贴截图]')
    expect(row.description).toContain('![拖拽截图]')
  } finally { releaseUpload?.(); await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); f.close() }
})

test('关闭上传中的表单后，迟到的图片不会写入下一款游戏', async ({ page }) => {
  const f = fixture()
  let releaseUpload: (() => void) | undefined
  try {
    await routeFixture(page, f)
    const gate = new Promise<void>((resolve) => { releaseUpload = resolve })
    await page.route('**/api/admin/uploads/images', async (route) => {
      await gate
      await route.fulfill({ status: 201, json: { ok: true, data: { key: 'old-image', url: 'https://cdn.youlang.cc.cd/old-image.png' } } }).catch(() => {})
    })
    await page.goto('/admin')
    await page.getByRole('button', { name: '游戏资源', exact: true }).click()
    await page.getByRole('button', { name: '新增游戏', exact: true }).click()
    const source = page.getByRole('textbox', { name: '游戏介绍 Markdown' })
    await page.getByRole('tab', { name: /游戏介绍/ }).click()
    await source.fill('第一款游戏的介绍，上传时关闭表单。')
    await page.getByLabel('上传介绍图片', { exact: true }).setInputFiles({ name: '旧截图.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByRole('button', { name: '保存游戏' })).toBeDisabled()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '新增游戏', exact: true })).toBeHidden()
    await page.getByRole('button', { name: '新增游戏', exact: true }).click()
    await page.getByRole('tab', { name: /游戏介绍/ }).click()
    await source.fill('第二款游戏的介绍应当完整保留。')
    releaseUpload!()
    await expect(source).toHaveValue('第二款游戏的介绍应当完整保留。')
    await expect(page.getByRole('button', { name: '保存游戏' })).toBeEnabled()
  } finally { releaseUpload?.(); await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); f.close() }
})

function seedCatalog(f: ReturnType<typeof fixture>, count = 75) {
  f.sqlite.exec("INSERT INTO categories (name, slug) VALUES ('冒险', 'adventure')")
  const insert = f.sqlite.prepare('INSERT INTO games (name, slug, cover_url, description, category_id, resource_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (let i = 1; i <= count; i++) insert.run(`测试游戏 ${i}`, `catalog-${i}`, '/assets/brand/logo.png', '用于验证组合筛选和分页的游戏介绍。', i % 2 + 1, i % 3 ? 'free' : 'member', i % 4 ? 'published' : 'draft')
}

test('管理游戏组合筛选和分页一致，页码越界自动回退，非法条件被拒绝', async () => {
  const f = fixture()
  try {
    seedCatalog(f)
    const filtered = await f.adminApp.request('/api/admin/games?q=测试游戏&categoryId=2&resourceType=member&status=published&page=1', {}, f.bindings)
    expect(filtered.status).toBe(200)
    const { data } = await filtered.json()
    expect(data.pagination.total).toBe(13)
    expect(data.games).toHaveLength(10)
    expect(data.games.every((game: { category: string; resource_type: string; status: string }) => game.category === '冒险' && game.resource_type === 'member' && game.status === 'published')).toBe(true)
    const tail = await f.adminApp.request('/api/admin/games?q=测试游戏&categoryId=2&resourceType=member&status=published&page=999', {}, f.bindings)
    const finalPage = (await tail.json()).data
    expect(finalPage.pagination.page).toBe(2)
    expect(finalPage.games).toHaveLength(3)
    for (const game of finalPage.games) f.sqlite.prepare('UPDATE games SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(game.id)
    const afterDelete = await f.adminApp.request('/api/admin/games?q=测试游戏&categoryId=2&resourceType=member&status=published&page=2', {}, f.bindings)
    expect((await afterDelete.json()).data.pagination).toMatchObject({ page: 1, total: 10 })
    for (const query of ['categoryId=0', 'page=100001', 'page=1.5', 'resourceType=invalid', 'status=deleted']) expect((await f.adminApp.request(`/api/admin/games?${query}`, {}, f.bindings)).status).toBe(400)
  } finally { f.close() }
})

test('编辑页签定位首个错误，支持封面拖拽、胶囊标签和下载行校验', async ({ page }, testInfo) => {
  const f = fixture()
  try {
    f.sqlite.exec("INSERT INTO tags (name, slug) VALUES ('开放世界', 'open-world'), ('多人合作', 'coop')")
    await routeFixture(page, f)
    await page.goto('/admin')
    await page.getByRole('button', { name: '游戏资源', exact: true }).click()
    await page.screenshot({ path: `.wrangler/admin-games-${testInfo.project.name}.png`, fullPage: true })
    await page.getByRole('button', { name: '新增游戏', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新增游戏', exact: true })
    await expect(dialog.locator('.tab-error-dot')).toHaveCount(0)
    await dialog.getByRole('tab', { name: /标签与下载/ }).click()
    await expect(dialog.locator('.download-source-editor')).toHaveCount(1)
    await dialog.getByRole('button', { name: '保存游戏', exact: true }).click()
    await expect(dialog.locator('#game-name')).toBeFocused()
    await expect(dialog.locator('.tab-error-dot')).toHaveCount(3)
    await expect(dialog.getByRole('tab', { name: /基础信息/ })).toHaveAttribute('aria-selected', 'true')
    await dialog.locator('#game-name').fill('新的开放世界')
    await dialog.locator('#game-slug').fill('new-open-world')
    await dialog.locator('#game-category').selectOption('1')
    await dialog.locator('.cover-dropzone').evaluate((element, base64) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'cover.png', { type: 'image/png' }))
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    }, png.toString('base64'))
    await expect(dialog.locator('#game-cover')).toHaveValue(/\/images\/cover\//)
    await expect(dialog.locator('.cover-dropzone img')).toBeVisible()
    await page.screenshot({ path: `.wrangler/admin-basic-${testInfo.project.name}.png`, animations: 'disabled' })
    await dialog.getByRole('button', { name: '保存游戏', exact: true }).click()
    const markdown = dialog.getByRole('textbox', { name: '游戏介绍 Markdown' })
    await expect(markdown).toBeFocused()
    await markdown.fill('## 开放世界\n\n探索自由的地图，和朋友一起建造家园。')
    await page.screenshot({ path: `.wrangler/admin-introduction-${testInfo.project.name}.png`, animations: 'disabled' })
    await dialog.getByRole('button', { name: '保存游戏', exact: true }).click()
    await expect(dialog.locator('#config-os')).toBeFocused()
    await dialog.locator('#config-os').fill('Windows 10')
    await dialog.getByRole('tab', { name: /标签与下载/ }).click()
    const tag = dialog.getByRole('checkbox', { name: '开放世界', exact: true })
    await tag.click()
    await expect(tag).toBeChecked()
    await dialog.getByLabel('下载链接', { exact: false }).fill('javascript:alert(1)')
    await dialog.getByRole('button', { name: '保存游戏', exact: true }).click()
    await expect(dialog.locator('[id^="provider-"]')).toBeFocused()
    await dialog.locator('[id^="provider-"]').fill('夸克网盘')
    await dialog.locator('[id^="label-"]').fill('中文版')
    await dialog.getByRole('button', { name: '保存游戏', exact: true }).click()
    await expect(dialog.locator('[id^="url-"]')).toBeFocused()
    const titleBounds = await dialog.locator('.editor-title').boundingBox()
    expect(titleBounds!.y).toBeGreaterThanOrEqual(0)
    await expect(dialog.getByRole('button', { name: '保存游戏', exact: true })).toBeInViewport()
    await dialog.locator('[id^="url-"]').fill('https://example.com/download')
    await expect(dialog.locator('.tab-error-dot')).toHaveCount(0)
    await page.screenshot({ path: `.wrangler/admin-downloads-${testInfo.project.name}.png`, animations: 'disabled' })
    await dialog.getByRole('button', { name: '保存游戏', exact: true }).click()
    await expect(dialog).toBeHidden()
    const saved = f.sqlite.prepare("SELECT id FROM games WHERE slug = 'new-open-world'").get()!
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM game_downloads WHERE game_id = ?').get(saved.id)?.n).toBe(1)
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM game_tags WHERE game_id = ?').get(saved.id)?.n).toBe(1)
    await page.getByRole('button', { name: '切换到夜间模式' }).click()
    await page.screenshot({ path: `.wrangler/admin-dark-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  } finally { await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); f.close() }
})

test('游戏列表缓存至多六页且定时过期，筛选重置页码并丢弃迟到响应', async ({ page }) => {
  const f = fixture()
  let releaseSlow: (() => void) | undefined
  try {
    seedCatalog(f)
    await routeFixture(page, f)
    const counts = new Map<number, number>()
    const gate = new Promise<void>(resolve => { releaseSlow = resolve })
    await page.route('**/api/admin/games?*', async route => {
      const url = new URL(route.request().url())
      const pageNumber = Number(url.searchParams.get('page') || 1)
      counts.set(pageNumber, (counts.get(pageNumber) ?? 0) + 1)
      if (url.searchParams.get('q') === 'slow-search') {
        await gate
        await route.fulfill({ json: { ok: true, data: { games: [], pagination: { page: 1, pageSize: 10, total: 0 } } } }).catch(() => {})
      } else await route.fallback()
    })
    await page.goto('/admin')
    await page.getByRole('button', { name: '游戏资源', exact: true }).click()
    await expect(page.locator('.game-list-table tbody tr')).toHaveCount(10)
    for (let p = 2; p <= 8; p++) {
      await page.locator('.admin-pagination .btn-next').click()
      await expect(page.locator('.admin-pagination .el-pager .is-active')).toHaveText(String(p))
      await expect(page.locator('.game-list-surface [aria-busy]')).toHaveAttribute('aria-busy', 'false')
    }
    await page.locator('.admin-pagination .btn-prev').click()
    await page.locator('.admin-pagination .btn-prev').click()
    await expect(page.locator('.admin-pagination .el-pager .is-active')).toHaveText('6')
    expect(counts.get(6)).toBe(1)
    await page.locator('.admin-pagination').getByRole('listitem', { name: 'page 1', exact: true }).click()
    await expect(page.locator('.game-list-surface [aria-busy]')).toHaveAttribute('aria-busy', 'false')
    expect(counts.get(1)).toBe(2)
    await page.clock.install()
    await page.clock.fastForward(31000)
    await page.locator('.admin-pagination .btn-next').click()
    await expect(page.locator('.game-list-surface [aria-busy]')).toHaveAttribute('aria-busy', 'false')
    expect(counts.get(2)).toBe(2)
    await page.locator('.admin-pagination .btn-prev').click()
    await expect(page.locator('.game-list-surface [aria-busy]')).toHaveAttribute('aria-busy', 'false')
    expect(counts.get(1)).toBe(3)
    await page.getByRole('textbox', { name: '搜索游戏', exact: true }).fill('slow-search')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索游戏', exact: true }).fill('测试游戏')
    await page.locator('.admin-filter select').nth(1).selectOption('member')
    await expect(page.locator('.admin-pagination')).toContainText('共 25 个游戏')
    releaseSlow!()
    await expect(page.locator('.game-list-table tbody tr')).toHaveCount(10)
    await expect(page.locator('.admin-pagination .el-pager .is-active')).toHaveText('1')
    await page.getByRole('button', { name: '重置', exact: true }).click()
    await expect(page.locator('.admin-pagination')).toContainText('共 76 个游戏')
  } finally { releaseSlow?.(); await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); f.close() }
})
