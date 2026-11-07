import MarkdownIt from 'markdown-it'

export const SITE_ORIGIN = 'https://youlang.cc.cd'
export const HOME_TITLE = '游浪 - PC 游戏资源库'
export const HOME_DESCRIPTION = '游浪 PC 游戏资源库，发现、筛选和获取优质游戏资源。'
export const DESCRIPTION_LIMIT = 160

export type SeoMetadata = {
  title: string
  description: string
  canonical: string | null
  robots: 'index, follow' | 'noindex, follow'
}

const markdown = new MarkdownIt({ html: false, linkify: false })

// Use Markdown tokens so headings, links, images and tables do not leave markup in snippets.
export function gameDescription(source: string, format: 'plain' | 'markdown' = 'plain') {
  let text = source
  if (format === 'markdown') {
    text = markdown.parse(source, {}).flatMap(token => {
      if (token.type !== 'inline') return []
      return [(token.children ?? []).map(child => {
        if (child.type === 'text' || child.type === 'code_inline') return child.content
        if (child.type === 'softbreak' || child.type === 'hardbreak') return ' '
        return ''
      }).join('')]
    }).join(' ')
  }
  text = text.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim()
  const characters = Array.from(text)
  return characters.length > DESCRIPTION_LIMIT
    ? `${characters.slice(0, DESCRIPTION_LIMIT - 1).join('')}…`
    : text || HOME_DESCRIPTION
}

export function gameMetadata(game: { name: string; slug: string; description: string; descriptionFormat: 'plain' | 'markdown' }): SeoMetadata {
  return {
    title: `${game.name}｜游浪`,
    description: gameDescription(game.description, game.descriptionFormat),
    canonical: `${SITE_ORIGIN}/games/${encodeURIComponent(game.slug)}`,
    robots: 'index, follow',
  }
}

export function pageMetadata(path: string, query = new URLSearchParams()): SeoMetadata {
  if (path === '/') return { title: HOME_TITLE, description: HOME_DESCRIPTION, canonical: `${SITE_ORIGIN}/`, robots: 'index, follow' }
  if (path === '/games') {
    const page = query.get('page') ?? '1'
    const validPage = /^[1-9]\d*$/.test(page) && Number(page) <= 100000
    let filtered = query.getAll('page').length > 1
    query.forEach((_value, key) => { if (key !== 'page') filtered = true })
    const indexable = validPage && !filtered
    return {
      title: indexable && Number(page) > 1 ? `全部游戏 - 第 ${Number(page)} 页｜游浪` : '全部游戏｜游浪',
      description: '浏览游浪 PC 游戏资源，按年份、分类和标签筛选游戏，查看游戏介绍与最低配置。',
      canonical: `${SITE_ORIGIN}/games${indexable && Number(page) > 1 ? `?page=${Number(page)}` : ''}`,
      robots: indexable ? 'index, follow' : 'noindex, follow',
    }
  }
  const titles: Record<string, string> = {
    '/auth': '登录与注册｜游浪', '/profile': '个人中心｜游浪', '/feedback': '问题反馈｜游浪', '/admin': '管理后台｜游浪',
  }
  return {
    title: titles[path] ?? (/^\/games\/[^/]+$/.test(path) ? '游戏详情｜游浪' : '页面不存在｜游浪'),
    description: HOME_DESCRIPTION,
    canonical: null,
    robots: 'noindex, follow',
  }
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
