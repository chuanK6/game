// Older mobile browsers have AbortController but lack AbortSignal.any/timeout.
export async function withRequestTimeout<T>(request: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (parent?.aborted) cancel()
  else parent?.addEventListener('abort', cancel, { once: true })
  const timer = window.setTimeout(() => controller.abort(), milliseconds)
  try {
    return await request(controller.signal)
  } catch (error) {
    if (controller.signal.aborted && !parent?.aborted) throw new DOMException('请求超时，请重试。', 'TimeoutError')
    throw error
  } finally {
    window.clearTimeout(timer)
    parent?.removeEventListener('abort', cancel)
  }
}
