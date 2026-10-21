export type ResourceType = 'free' | 'member'

export interface Taxonomy {
  id?: number
  name: string
  slug: string
}

export interface DownloadSource {
  provider: string
  label: string
  url: string
}

export type DescriptionFormat = 'plain' | 'markdown'

export interface GameSummary {
  isPinned: boolean
  id: number
  slug: string
  name: string
  cover: string
  category: Taxonomy
  tags: Taxonomy[]
  resourceType: ResourceType
  resourceStatus: 'available' | 'checking' | 'unavailable'
  publishAt: string
}

export interface Game extends GameSummary {
  description: string
  descriptionFormat: DescriptionFormat
  minConfig: string[]
}
