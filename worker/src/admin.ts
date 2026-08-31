import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { AppEnv } from './types'

const admin = new Hono<AppEnv>()

const requireAdmin = createMiddleware<AppEnv>(async (context, next) => {
  const user = context.get('user')
  if (!user) return fail(context, 401, 'AUTH_REQUIRED', '请先登录。')
  if (user.role !== 'admin') return fail(context, 403, 'ADMIN_REQUIRED', '需要管理员权限。')
  await next()
})

admin.use('*', requireAdmin)

admin.get('/overview', async (context) => {
  const [users, games, orders, feedback] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL"),
    context.env.DB.prepare("SELECT COUNT(*) AS total FROM games WHERE deleted_at IS NULL"),
    context.env.DB.prepare("SELECT COUNT(*) AS total FROM membership_orders WHERE status = 'pending'"),
    context.env.DB.prepare("SELECT COUNT(*) AS total FROM feedback WHERE status IN ('pending', 'processing')"),
  ])
  return context.json({ ok: true, data: {
    users: Number((users.results[0] as { total?: number } | undefined)?.total ?? 0),
    games: Number((games.results[0] as { total?: number } | undefined)?.total ?? 0),
    pendingOrders: Number((orders.results[0] as { total?: number } | undefined)?.total ?? 0),
    openFeedback: Number((feedback.results[0] as { total?: number } | undefined)?.total ?? 0),
  } })
})

admin.get('/users', async (context) => {
  const q = String(context.req.query('q') ?? '').trim()
  const result = await context.env.DB.prepare(`
    SELECT id, username, avatar_url, role, status, member_type, member_started_at, member_expire_at, created_at
    FROM users WHERE deleted_at IS NULL AND (? = '' OR username LIKE ?)
    ORDER BY created_at DESC, id DESC LIMIT 200
  `).bind(q, `%${q}%`).all()
  return context.json({ ok: true, data: result.results })
})

const userUpdateSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  role: z.enum(['user', 'admin']).optional(),
  memberType: z.enum(['none', 'monthly', 'lifetime']).optional(),
  memberExpireAt: z.string().datetime().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0)

admin.patch('/users/:id', async (context) => {
  const userId = Number(context.req.param('id'))
  if (!Number.isInteger(userId)) return fail(context, 400, 'INVALID_USER', '用户 ID 无效。')
  const parsed = await parseJson(context, userUpdateSchema)
  if (!parsed.success) return parsed.response
  const operator = context.get('user')
  if (userId === operator.id && (parsed.data.status === 'disabled' || parsed.data.role === 'user')) {
    return fail(context, 409, 'CANNOT_REVOKE_SELF', '不能禁用自己或移除自己的管理员权限。')
  }

  const current = await context.env.DB.prepare(`
    SELECT id, member_type, member_expire_at FROM users WHERE id = ? AND deleted_at IS NULL
  `).bind(userId).first<{ id: number; member_type: string; member_expire_at: string | null }>()
  if (!current) return fail(context, 404, 'USER_NOT_FOUND', '用户不存在。')

  const nextType = parsed.data.memberType ?? current.member_type
  const requestedExpire = parsed.data.memberExpireAt ? toDatabaseDate(parsed.data.memberExpireAt) : parsed.data.memberExpireAt
  const nextExpire = nextType === 'monthly' ? (requestedExpire ?? current.member_expire_at) : null
  if (nextType === 'monthly' && !nextExpire) return fail(context, 400, 'MEMBER_EXPIRY_REQUIRED', '月度会员必须设置到期时间。')

  const statements = [context.env.DB.prepare(`
    UPDATE users SET status = COALESCE(?, status), role = COALESCE(?, role), member_type = ?,
      member_started_at = CASE WHEN ? <> member_type THEN CURRENT_TIMESTAMP ELSE member_started_at END,
      member_expire_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(parsed.data.status ?? null, parsed.data.role ?? null, nextType, nextType, nextExpire, userId)]

  if (nextType !== current.member_type || nextExpire !== current.member_expire_at) {
    statements.push(context.env.DB.prepare(`
      INSERT INTO membership_changes
        (user_id, before_type, after_type, before_expire_at, after_expire_at, reason, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(userId, current.member_type, nextType, current.member_expire_at, nextExpire, '管理员手动调整', operator.id))
  }
  if (parsed.data.status === 'disabled') statements.push(context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId))
  await context.env.DB.batch(statements)
  return context.json({ ok: true, data: null })
})

admin.get('/orders', async (context) => {
  const status = String(context.req.query('status') ?? '')
  const result = await context.env.DB.prepare(`
    SELECT o.id, o.plan, o.payment_channel, o.status, o.user_note, o.admin_note,
           o.submitted_at, o.reviewed_at, u.id AS user_id, u.username
    FROM membership_orders o JOIN users u ON u.id = o.user_id
    WHERE (? = '' OR o.status = ?) ORDER BY o.submitted_at DESC, o.id DESC LIMIT 200
  `).bind(status, status).all()
  return context.json({ ok: true, data: result.results })
})

const orderReviewSchema = z.object({ status: z.enum(['approved', 'rejected']), adminNote: z.string().trim().max(300).optional().default('') })

admin.patch('/orders/:id', async (context) => {
  const orderId = Number(context.req.param('id'))
  const parsed = await parseJson(context, orderReviewSchema)
  if (!Number.isInteger(orderId) || !parsed.success) return parsed.success ? fail(context, 400, 'INVALID_ORDER', '工单 ID 无效。') : parsed.response
  const order = await context.env.DB.prepare(`
    SELECT o.id, o.user_id, o.plan, o.status, u.member_type, u.member_expire_at
    FROM membership_orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?
  `).bind(orderId).first<{ id: number; user_id: number; plan: 'monthly' | 'lifetime'; status: string; member_type: string; member_expire_at: string | null }>()
  if (!order) return fail(context, 404, 'ORDER_NOT_FOUND', '工单不存在。')
  if (order.status !== 'pending') return fail(context, 409, 'ORDER_ALREADY_REVIEWED', '该工单已经审核。')

  const operator = context.get('user')
  const statements = [context.env.DB.prepare(`
    UPDATE membership_orders SET status = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?
    WHERE id = ? AND status = 'pending'
  `).bind(parsed.data.status, parsed.data.adminNote || null, operator.id, orderId)]

  if (parsed.data.status === 'approved') {
    const afterType = order.plan
    const afterExpire = order.plan === 'monthly' ? addOneMonth(order.member_type === 'monthly' ? order.member_expire_at : null) : null
    statements.push(
      context.env.DB.prepare(`
        UPDATE users SET member_type = ?, member_started_at = COALESCE(member_started_at, CURRENT_TIMESTAMP),
          member_expire_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(afterType, afterExpire, order.user_id),
      context.env.DB.prepare(`
        INSERT INTO membership_changes
          (user_id, before_type, after_type, before_expire_at, after_expire_at, reason, operator_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(order.user_id, order.member_type, afterType, order.member_expire_at, afterExpire, `审核会员工单 #${order.id}`, operator.id),
    )
  }
  await context.env.DB.batch(statements)
  return context.json({ ok: true, data: null })
})

admin.get('/feedback', async (context) => {
  const status = String(context.req.query('status') ?? '')
  const result = await context.env.DB.prepare(`
    SELECT f.id, f.type, f.title, f.content, f.status, f.admin_reply, f.created_at, f.handled_at,
           u.username, g.name AS game_name
    FROM feedback f JOIN users u ON u.id = f.user_id LEFT JOIN games g ON g.id = f.game_id
    WHERE (? = '' OR f.status = ?) ORDER BY f.created_at DESC, f.id DESC LIMIT 200
  `).bind(status, status).all()
  return context.json({ ok: true, data: result.results })
})

const feedbackUpdateSchema = z.object({
  status: z.enum(['pending', 'processing', 'resolved', 'closed']),
  adminReply: z.string().trim().max(500).optional().default(''),
})

admin.patch('/feedback/:id', async (context) => {
  const feedbackId = Number(context.req.param('id'))
  const parsed = await parseJson(context, feedbackUpdateSchema)
  if (!Number.isInteger(feedbackId) || !parsed.success) return parsed.success ? fail(context, 400, 'INVALID_FEEDBACK', '反馈 ID 无效。') : parsed.response
  const result = await context.env.DB.prepare(`
    UPDATE feedback SET status = ?, admin_reply = ?, handled_by = ?,
      handled_at = CASE WHEN ? IN ('resolved', 'closed') THEN CURRENT_TIMESTAMP ELSE handled_at END
    WHERE id = ?
  `).bind(parsed.data.status, parsed.data.adminReply || null, context.get('user').id, parsed.data.status, feedbackId).run()
  if (!result.meta.changes) return fail(context, 404, 'FEEDBACK_NOT_FOUND', '反馈不存在。')
  return context.json({ ok: true, data: null })
})

const gameSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  coverUrl: z.string().trim().min(1).max(1000),
  description: z.string().trim().min(10).max(5000),
  minConfig: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  categoryId: z.number().int().positive(),
  resourceType: z.enum(['free', 'member']),
  resourceStatus: z.enum(['available', 'checking', 'unavailable']),
  status: z.enum(['draft', 'published', 'offline']),
  publishAt: z.string().trim().nullable(),
  tagIds: z.array(z.number().int().positive()).max(20),
  downloads: z.array(z.object({
    provider: z.string().trim().min(1).max(50), label: z.string().trim().min(1).max(100),
    url: z.string().url().max(2000), sort: z.number().int().min(0).max(1000).default(0),
  })).max(20),
})

admin.get('/games', async (context) => {
  const result = await context.env.DB.prepare(`
    SELECT g.id, g.name, g.slug, g.cover_url, g.resource_type, g.resource_status, g.status, g.publish_at,
           c.name AS category FROM games g JOIN categories c ON c.id = g.category_id
    WHERE g.deleted_at IS NULL ORDER BY g.created_at DESC, g.id DESC LIMIT 300
  `).all()
  return context.json({ ok: true, data: result.results })
})

admin.get('/games/:id', async (context) => {
  const gameId = Number(context.req.param('id'))
  const game = await context.env.DB.prepare('SELECT * FROM games WHERE id = ? AND deleted_at IS NULL').bind(gameId).first<Record<string, unknown>>()
  if (!game) return fail(context, 404, 'GAME_NOT_FOUND', '游戏不存在。')
  const [tags, downloads] = await context.env.DB.batch([
    context.env.DB.prepare('SELECT tag_id FROM game_tags WHERE game_id = ? ORDER BY tag_id').bind(gameId),
    context.env.DB.prepare('SELECT provider, label, url, sort FROM game_downloads WHERE game_id = ? AND status = ? ORDER BY sort, id').bind(gameId, 'active'),
  ])
  return context.json({ ok: true, data: { ...game, tagIds: tags.results.map((row) => (row as { tag_id: number }).tag_id), downloads: downloads.results } })
})

admin.post('/games', async (context) => {
  const parsed = await parseJson(context, gameSchema)
  if (!parsed.success) return parsed.response
  try {
    const value = parsed.data
    const result = await context.env.DB.prepare(`
      INSERT INTO games (name, slug, cover_url, description, min_config, category_id, resource_type, resource_status, status, publish_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(value.name, value.slug, value.coverUrl, value.description, JSON.stringify(value.minConfig), value.categoryId,
      value.resourceType, value.resourceStatus, value.status, value.publishAt || null).run()
    const gameId = Number(result.meta.last_row_id)
    await context.env.DB.batch(gameRelations(context.env.DB, gameId, value.tagIds, value.downloads))
    return context.json({ ok: true, data: { id: gameId } }, 201)
  } catch (error) {
    if (String(error).includes('UNIQUE')) return fail(context, 409, 'GAME_SLUG_TAKEN', '游戏 slug 已存在。')
    throw error
  }
})

admin.put('/games/:id', async (context) => {
  const gameId = Number(context.req.param('id'))
  const parsed = await parseJson(context, gameSchema)
  if (!Number.isInteger(gameId) || !parsed.success) return parsed.success ? fail(context, 400, 'INVALID_GAME', '游戏 ID 无效。') : parsed.response
  const value = parsed.data
  try {
    const statements = [context.env.DB.prepare(`
      UPDATE games SET name = ?, slug = ?, cover_url = ?, description = ?, min_config = ?, category_id = ?,
        resource_type = ?, resource_status = ?, status = ?, publish_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).bind(value.name, value.slug, value.coverUrl, value.description, JSON.stringify(value.minConfig), value.categoryId,
      value.resourceType, value.resourceStatus, value.status, value.publishAt || null, gameId),
    context.env.DB.prepare('DELETE FROM game_tags WHERE game_id = ?').bind(gameId),
    context.env.DB.prepare('DELETE FROM game_downloads WHERE game_id = ?').bind(gameId),
    ...gameRelations(context.env.DB, gameId, value.tagIds, value.downloads)]
    await context.env.DB.batch(statements)
    return context.json({ ok: true, data: null })
  } catch (error) {
    if (String(error).includes('UNIQUE')) return fail(context, 409, 'GAME_SLUG_TAKEN', '游戏 slug 已存在。')
    throw error
  }
})

admin.delete('/games/:id', async (context) => {
  const gameId = Number(context.req.param('id'))
  if (!Number.isInteger(gameId)) return fail(context, 400, 'INVALID_GAME', '游戏 ID 无效。')
  const result = await context.env.DB.prepare(`
    UPDATE games SET status = 'offline', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).bind(gameId).run()
  if (!result.meta.changes) return fail(context, 404, 'GAME_NOT_FOUND', '游戏不存在。')
  await context.env.DB.prepare('DELETE FROM game_tags WHERE game_id = ?').bind(gameId).run()
  return context.json({ ok: true, data: null })
})

admin.get('/categories', async (context) => taxonomyList(context, 'categories'))
admin.get('/tags', async (context) => taxonomyList(context, 'tags'))

const taxonomySchema = z.object({
  name: z.string().trim().min(1).max(50),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.enum(['active', 'disabled']).optional().default('active'),
  sort: z.number().int().min(0).max(10_000).optional().default(0),
})

admin.post('/categories', async (context) => createTaxonomy(context, 'categories'))
admin.post('/tags', async (context) => createTaxonomy(context, 'tags'))
admin.patch('/categories/:id', async (context) => updateTaxonomy(context, 'categories'))
admin.patch('/tags/:id', async (context) => updateTaxonomy(context, 'tags'))
admin.delete('/categories/:id', async (context) => deleteTaxonomy(context, 'categories'))
admin.delete('/tags/:id', async (context) => deleteTaxonomy(context, 'tags'))

function gameRelations(database: D1Database, gameId: number, tagIds: number[], downloads: Array<{ provider: string; label: string; url: string; sort: number }>) {
  return [
    ...tagIds.map((tagId) => database.prepare('INSERT INTO game_tags (game_id, tag_id) VALUES (?, ?)').bind(gameId, tagId)),
    ...downloads.map((download) => database.prepare(`
      INSERT INTO game_downloads (game_id, provider, label, url, sort) VALUES (?, ?, ?, ?, ?)
    `).bind(gameId, download.provider, download.label, download.url, download.sort)),
  ]
}

async function taxonomyList(context: Parameters<typeof fail>[0], table: 'categories' | 'tags') {
  const order = table === 'categories' ? 'sort ASC, id ASC' : 'name ASC, id ASC'
  const sort = table === 'categories' ? 'sort' : '0 AS sort'
  const result = await context.env.DB.prepare(`SELECT id, name, slug, status, ${sort} FROM ${table} WHERE deleted_at IS NULL ORDER BY ${order}`).all()
  return context.json({ ok: true, data: result.results })
}

async function createTaxonomy(context: Parameters<typeof fail>[0], table: 'categories' | 'tags') {
  const parsed = await parseJson(context, taxonomySchema)
  if (!parsed.success) return parsed.response
  try {
    const statement = table === 'categories'
      ? context.env.DB.prepare('INSERT INTO categories (name, slug, status, sort) VALUES (?, ?, ?, ?)').bind(parsed.data.name, parsed.data.slug, parsed.data.status, parsed.data.sort)
      : context.env.DB.prepare('INSERT INTO tags (name, slug, status) VALUES (?, ?, ?)').bind(parsed.data.name, parsed.data.slug, parsed.data.status)
    const result = await statement.run()
    return context.json({ ok: true, data: { id: result.meta.last_row_id } }, 201)
  } catch (error) {
    if (String(error).includes('UNIQUE')) return fail(context, 409, 'TAXONOMY_CONFLICT', '名称或 slug 已存在。')
    throw error
  }
}

async function updateTaxonomy(context: Parameters<typeof fail>[0], table: 'categories' | 'tags') {
  const id = Number(context.req.param('id'))
  const parsed = await parseJson(context, taxonomySchema)
  if (!Number.isInteger(id) || !parsed.success) return parsed.success ? fail(context, 400, 'INVALID_TAXONOMY', '分类或标签 ID 无效。') : parsed.response
  try {
    const statement = table === 'categories'
      ? context.env.DB.prepare('UPDATE categories SET name = ?, slug = ?, status = ?, sort = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(parsed.data.name, parsed.data.slug, parsed.data.status, parsed.data.sort, id)
      : context.env.DB.prepare('UPDATE tags SET name = ?, slug = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(parsed.data.name, parsed.data.slug, parsed.data.status, id)
    const result = await statement.run()
    if (!result.meta.changes) return fail(context, 404, 'TAXONOMY_NOT_FOUND', '分类或标签不存在。')
    return context.json({ ok: true, data: null })
  } catch (error) {
    if (String(error).includes('UNIQUE')) return fail(context, 409, 'TAXONOMY_CONFLICT', '名称或 slug 已存在。')
    throw error
  }
}

async function deleteTaxonomy(context: Parameters<typeof fail>[0], table: 'categories' | 'tags') {
  const id = Number(context.req.param('id'))
  if (!Number.isInteger(id)) return fail(context, 400, 'INVALID_TAXONOMY', '分类或标签 ID 无效。')
  const reference = table === 'categories'
    ? await context.env.DB.prepare('SELECT COUNT(*) AS total FROM games WHERE category_id = ? AND deleted_at IS NULL').bind(id).first<{ total: number }>()
    : await context.env.DB.prepare('SELECT COUNT(*) AS total FROM game_tags WHERE tag_id = ?').bind(id).first<{ total: number }>()
  if ((reference?.total ?? 0) > 0) return fail(context, 409, 'TAXONOMY_IN_USE', '该分类或标签仍被游戏使用，请先调整关联。')
  const result = await context.env.DB.prepare(`UPDATE ${table} SET status = 'disabled', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`).bind(id).run()
  if (!result.meta.changes) return fail(context, 404, 'TAXONOMY_NOT_FOUND', '分类或标签不存在。')
  return context.json({ ok: true, data: null })
}

function addOneMonth(value: string | null) {
  const now = new Date()
  const normalized = value?.includes('T') ? value : value?.replace(' ', 'T')
  const current = normalized ? new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`) : now
  const base = Number.isNaN(current.getTime()) || current < now ? now : current
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth()
  const day = base.getUTCDate()
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate()
  const result = new Date(base)
  result.setUTCFullYear(year, month + 1, Math.min(day, lastDay))
  return result.toISOString().slice(0, 19).replace('T', ' ')
}

function toDatabaseDate(value: string) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ')
}

async function parseJson<TSchema extends z.ZodType>(context: Parameters<typeof fail>[0], schema: TSchema) {
  try {
    const parsed = schema.safeParse(await context.req.json())
    if (!parsed.success) return { success: false as const, response: fail(context, 400, 'INVALID_INPUT', '提交内容不符合要求。') }
    return { success: true as const, data: parsed.data as z.infer<TSchema> }
  } catch {
    return { success: false as const, response: fail(context, 400, 'INVALID_JSON', '请求内容必须是有效 JSON。') }
  }
}

function fail(context: Parameters<Parameters<typeof admin.onError>[0]>[1], status: 400 | 401 | 403 | 404 | 409 | 500, code: string, message: string) {
  return context.json({ ok: false as const, error: { code, message } }, status)
}

export default admin
