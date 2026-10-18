import type { AdminGameDetail, GamePayload } from '@/api/client'

export const CONFIG_FIELDS = [
  { key: 'os', label: '操作系统', placeholder: 'Windows 10 / 11 64 位' },
  { key: 'cpu', label: '处理器', placeholder: 'Intel Core i5-8400 / AMD Ryzen 5 2600' },
  { key: 'memory', label: '内存', placeholder: '8 GB RAM' },
  { key: 'gpu', label: '显卡', placeholder: 'NVIDIA GTX 1060 / AMD RX 580' },
  { key: 'storage', label: '存储空间', placeholder: '45 GB 可用空间' },
  { key: 'other', label: '其他说明', placeholder: 'DirectX 版本、网络要求等' },
] as const
export type ConfigKey = typeof CONFIG_FIELDS[number]['key']
export type ConfigFields = Record<ConfigKey, string>
export type EditorTab = 'basic' | 'introduction' | 'requirements' | 'downloads'
export type GameForm = Omit<GamePayload, 'minConfig' | 'downloads'> & { id?: number; config: ConfigFields; downloads: Array<GamePayload['downloads'][number] & { key: string }> }
export type FormIssue = { tab: EditorTab; field: string; message: string }
export const blankDownload = () => ({ key: crypto.randomUUID(), provider: '', label: '', url: '', sort: 0 })
export const hasDownload = (row: GamePayload['downloads'][number]) => Boolean(row.provider.trim() || row.label.trim() || row.url.trim())

export function configFromLines(lines: string[]): ConfigFields {
  const fields: ConfigFields = { os: '', cpu: '', memory: '', gpu: '', storage: '', other: '' }
  for (const line of lines) {
    const separator = line.search(/[:：]/)
    const label = separator < 0 ? '' : line.slice(0, separator).trim().toLowerCase()
    const key: ConfigKey = label.includes('操作系统') ? 'os' : label.includes('处理器') || label.includes('cpu') ? 'cpu'
      : label.includes('内存') ? 'memory' : label.includes('显卡') || label.includes('gpu') ? 'gpu'
        : label.includes('存储') || label.includes('硬盘') ? 'storage' : 'other'
    const value = separator < 0 || (key === 'other' && label !== '其他说明') ? line : line.slice(separator + 1).trim()
    fields[key] = [fields[key], value].filter(Boolean).join('\n')
  }
  return fields
}

export function createGameForm(game: AdminGameDetail | null): GameForm {
  return {
    id: game?.id, name: game?.name ?? '', slug: game?.slug ?? '', coverUrl: game?.cover_url ?? '',
    description: game?.description ?? '', descriptionFormat: game ? game.description_format ?? 'plain' : 'markdown',
    config: configFromLines(game ? JSON.parse(game.min_config) : []), categoryId: game?.category_id ?? 0,
    resourceType: game?.resource_type ?? 'free', resourceStatus: game?.resource_status ?? 'available', status: game?.status ?? 'draft',
    publishAt: game ? game.publish_at?.slice(0, 10) ?? null : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()),
    tagIds: [...(game?.tagIds ?? [])],
    downloads: game?.downloads.length ? game.downloads.map(row => ({ ...row, key: crypto.randomUUID() })) : [blankDownload()],
  }
}

export const configToLines = (config: ConfigFields) => CONFIG_FIELDS.map(field => config[field.key].trim() ? `${field.label}：${config[field.key].trim()}` : '').filter(Boolean)
const validUrl = (value: string) => { try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false } }

export function gameFormIssues(form: GameForm): FormIssue[] {
  const issues: FormIssue[] = []
  const add = (tab: EditorTab, field: string, message: string) => issues.push({ tab, field, message })
  if (!form.name.trim() || form.name.trim().length > 100) add('basic', 'game-name', '请输入 1～100 字符的游戏名称')
  if (form.slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) add('basic', 'game-slug', 'Slug 请使用小写字母、数字和连字符')
  if (!form.coverUrl.trim() || form.coverUrl.length > 1000 || (!validUrl(form.coverUrl.trim()) && !/^\/(?!\/)/.test(form.coverUrl.trim()))) add('basic', 'game-cover', '请上传封面，或填写有效的图片地址')
  if (!Number.isInteger(form.categoryId) || form.categoryId <= 0) add('basic', 'game-category', '请选择游戏分类')
  if (form.publishAt && (!/^\d{4}-\d{2}-\d{2}$/.test(form.publishAt) || Number.isNaN(Date.parse(form.publishAt)))) add('basic', 'game-publish', '请填写有效的发布日期')
  if (form.description.trim().length < 10 || form.description.length > 30000) add('introduction', 'game-description', '游戏介绍须为 10～30000 字符')
  if (!configToLines(form.config).length) add('requirements', 'config-os', '请至少填写一项最低配置')
  for (const field of CONFIG_FIELDS) if (`${field.label}：${form.config[field.key].trim()}`.length > 200) add('requirements', `config-${field.key}`, `${field.label}内容过长，请控制在 ${199 - field.label.length} 字符内`)
  if (form.tagIds.length > 20) add('downloads', 'game-tags', '最多选择 20 个标签')
  for (const row of form.downloads) {
    if (!hasDownload(row)) continue
    if (!row.provider.trim() || row.provider.trim().length > 50) add('downloads', `provider-${row.key}`, '请填写网盘名称，最多 50 字符')
    if (!row.label.trim() || row.label.trim().length > 100) add('downloads', `label-${row.key}`, '请填写资源说明，最多 100 字符')
    if (!validUrl(row.url.trim()) || row.url.length > 2000) add('downloads', `url-${row.key}`, '请填写有效的 HTTP / HTTPS 下载地址')
  }
  return issues
}

export function gamePayload(form: GameForm): GamePayload {
  return {
    name: form.name.trim(), slug: form.slug, coverUrl: form.coverUrl.trim(), description: form.description,
    descriptionFormat: form.descriptionFormat, minConfig: configToLines(form.config), categoryId: form.categoryId,
    resourceType: form.resourceType, resourceStatus: form.resourceStatus, status: form.status, publishAt: form.publishAt || null,
    tagIds: [...form.tagIds], downloads: form.downloads.filter(hasDownload).map((row, index) => ({ provider: row.provider.trim(), label: row.label.trim(), url: row.url.trim(), sort: index * 10 })),
  }
}
