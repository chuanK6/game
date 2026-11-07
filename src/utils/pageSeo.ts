import type { SeoMetadata } from './seo'

export function setPageMetadata(metadata: SeoMetadata) {
  document.title = metadata.title
  for (const [name, content] of [['description', metadata.description], ['robots', metadata.robots]]) {
    let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
    if (!element) {
      element = document.createElement('meta')
      element.name = name!
      document.head.append(element)
    }
    element.content = content!
  }
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!metadata.canonical) canonical?.remove()
  else {
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.append(canonical)
    }
    canonical.href = metadata.canonical
  }
}
