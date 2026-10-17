import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
const safeImageUrl = (value: string) => /^(https?:\/\/|\/(?!\/))/i.test(value) && !/[\u0000-\u0020\\]/.test(value)
markdown.validateLink = (url: string) => safeImageUrl(url) || /^#[\w-]*$/.test(url)
const defaultImage = markdown.renderer.rules.image!
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index]!
  if (!safeImageUrl(String(token.attrGet('src') ?? ''))) return markdown.utils.escapeHtml(token.content)
  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  token.attrSet('tabindex', '0')
  token.attrSet('role', 'button')
  token.attrSet('aria-label', `放大图片：${token.content || '游戏截图'}`)
  return defaultImage(tokens, index, options, env, renderer)
}
const defaultLink = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index]!.attrSet('target', '_blank')
  tokens[index]!.attrSet('rel', 'noopener noreferrer')
  return defaultLink ? defaultLink(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options)
}

export function renderMarkdown(source: string) {
  return DOMPurify.sanitize(markdown.render(source), {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'blockquote', 'ul', 'ol', 'li', 'hr', 'a', 'img', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel', 'loading', 'decoding', 'tabindex', 'role', 'start'],
    ALLOW_DATA_ATTR: false,
  })
}

// Escape every Markdown punctuation character, preserving original line breaks.
export function plainToMarkdown(source: string) {
  return source.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/([\\`*_{}\[\]()#+\-.!|><~=&])/g, '\\$1').replace(/^ +/g, (spaces) => '&#32;'.repeat(spaces.length)).replace(/^\t+/g, (tabs) => '&#9;'.repeat(tabs.length))).join('\n')
}
