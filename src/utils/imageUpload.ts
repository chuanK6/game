import { adminApi } from '@/api/client'
import { withRequestTimeout } from './requestTimeout'

export async function prepareImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('仅支持 JPG、PNG、WebP 图片')
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('图片大小须在 0～5 MB 之间')
  // Keep WebP animations intact. JPEG/PNG screenshots can be downscaled locally.
  if (file.type === 'image/webp' || typeof createImageBitmap !== 'function') return file
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error('图片无法读取，请选择有效的图片文件') }
  try {
    if (Math.max(bitmap.width, bitmap.height) <= 1920 && file.size <= 1024 * 1024) return file
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
    return blob && blob.size < file.size ? new File([blob], 'image.webp', { type: 'image/webp' }) : file
  } finally { bitmap.close() }
}

export async function uploadImage(file: File, purpose: 'cover' | 'content', signal?: AbortSignal) {
  const prepared = await prepareImage(file)
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')
  return withRequestTimeout(active => adminApi.uploadImage(prepared, purpose, active), 60000, signal)
}
