import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './types'

export const announcementSchema = z.object({
  title: z.string().trim().min(1).max(100),
  content: z.string().min(1).max(30000).refine(value => value.trim().length > 0),
  status: z.enum(['draft', 'published', 'archived']),
  showPopup: z.boolean(),
}).strict()

export const announcementQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  showPopup: z.enum(['0', '1']).optional(),
})

// Public readers can only access published announcements, including direct IDs.
const announcements = new Hono<AppEnv>()
announcements.get('/latest', async context => {
  const popup = context.req.query('popup')
  if (popup !== undefined && popup !== '1') return context.json({ ok: false, error: { code: 'INVALID_QUERY', message: '公告查询参数无效。' } }, 400)
  const row = await context.env.DB.prepare(`SELECT * FROM announcements WHERE status = 'published'
    ${popup === '1' ? 'AND show_popup = 1' : ''} ORDER BY created_at DESC, id DESC LIMIT 1`).first()
  return context.json({ ok: true, data: row })
})
announcements.get('/', async context => {
  const parsed = z.object({ page: announcementQuerySchema.shape.page }).safeParse(context.req.query())
  if (!parsed.success) return context.json({ ok: false, error: { code: 'INVALID_QUERY', message: '公告分页参数无效。' } }, 400)
  const count = await context.env.DB.prepare("SELECT COUNT(*) AS total FROM announcements WHERE status = 'published'").first<{ total: number }>()
  const total = count?.total ?? 0
  const pageSize = 10
  const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / pageSize)))
  const result = await context.env.DB.prepare(`SELECT id, title, created_at, updated_at FROM announcements
    WHERE status = 'published' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(pageSize, (page - 1) * pageSize).all()
  return context.json({ ok: true, data: { items: result.results, pagination: { page, pageSize, total } } })
})
announcements.get('/:id', async context => {
  const id = z.coerce.number().int().positive().safeParse(context.req.param('id'))
  if (!id.success) return context.json({ ok: false, error: { code: 'INVALID_ID', message: '公告 ID 无效。' } }, 400)
  const row = await context.env.DB.prepare("SELECT * FROM announcements WHERE id = ? AND status = 'published'").bind(id.data).first()
  if (!row) return context.json({ ok: false, error: { code: 'ANNOUNCEMENT_NOT_FOUND', message: '公告不存在或未发布。' } }, 404)
  return context.json({ ok: true, data: row })
})
export default announcements
