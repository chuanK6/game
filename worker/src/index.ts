import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import { clearSession, createSession, hashPassword, readSession, serializeUser, sha256, verifyPassword } from './auth'
import admin from './admin'
import type { AppEnv } from './types'

type GameRow = {
  id: number
  slug: string
  name: string
  cover_url: string
  description: string
  min_config: string
  resource_type: 'free' | 'member'
  resource_status: 'available' | 'checking' | 'unavailable'
  publish_at: string
  category: string
  category_slug: string
  tag_pairs: string | null
}

type LoginUserRow = {
  id: number
  username: string
  password_hash: string
  avatar_url: string | null
  role: 'user' | 'admin'
  status: 'active' | 'disabled'
  member_type: 'none' | 'monthly' | 'lifetime'
  member_expire_at: string | null
}

const app = new Hono<AppEnv>().basePath('/api')

app.use('*', secureHeaders())
app.use('*', async (context, next) => {
  const middleware = cors({
    origin: context.env.ALLOWED_ORIGIN,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
  })
  return middleware(context, next)
})
app.use('*', async (context, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(context.req.method)) {
    const origin = context.req.header('Origin')
    const requestOrigin = new URL(context.req.url).origin
    const localDevelopment = origin && isLoopbackOrigin(origin) && isLoopbackOrigin(requestOrigin)
    if (origin && origin !== context.env.ALLOWED_ORIGIN && origin !== requestOrigin && !localDevelopment) {
      return fail(context, 403, 'INVALID_ORIGIN', '请求来源无效。')
    }
  }
  await next()
})
app.use('*', async (context, next) => {
  const session = await readSession(context)
  if (session) {
    context.set('user', session.user)
    context.set('sessionTokenHash', session.tokenHash)
  }
  await next()
})

app.onError((error, context) => {
  console.error('unhandled_api_error', { message: error.message, path: context.req.path })
  return fail(context, 500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试。')
})

const requireAuth = createMiddleware<AppEnv>(async (context, next) => {
  if (!context.get('user')) return fail(context, 401, 'AUTH_REQUIRED', '请先登录。')
  await next()
})

app.get('/health', (context) => context.json({ ok: true, data: { service: 'youlun-api', environment: context.env.APP_ENV } }))

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N}_]+$/u),
  password: z.string().min(8).max(72),
})

app.post('/auth/register', async (context) => {
  const parsed = await parseJson(context, credentialsSchema)
  if (!parsed.success) return parsed.response

  const { username, password } = parsed.data
  if (!/[\p{L}]/u.test(password) || !/\d/u.test(password)) {
    return fail(context, 400, 'WEAK_PASSWORD', '密码至少需要包含一个字母和一个数字。')
  }

  try {
    const result = await context.env.DB.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    ).bind(username, await hashPassword(password)).run()
    const userId = Number(result.meta.last_row_id)
    await createSession(context, userId)

    const row = await findUserById(context.env.DB, userId)
    console.log('user_registered', { userId })
    return context.json({ ok: true, data: serializeUser(row!) }, 201)
  } catch (error) {
    if (String(error).includes('UNIQUE')) return fail(context, 409, 'USERNAME_TAKEN', '该用户名已被使用。')
    throw error
  }
})

app.post('/auth/login', async (context) => {
  const parsed = await parseJson(context, credentialsSchema)
  if (!parsed.success) return parsed.response

  const { username, password } = parsed.data
  const clientKey = await sha256(`${context.req.header('CF-Connecting-IP') ?? 'local'}:${username.toLocaleLowerCase()}`)
  const recentAttempts = await context.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM auth_attempts WHERE key_hash = ? AND datetime(attempted_at) > datetime('now', '-15 minutes')",
  ).bind(clientKey).first<{ total: number }>()
  if ((recentAttempts?.total ?? 0) >= 8) {
    return fail(context, 429, 'TOO_MANY_ATTEMPTS', '登录尝试过于频繁，请 15 分钟后再试。')
  }

  const row = await context.env.DB.prepare(`
    SELECT id, username, password_hash, avatar_url, role, status, member_type, member_expire_at
    FROM users WHERE username = ? COLLATE NOCASE AND deleted_at IS NULL
  `).bind(username).first<LoginUserRow>()

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    await context.env.DB.prepare('INSERT INTO auth_attempts (key_hash) VALUES (?)').bind(clientKey).run()
    return fail(context, 401, 'INVALID_CREDENTIALS', '用户名或密码错误。')
  }
  if (row.status !== 'active') return fail(context, 403, 'ACCOUNT_DISABLED', '该账号已被禁用。')

  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM auth_attempts WHERE key_hash = ?').bind(clientKey),
    context.env.DB.prepare("DELETE FROM sessions WHERE datetime(expire_at) <= datetime('now')"),
  ])
  await createSession(context, row.id)
  console.log('user_logged_in', { userId: row.id })
  return context.json({ ok: true, data: serializeUser(row) })
})

app.post('/auth/logout', requireAuth, async (context) => {
  await clearSession(context)
  return context.json({ ok: true, data: null })
})

app.get('/auth/me', (context) => context.json({ ok: true, data: context.get('user') ?? null }))

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(8).max(72),
})

app.patch('/auth/password', requireAuth, async (context) => {
  const parsed = await parseJson(context, passwordSchema)
  if (!parsed.success) return parsed.response
  if (!/[\p{L}]/u.test(parsed.data.newPassword) || !/\d/u.test(parsed.data.newPassword)) {
    return fail(context, 400, 'WEAK_PASSWORD', '新密码至少需要包含一个字母和一个数字。')
  }

  const user = context.get('user')
  const row = await context.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>()
  if (!row || !(await verifyPassword(parsed.data.currentPassword, row.password_hash))) {
    return fail(context, 400, 'INVALID_CURRENT_PASSWORD', '当前密码不正确。')
  }

  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(await hashPassword(parsed.data.newPassword), user.id),
    context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .bind(user.id, context.get('sessionTokenHash')),
  ])
  console.log('password_changed', { userId: user.id })
  return context.json({ ok: true, data: null })
})

app.get('/categories', async (context) => {
  const result = await context.env.DB.prepare(
    'SELECT id, name, slug FROM categories WHERE status = ? AND deleted_at IS NULL ORDER BY sort ASC, id ASC',
  ).bind('active').all()
  return context.json({ ok: true, data: result.results })
})

app.get('/tags', async (context) => {
  const result = await context.env.DB.prepare(
    'SELECT id, name, slug FROM tags WHERE status = ? AND deleted_at IS NULL ORDER BY name ASC',
  ).bind('active').all()
  return context.json({ ok: true, data: result.results })
})

const listQuerySchema = z.object({
  q: z.string().trim().max(80).optional().default(''),
  category: z.string().trim().max(60).optional().default(''),
  tags: z.string().trim().max(200).optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
})

app.get('/games', async (context) => {
  const parsed = listQuerySchema.safeParse(context.req.query())
  if (!parsed.success) return fail(context, 400, 'INVALID_QUERY', '筛选参数不正确。')

  const { q, category, tags, page, pageSize } = parsed.data
  const requestedTags = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  const filters = ["g.status = 'published'", 'g.deleted_at IS NULL']
  const bindings: Array<string | number> = []

  if (q) {
    filters.push('(g.name LIKE ? OR g.description LIKE ?)')
    bindings.push(`%${q}%`, `%${q}%`)
  }
  if (category) {
    filters.push('c.slug = ?')
    bindings.push(category)
  }
  for (const tag of requestedTags) {
    filters.push('EXISTS (SELECT 1 FROM game_tags gt_filter JOIN tags t_filter ON t_filter.id = gt_filter.tag_id WHERE gt_filter.game_id = g.id AND t_filter.slug = ?)')
    bindings.push(tag)
  }

  const where = filters.join(' AND ')
  const countRow = await context.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM games g JOIN categories c ON c.id = g.category_id WHERE ${where}`,
  ).bind(...bindings).first<{ total: number }>()
  const offset = (page - 1) * pageSize
  const result = await context.env.DB.prepare(`${gameSelectSql} WHERE ${where}
    GROUP BY g.id ORDER BY g.publish_at DESC, g.id DESC LIMIT ? OFFSET ?
  `).bind(...bindings, pageSize, offset).all<GameRow>()

  return context.json({
    ok: true,
    data: result.results.map(serializeGame),
    pagination: { page, pageSize, total: countRow?.total ?? 0 },
  })
})

app.get('/games/:slug', async (context) => {
  const row = await context.env.DB.prepare(`${gameSelectSql}
    WHERE g.slug = ? AND g.status = 'published' AND g.deleted_at IS NULL GROUP BY g.id
  `).bind(context.req.param('slug')).first<GameRow>()
  if (!row) return fail(context, 404, 'GAME_NOT_FOUND', '游戏不存在或已下架。')
  return context.json({ ok: true, data: serializeGame(row) })
})

app.get('/games/:slug/downloads', requireAuth, async (context) => {
  const game = await context.env.DB.prepare(`
    SELECT id, resource_type, resource_status FROM games
    WHERE slug = ? AND status = 'published' AND deleted_at IS NULL
  `).bind(context.req.param('slug')).first<{ id: number; resource_type: 'free' | 'member'; resource_status: string }>()
  if (!game) return fail(context, 404, 'GAME_NOT_FOUND', '游戏不存在或已下架。')
  if (game.resource_status !== 'available') return fail(context, 409, 'RESOURCE_UNAVAILABLE', '资源正在维护，请稍后再试。')

  const user = context.get('user')
  if (game.resource_type === 'member' && !user.isMember && user.role !== 'admin') {
    return fail(context, 403, 'MEMBERSHIP_REQUIRED', '该资源需要有效会员权限。')
  }

  const result = await context.env.DB.prepare(`
    SELECT provider, label, url FROM game_downloads
    WHERE game_id = ? AND status = 'active' ORDER BY sort ASC, id ASC
  `).bind(game.id).all()
  return context.json({ ok: true, data: result.results })
})

const feedbackSchema = z.object({
  gameSlug: z.string().trim().max(100).optional(),
  type: z.enum(['add_game', 'resource_invalid', 'website', 'other']),
  title: z.string().trim().min(3).max(60),
  content: z.string().trim().min(5).max(500),
})

app.post('/feedback', requireAuth, async (context) => {
  const parsed = await parseJson(context, feedbackSchema)
  if (!parsed.success) return parsed.response
  if (parsed.data.type === 'resource_invalid' && !parsed.data.gameSlug) {
    return fail(context, 400, 'GAME_REQUIRED', '资源失效反馈必须关联游戏。')
  }

  let gameId: number | null = null
  if (parsed.data.gameSlug) {
    const game = await context.env.DB.prepare('SELECT id FROM games WHERE slug = ? AND deleted_at IS NULL')
      .bind(parsed.data.gameSlug).first<{ id: number }>()
    if (!game) return fail(context, 404, 'GAME_NOT_FOUND', '关联游戏不存在。')
    gameId = game.id
  }

  const result = await context.env.DB.prepare(`
    INSERT INTO feedback (user_id, game_id, type, title, content) VALUES (?, ?, ?, ?, ?)
  `).bind(context.get('user').id, gameId, parsed.data.type, parsed.data.title, parsed.data.content).run()
  return context.json({ ok: true, data: { id: result.meta.last_row_id, status: 'pending' } }, 201)
})

app.get('/feedback/mine', requireAuth, async (context) => {
  const result = await context.env.DB.prepare(`
    SELECT f.id, f.type, f.title, f.content, f.status, f.admin_reply, f.created_at, f.handled_at,
           g.name AS game_name, g.slug AS game_slug
    FROM feedback f LEFT JOIN games g ON g.id = f.game_id
    WHERE f.user_id = ? ORDER BY f.created_at DESC, f.id DESC LIMIT 100
  `).bind(context.get('user').id).all()
  return context.json({ ok: true, data: result.results })
})

const orderSchema = z.object({
  plan: z.enum(['monthly', 'lifetime']),
  paymentChannel: z.enum(['wechat', 'alipay']),
  userNote: z.string().trim().max(200).optional().default(''),
})

app.post('/membership/orders', requireAuth, async (context) => {
  const parsed = await parseJson(context, orderSchema)
  if (!parsed.success) return parsed.response
  const userId = context.get('user').id
  const pending = await context.env.DB.prepare(
    "SELECT id FROM membership_orders WHERE user_id = ? AND status = 'pending' LIMIT 1",
  ).bind(userId).first<{ id: number }>()
  if (pending) return fail(context, 409, 'PENDING_ORDER_EXISTS', '你已有待审核的会员工单。')

  const result = await context.env.DB.prepare(`
    INSERT INTO membership_orders (user_id, plan, payment_channel, user_note) VALUES (?, ?, ?, ?)
  `).bind(userId, parsed.data.plan, parsed.data.paymentChannel, parsed.data.userNote || null).run()
  return context.json({ ok: true, data: { id: result.meta.last_row_id, status: 'pending' } }, 201)
})

app.get('/membership/orders', requireAuth, async (context) => {
  const result = await context.env.DB.prepare(`
    SELECT id, plan, payment_channel, status, user_note, admin_note, submitted_at, reviewed_at
    FROM membership_orders WHERE user_id = ? ORDER BY submitted_at DESC, id DESC LIMIT 100
  `).bind(context.get('user').id).all()
  return context.json({ ok: true, data: result.results })
})

app.route('/admin', admin)

const gameSelectSql = `
  SELECT g.id, g.slug, g.name, g.cover_url, g.description, g.min_config, g.resource_type,
         g.resource_status, g.publish_at, c.name AS category, c.slug AS category_slug,
         GROUP_CONCAT(DISTINCT CASE WHEN t.id IS NOT NULL THEN t.slug || char(31) || t.name END) AS tag_pairs
  FROM games g
  JOIN categories c ON c.id = g.category_id
  LEFT JOIN game_tags gt ON gt.game_id = g.id
  LEFT JOIN tags t ON t.id = gt.tag_id AND t.status = 'active' AND t.deleted_at IS NULL
`

function serializeGame(row: GameRow) {
  const tags = row.tag_pairs ? row.tag_pairs.split(',').map((pair) => {
    const [slug, name] = pair.split(String.fromCharCode(31))
    return { name, slug }
  }) : []
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    cover: row.cover_url,
    description: row.description,
    minConfig: JSON.parse(row.min_config) as string[],
    resourceType: row.resource_type,
    resourceStatus: row.resource_status,
    publishAt: row.publish_at,
    category: { name: row.category, slug: row.category_slug },
    tags,
  }
}

async function findUserById(database: D1Database, userId: number) {
  return database.prepare(`
    SELECT id, username, avatar_url, role, member_type, member_expire_at
    FROM users WHERE id = ? AND deleted_at IS NULL
  `).bind(userId).first<LoginUserRow>()
}

async function parseJson<TSchema extends z.ZodType>(context: Parameters<typeof fail>[0], schema: TSchema) {
  try {
    const body: unknown = await context.req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return { success: false as const, response: fail(context, 400, 'INVALID_INPUT', '提交内容不符合要求。') }
    }
    return { success: true as const, data: parsed.data as z.infer<TSchema> }
  } catch {
    return { success: false as const, response: fail(context, 400, 'INVALID_JSON', '请求内容必须是有效 JSON。') }
  }
}

function fail(context: Parameters<Parameters<typeof app.onError>[0]>[1], status: 400 | 401 | 403 | 404 | 409 | 429 | 500, code: string, message: string) {
  return context.json({ ok: false as const, error: { code, message } }, status)
}

function isLoopbackOrigin(value: string) {
  try {
    const hostname = new URL(value).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}

export default app
