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

export interface Game {
  id: number
  slug: string
  name: string
  cover: string
  category: Taxonomy
  tags: Taxonomy[]
  description: string
  minConfig: string[]
  resourceType: ResourceType
  resourceStatus: 'available' | 'checking' | 'unavailable'
  publishAt: string
}
