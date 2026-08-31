import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'

type Bindings = {
  DB: D1Database
  APP_ENV: string
  ALLOWED_ORIGIN: string
}

type GameRow = {
  id: number
  slug: string
  name: string
  cover_url: string
  description: string
  min_config: string
  resource_type: 'free' | 'member'
  publish_at: string
  category: string
  tags: string | null
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

app.use('*', secureHeaders())
app.use('*', async (context, next) => {
  const middleware = cors({
    origin: context.env.ALLOWED_ORIGIN,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
  })
  return middleware(context, next)
})

app.onError((error, context) => {
  console.error('unhandled_api_error', { message: error.message })
  return context.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试。' } }, 500)
})

app.get('/health', (context) => context.json({ ok: true, data: { service: 'youlun-api', environment: context.env.APP_ENV } }))

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
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'INVALID_QUERY', message: '筛选参数不正确。' } }, 400)
  }

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
  const result = await context.env.DB.prepare(`
    SELECT g.id, g.slug, g.name, g.cover_url, g.description, g.min_config, g.resource_type, g.publish_at,
           c.name AS category, GROUP_CONCAT(DISTINCT t.name) AS tags
    FROM games g
    JOIN categories c ON c.id = g.category_id
    LEFT JOIN game_tags gt ON gt.game_id = g.id
    LEFT JOIN tags t ON t.id = gt.tag_id AND t.status = 'active' AND t.deleted_at IS NULL
    WHERE ${where}
    GROUP BY g.id
    ORDER BY g.publish_at DESC, g.id DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, pageSize, offset).all<GameRow>()

  return context.json({
    ok: true,
    data: result.results.map(serializeGame),
    pagination: { page, pageSize, total: countRow?.total ?? 0 },
  })
})

app.get('/games/:slug', async (context) => {
  const row = await context.env.DB.prepare(`
    SELECT g.id, g.slug, g.name, g.cover_url, g.description, g.min_config, g.resource_type, g.publish_at,
           c.name AS category, GROUP_CONCAT(DISTINCT t.name) AS tags
    FROM games g
    JOIN categories c ON c.id = g.category_id
    LEFT JOIN game_tags gt ON gt.game_id = g.id
    LEFT JOIN tags t ON t.id = gt.tag_id AND t.status = 'active' AND t.deleted_at IS NULL
    WHERE g.slug = ? AND g.status = 'published' AND g.deleted_at IS NULL
    GROUP BY g.id
  `).bind(context.req.param('slug')).first<GameRow>()

  if (!row) return context.json({ ok: false, error: { code: 'GAME_NOT_FOUND', message: '游戏不存在或已下架。' } }, 404)
  return context.json({ ok: true, data: serializeGame(row) })
})

function serializeGame(row: GameRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    cover: row.cover_url,
    description: row.description,
    minConfig: JSON.parse(row.min_config) as string[],
    resourceType: row.resource_type,
    publishAt: row.publish_at,
    category: row.category,
    tags: row.tags ? row.tags.split(',') : [],
  }
}

export default app
