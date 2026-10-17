import { Hono, type Context } from 'hono'
import type { AppEnv } from './types'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_REQUEST_SIZE = MAX_IMAGE_SIZE + 64 * 1024
const CACHE_CONTROL = 'public, max-age=31536000, immutable'
const IMAGE_KEY = /^images\/(cover|content)\/\d{4}\/\d{2}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/

function failure(context: Context<AppEnv>, status: 400 | 413 | 415 | 503, code: string, message: string) {
  return context.json({ ok: false as const, error: { code, message } }, status)
}

function imageFormat(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return { mime: 'image/png', ext: 'png' }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

// Mounted behind the existing admin authorization middleware.
export async function uploadImage(context: Context<AppEnv>) {
  if (!context.env.MEDIA) return failure(context, 503, 'STORAGE_UNAVAILABLE', '图片存储尚未配置。')
  const contentType = context.req.header('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) return failure(context, 400, 'INVALID_UPLOAD', '请使用图片文件上传。')
  const reader = context.req.raw.body?.getReader()
  if (!reader) return failure(context, 400, 'EMPTY_UPLOAD', '请选择图片。')
  // Count actual streamed bytes, including requests without Content-Length.
  const chunks: ArrayBuffer[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_REQUEST_SIZE) {
        await reader.cancel()
        return failure(context, 413, 'IMAGE_TOO_LARGE', '图片大小不能超过 5 MB。')
      }
      chunks.push(chunk.value.slice().buffer)
    }
  } finally {
    reader.releaseLock()
  }
  let form: FormData
  try {
    form = await new Response(new Blob(chunks), { headers: { 'Content-Type': contentType } }).formData()
  } catch {
    return failure(context, 400, 'INVALID_UPLOAD', '图片上传数据无效。')
  }
  const file = form.get('file')
  const purpose = form.get('purpose')
  if (!(file instanceof File) || form.getAll('file').length !== 1 || !file.size) return failure(context, 400, 'EMPTY_UPLOAD', '请选择一张有效图片。')
  if (purpose !== 'cover' && purpose !== 'content') return failure(context, 400, 'INVALID_PURPOSE', '图片用途无效。')
  if (file.size > MAX_IMAGE_SIZE) return failure(context, 413, 'IMAGE_TOO_LARGE', '图片大小不能超过 5 MB。')
  const format = imageFormat(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
  if (!format || format.mime !== file.type) return failure(context, 415, 'INVALID_IMAGE', '仅支持有效的 JPG、PNG、WebP 图片。')
  const now = new Date()
  const key = `images/${purpose}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${format.ext}`
  await context.env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: format.mime, cacheControl: CACHE_CONTROL },
    customMetadata: { uploadedBy: String(context.get('user').id) },
  })
  const hostname = new URL(context.req.url).hostname
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  const publicBase = context.env.MEDIA_PUBLIC_URL?.replace(/\/+$/, '')
  const url = !local && publicBase ? `${publicBase}/${key}` : `/api/media/${key}`
  return context.json({ ok: true, data: { key, url } }, 201)
}

const media = new Hono<AppEnv>()
media.on(['GET', 'HEAD'], '/*', async (context) => {
  const key = context.req.path.slice('/api/media/'.length)
  if (!IMAGE_KEY.test(key)) return context.notFound()
  const object = context.req.method === 'HEAD' ? await context.env.MEDIA.head(key) : await context.env.MEDIA.get(key)
  if (!object) return context.notFound()
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Cache-Control', CACHE_CONTROL)
  headers.set('X-Content-Type-Options', 'nosniff')
  const tags = context.req.header('If-None-Match')?.split(',').map((tag) => tag.trim().replace(/^W\//, '')) ?? []
  if (tags.includes('*') || tags.includes(object.httpEtag)) return new Response(null, { status: 304, headers })
  headers.set('Content-Length', String(object.size))
  return new Response(context.req.method === 'HEAD' ? null : (object as R2ObjectBody).body, { headers })
})

export default media
