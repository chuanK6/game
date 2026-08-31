export type ResourceType = 'free' | 'member'

export interface DownloadSource {
  provider: string
  label: string
  url: string
}

export interface Game {
  id: number
  slug: string
  name: string
  cover: string
  category: string
  tags: string[]
  description: string
  minConfig: string[]
  resourceType: ResourceType
  publishAt: string
  downloads: DownloadSource[]
}
