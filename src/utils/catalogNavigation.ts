let renderedPath = ''
let ready = false
const waiters = new Set<{ path: string; resolve: (ready: boolean) => void }>()
const positions = new Map<string, number>()

export function rememberCatalogPosition(path: string, top: number) {
  positions.delete(path)
  positions.set(path, top)
  while (positions.size > 12) positions.delete(positions.keys().next().value!)
}
export const catalogPosition = (path: string) => positions.get(path) ?? 0
export function beginCatalogRender(path: string) { renderedPath = path; ready = false }
export function finishCatalogRender(path: string) {
  if (renderedPath !== path) return
  ready = true
  for (const waiter of waiters) if (waiter.path === path) waiter.resolve(true)
}
export function cancelCatalogScroll() {
  for (const waiter of waiters) waiter.resolve(false)
}
export function waitForCatalogRender(path: string) {
  if (ready && renderedPath === path) return Promise.resolve(true)
  return new Promise<boolean>(resolve => {
    const waiter = { path, resolve: (value: boolean) => { window.clearTimeout(timer); waiters.delete(waiter); resolve(value) } }
    const timer = window.setTimeout(() => waiter.resolve(false), 16000)
    waiters.add(waiter)
  })
}
