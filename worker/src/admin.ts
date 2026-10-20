import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { serializeUser } from './auth'
import { uploadImage } from './media'
import type { AppEnv, AuthUser } from './types'

const admin = new Hono<AppEnv>()

const adminListQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
})

async function listPagination(database: D1Database, from: string, bindings: Array<string | number>, requestedPage: number) {
  const row = await database.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...bindings).first<{ total: number }>()
  const total = row?.total ?? 0
  const pageSize = 10
  return { page: Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize))), pageSize, total }
}

const requireAdmin = createMiddleware<AppEnv>(async (context, next) => {
  const user = context.get('user')
  if (!user) return fail(context, 401, 'AUTH_REQUIRED', '请先登录。')
  if (user.role !== 'admin') return fail(context, 403, 'ADMIN_REQUIRED', '需要管理员权限。')
  await next()
})

admin.use('*', requireAdmin)
admin.post('/uploads/images', uploadImage)

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

type AdminUserRow = Parameters<typeof serializeUser>[0] & {
  status: 'active' | 'disabled'
  is_super: number
  member_started_at: string | null
  created_at: string
  last_login_at: string | null
}

admin.get('/users', async (context) => {
  const parsed = z.object({
    q: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    role: z.enum(['user', 'admin']).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    memberType: z.enum(['none', 'monthly', 'lifetime']).optional(),
  }).safeParse(context.req.query())
  if (!parsed.success) return fail(context, 400, 'INVALID_QUERY', '筛选或分页参数无效。')
  const { q, role, status, memberType } = parsed.data
  const conditions = ['deleted_at IS NULL']
  const bindings: Array<string | number> = []
  if (q) { conditions.push('username LIKE ?'); bindings.push(`%${q}%`) }
  if (status) { conditions.push('status = ?'); bindings.push(status) }
  // Use the same effective membership as serializeUser, including invalid dates.
  if (memberType) {
    conditions.push(`(CASE WHEN member_type = 'lifetime' THEN 'lifetime'
      WHEN member_type = 'monthly' AND julianday(member_expire_at) > julianday(?) THEN 'monthly'
      ELSE 'none' END) = ?`)
    bindings.push(new Date().toISOString(), memberType)
  }
  const counts = await context.env.DB.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(role = 'admin'), 0) AS admin, COALESCE(SUM(role = 'user'), 0) AS user
    FROM users WHERE ${conditions.join(' AND ')}`).bind(...bindings).first<{ total: number; admin: number; user: number }>()
    ?? { total: 0, admin: 0, user: 0 }
  if (role) { conditions.push('role = ?'); bindings.push(role) }
  const total = role ? counts[role] : counts.total
  const pageSize = 10
  const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / pageSize)))
  const result = await context.env.DB.prepare(`
    SELECT id, username, avatar_url, role, is_super, status, member_type, member_started_at, member_expire_at, created_at, last_login_at
    FROM users WHERE ${conditions.join(' AND ')}
    ORDER BY is_super DESC, role = 'admin' DESC, created_at DESC, id DESC LIMIT ? OFFSET ?
  `).bind(...bindings, pageSize, (page - 1) * pageSize).all<AdminUserRow>()
  // Use the same effective membership as authentication and download checks.
  // Retain the stored expiry for history and future renewal edits.
  const users = result.results.map((row) => ({ ...row, member_type: serializeUser(row).memberType }))
  return context.json({ ok: true, data: { users, counts, pagination: { page, pageSize, total } } })
})

const userUpdateSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  role: z.enum(['user', 'admin']).optional(),
  memberType: z.enum(['none', 'monthly', 'lifetime']).optional(),
  memberExpireAt: z.string().datetime().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

function userPermission(operator: AuthUser, target: AdminUserRow, update?: z.infer<typeof userUpdateSchema>, deleting = false) {
  if (target.is_super === 1) return '超级管理员不可操作。'
  if (target.id === operator.id && (deleting || update?.status === 'disabled' || update?.role === 'user')) return '不能删除、禁用或降级自己。'
  if (!operator.isSuper && target.role === 'admin') return '普通管理员只能管理普通用户。'
  if (!operator.isSuper && update?.role === 'admin' && target.role !== 'admin') return '只有超级管理员可以任命或撤销管理员。'
  return null
}

const targetUserSql = `SELECT id, username, avatar_url, role, is_super, status, member_type,
  member_started_at, member_expire_at, created_at, last_login_at FROM users WHERE deleted_at IS NULL`

function userStatements(database: D1Database, operator: AuthUser, current: AdminUserRow, update: z.infer<typeof userUpdateSchema>) {
  const nextType = update.memberType ?? current.member_type
  const requestedExpire = update.memberExpireAt ? toDatabaseDate(update.memberExpireAt) : update.memberExpireAt
  const nextExpire = nextType === 'monthly' ? (requestedExpire === undefined ? current.member_expire_at : requestedExpire) : null
  if (nextType === 'monthly' && !nextExpire && (update.memberType !== undefined || update.memberExpireAt !== undefined)) return null
  const statements = [database.prepare(`
    UPDATE users SET status = COALESCE(?, status), role = COALESCE(?, role), member_type = ?,
      member_started_at = CASE WHEN ? <> member_type THEN CURRENT_TIMESTAMP ELSE member_started_at END,
      member_expire_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL AND is_super = 0
  `).bind(update.status ?? null, update.role ?? null, nextType, nextType, nextExpire, current.id)]
  if (nextType !== current.member_type || nextExpire !== current.member_expire_at) {
    statements.push(database.prepare(`
      INSERT INTO membership_changes
        (user_id, before_type, after_type, before_expire_at, after_expire_at, reason, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(current.id, current.member_type, nextType, current.member_expire_at, nextExpire, '管理员手动调整', operator.id))
  }
  if (update.status === 'disabled') statements.push(database.prepare('DELETE FROM sessions WHERE user_id = ?').bind(current.id))
  return statements
}

const bulkUserSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('disable'), ids: z.array(z.number().int().positive()).min(1).max(100) }).strict(),
  z.object({ action: z.literal('membership'), ids: z.array(z.number().int().positive()).min(1).max(100),
    memberType: z.enum(['none', 'monthly', 'lifetime']), memberExpireAt: z.string().datetime().nullable().optional() }).strict(),
])

admin.post('/users/bulk', async (context) => {
  const parsed = await parseJson(context, bulkUserSchema)
  if (!parsed.success) return parsed.response
  if (parsed.data.action === 'membership' && parsed.data.memberType === 'monthly' && !parsed.data.memberExpireAt) {
    return fail(context, 400, 'MEMBER_EXPIRY_REQUIRED', '批量设置月度会员必须指定统一到期时间。')
  }
  const ids = [...new Set(parsed.data.ids)]
  const operator = context.get('user')
  const result = await context.env.DB.prepare(`${targetUserSql} AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<AdminUserRow>()
  if (result.results.length !== ids.length) return fail(context, 404, 'USER_NOT_FOUND', '部分用户不存在，请刷新后重试。')
  const update = parsed.data.action === 'disable' ? { status: 'disabled' as const }
    : { memberType: parsed.data.memberType, memberExpireAt: parsed.data.memberExpireAt }
  const statements: D1PreparedStatement[] = []
  for (const target of result.results) {
    const denial = userPermission(operator, target, update)
    if (denial) return fail(context, 403, 'USER_PROTECTED', `${target.username}：${denial}`)
    const changes = userStatements(context.env.DB, operator, target, update)
    if (!changes) return fail(context, 400, 'MEMBER_EXPIRY_REQUIRED', '月度会员必须设置到期时间。')
    statements.push(...changes)
  }
  await context.env.DB.batch(statements)
  return context.json({ ok: true, data: { updated: ids.length } })
})

admin.patch('/users/:id', async (context) => {
  const userId = Number(context.req.param('id'))
  if (!Number.isSafeInteger(userId) || userId <= 0) return fail(context, 400, 'INVALID_USER', '用户 ID 无效。')
  const parsed = await parseJson(context, userUpdateSchema)
  if (!parsed.success) return parsed.response
  const operator = context.get('user')
  const current = await context.env.DB.prepare(`${targetUserSql} AND id = ?`).bind(userId).first<AdminUserRow>()
  if (!current) return fail(context, 404, 'USER_NOT_FOUND', '用户不存在。')
  const denial = userPermission(operator, current, parsed.data)
  if (denial) return fail(context, 403, 'USER_PROTECTED', denial)
  const statements = userStatements(context.env.DB, operator, current, parsed.data)
  if (!statements) return fail(context, 400, 'MEMBER_EXPIRY_REQUIRED', '月度会员必须设置到期时间。')
  await context.env.DB.batch(statements)
  return context.json({ ok: true, data: null })
})

admin.delete('/users/:id', async (context) => {
  const userId = Number(context.req.param('id'))
  if (!Number.isSafeInteger(userId) || userId <= 0) return fail(context, 400, 'INVALID_USER', '用户 ID 无效。')
  const target = await context.env.DB.prepare(`${targetUserSql} AND id = ?`).bind(userId).first<AdminUserRow>()
  if (!target) return fail(context, 404, 'USER_NOT_FOUND', '用户不存在。')
  const denial = userPermission(context.get('user'), target, undefined, true)
  if (denial) return fail(context, 403, 'USER_PROTECTED', denial)
  const results = await context.env.DB.batch([context.env.DB.prepare(`
    UPDATE users SET status = 'disabled', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL AND is_super = 0
  `).bind(userId), context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId)])
  if (!results[0]?.meta.changes) return fail(context, 404, 'USER_NOT_FOUND', '用户不存在。')
  return context.json({ ok: true, data: null })
})

admin.get('/orders', async (context) => {
  const parsed = adminListQuerySchema.extend({ status: z.enum(['pending', 'approved', 'rejected']).optional() }).safeParse(context.req.query())
  if (!parsed.success) return fail(context, 400, 'INVALID_QUERY', '分页参数无效。')
  const { q, status = '' } = parsed.data
  const from = `FROM membership_orders o JOIN users u ON u.id = o.user_id
    WHERE (? = '' OR o.status = ?) AND (? = '' OR u.username LIKE ?)`
  const bindings = [status, status, q, `%${q}%`]
  const pagination = await listPagination(context.env.DB, from, bindings, parsed.data.page)
  const result = await context.env.DB.prepare(`
    SELECT o.id, o.plan, o.payment_channel, o.status, o.user_note, o.admin_note,
           o.submitted_at, o.reviewed_at, u.id AS user_id, u.username
    ${from} ORDER BY o.submitted_at DESC, o.id DESC LIMIT ? OFFSET ?
  `).bind(...bindings, pagination.pageSize, (pagination.page - 1) * pagination.pageSize).all()
  return context.json({ ok: true, data: { items: result.results, pagination } })
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
    const target = await context.env.DB.prepare(`${targetUserSql} AND id = ?`).bind(order.user_id).first<AdminUserRow>()
    if (!target) return fail(context, 404, 'USER_NOT_FOUND', '用户不存在。')
    const denial = userPermission(operator, target)
    if (denial) return fail(context, 403, 'USER_PROTECTED', denial)
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

admin.delete('/orders/:id', async (context) => {
  const orderId = Number(context.req.param('id'))
  if (!Number.isInteger(orderId)) return fail(context, 400, 'INVALID_ORDER', '工单 ID 无效。')
  const result = await context.env.DB.prepare('DELETE FROM membership_orders WHERE id = ?').bind(orderId).run()
  if (!result.meta.changes) return fail(context, 404, 'ORDER_NOT_FOUND', '工单不存在。')
  return context.json({ ok: true, data: null })
})

admin.get('/feedback', async (context) => {
  const parsed = adminListQuerySchema.extend({ status: z.enum(['pending', 'processing', 'resolved', 'closed']).optional() }).safeParse(context.req.query())
  if (!parsed.success) return fail(context, 400, 'INVALID_QUERY', '分页参数无效。')
  const { q, status = '' } = parsed.data
  const from = `FROM feedback f JOIN users u ON u.id = f.user_id LEFT JOIN games g ON g.id = f.game_id
    WHERE (? = '' OR f.status = ?) AND (? = '' OR u.username LIKE ? OR f.title LIKE ? OR f.content LIKE ?)`
  const bindings = [status, status, q, `%${q}%`, `%${q}%`, `%${q}%`]
  const pagination = await listPagination(context.env.DB, from, bindings, parsed.data.page)
  const result = await context.env.DB.prepare(`
    SELECT f.id, f.type, f.title, f.content, f.status, f.admin_reply, f.created_at, f.handled_at,
           u.username, g.name AS game_name
    ${from} ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?
  `).bind(...bindings, pagination.pageSize, (pagination.page - 1) * pagination.pageSize).all()
  return context.json({ ok: true, data: { items: result.results, pagination } })
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

admin.delete('/feedback/:id', async (context) => {
  const feedbackId = Number(context.req.param('id'))
  if (!Number.isInteger(feedbackId)) return fail(context, 400, 'INVALID_FEEDBACK', '反馈 ID 无效。')
  const result = await context.env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(feedbackId).run()
  if (!result.meta.changes) return fail(context, 404, 'FEEDBACK_NOT_FOUND', '反馈不存在。')
  return context.json({ ok: true, data: null })
})

const gameSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  coverUrl: z.string().trim().min(1).max(1000),
  description: z.string().min(10).max(30000).refine((value) => value.trim().length >= 10),
  descriptionFormat: z.enum(['plain', 'markdown']).optional(),
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

const adminGamesQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  categoryId: z.coerce.number().int().positive().max(2147483647).optional(),
  resourceType: z.enum(['free', 'member']).optional(),
  status: z.enum(['draft', 'published', 'offline']).optional(),
})

admin.get('/games', async (context) => {
  const parsed = adminGamesQuerySchema.safeParse(context.req.query())
  if (!parsed.success) return fail(context, 400, 'INVALID_QUERY', '分页参数无效。')
  const { q, categoryId, resourceType, status } = parsed.data
  const pageSize = 10
  const conditions = ['g.deleted_at IS NULL']
  const bindings: Array<string | number> = []
  if (q) { conditions.push('(g.name LIKE ? OR g.slug LIKE ?)'); bindings.push(`%${q}%`, `%${q}%`) }
  if (categoryId) { conditions.push('g.category_id = ?'); bindings.push(categoryId) }
  if (resourceType) { conditions.push('g.resource_type = ?'); bindings.push(resourceType) }
  if (status) { conditions.push('g.status = ?'); bindings.push(status) }
  const filters = conditions.join(' AND ')
  const totalRow = await context.env.DB.prepare(`
    SELECT COUNT(*) AS total FROM games g JOIN categories c ON c.id = g.category_id WHERE ${filters}
  `).bind(...bindings).first<{ total: number }>()
  const total = totalRow?.total ?? 0
  const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / pageSize)))
  const offset = (page - 1) * pageSize
  const result = await context.env.DB.prepare(`
    SELECT g.id, g.name, g.slug, g.cover_url, g.resource_type, g.resource_status, g.status, g.publish_at,
           c.name AS category FROM games g JOIN categories c ON c.id = g.category_id
    WHERE ${filters} ORDER BY g.created_at DESC, g.id DESC LIMIT ? OFFSET ?
  `).bind(...bindings, pageSize, offset).all()
  return context.json({ ok: true, data: {
    games: result.results,
    pagination: { page, pageSize, total },
  } })
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
      INSERT INTO games (name, slug, cover_url, description, description_format, min_config, category_id, resource_type, resource_status, status, publish_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(value.name, value.slug, value.coverUrl, value.description, value.descriptionFormat ?? 'plain', JSON.stringify(value.minConfig), value.categoryId,
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
      UPDATE games SET name = ?, slug = ?, cover_url = ?, description = ?, description_format = COALESCE(?, description_format), min_config = ?, category_id = ?,
        resource_type = ?, resource_status = ?, status = ?, publish_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).bind(value.name, value.slug, value.coverUrl, value.description, value.descriptionFormat ?? null, JSON.stringify(value.minConfig), value.categoryId,
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
