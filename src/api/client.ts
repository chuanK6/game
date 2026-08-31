import type { DownloadSource, Game, Taxonomy } from '@/types/game'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
  }
}

type SuccessResponse<T> = { ok: true; data: T }
type PaginatedResponse<T> = SuccessResponse<T> & { pagination: Pagination }
type ErrorResponse = { ok: false; error: { code: string; message: string } }

export type Pagination = { page: number; pageSize: number; total: number }

export type CurrentUser = {
  id: number
  username: string
  avatarUrl: string | null
  role: 'user' | 'admin'
  memberType: 'none' | 'monthly' | 'lifetime'
  memberExpireAt: string | null
  isMember: boolean
}

export type FeedbackItem = {
  id: number
  type: 'add_game' | 'resource_invalid' | 'website' | 'other'
  title: string
  content: string
  status: 'pending' | 'processing' | 'resolved' | 'closed'
  admin_reply: string | null
  created_at: string
  handled_at: string | null
  game_name: string | null
  game_slug: string | null
}

export type MembershipOrder = {
  id: number
  plan: 'monthly' | 'lifetime'
  payment_channel: 'wechat' | 'alipay'
  status: 'pending' | 'approved' | 'rejected'
  user_note: string | null
  admin_note: string | null
  submitted_at: string
  reviewed_at: string | null
}

export type AdminOverview = { users: number; games: number; pendingOrders: number; openFeedback: number }
export type AdminUser = {
  id: number; username: string; role: 'user' | 'admin'; status: 'active' | 'disabled'
  member_type: 'none' | 'monthly' | 'lifetime'; member_expire_at: string | null; created_at: string
}
export type AdminOrder = MembershipOrder & { user_id: number; username: string }
export type AdminFeedback = FeedbackItem & { username: string }
export type AdminGame = {
  id: number; name: string; slug: string; cover_url: string; resource_type: 'free' | 'member'
  resource_status: 'available' | 'checking' | 'unavailable'; status: 'draft' | 'published' | 'offline'
  publish_at: string | null; category: string
}
export type AdminGameDetail = {
  id: number; name: string; slug: string; cover_url: string; description: string; min_config: string
  category_id: number; resource_type: 'free' | 'member'; resource_status: 'available' | 'checking' | 'unavailable'
  status: 'draft' | 'published' | 'offline'; publish_at: string | null; tagIds: number[]; downloads: Array<DownloadSource & { sort: number }>
}
export type AdminTaxonomy = Taxonomy & {
  id: number
  status: 'active' | 'disabled'
  sort: number
}
export type TaxonomyPayload = {
  name: string
  slug: string
  status: AdminTaxonomy['status']
  sort?: number
}
export type GamePayload = {
  name: string; slug: string; coverUrl: string; description: string; minConfig: string[]; categoryId: number
  resourceType: 'free' | 'member'; resourceStatus: 'available' | 'checking' | 'unavailable'
  status: 'draft' | 'published' | 'offline'; publishAt: string | null; tagIds: number[]
  downloads: Array<DownloadSource & { sort: number }>
}

export async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  })
  const payload = await response.json() as SuccessResponse<T> | ErrorResponse
  if (!response.ok || !payload.ok) {
    const error = payload.ok ? { code: 'REQUEST_FAILED', message: '请求失败。' } : payload.error
    throw new ApiError(error.code, error.message, response.status)
  }
  return payload.data
}

export async function getGames(query: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const response = await fetch(`${API_BASE}/games?${params}`, { credentials: 'include' })
  const payload = await response.json() as PaginatedResponse<Game[]> | ErrorResponse
  if (!response.ok || !payload.ok) {
    const error = payload.ok ? { code: 'REQUEST_FAILED', message: '游戏列表加载失败。' } : payload.error
    throw new ApiError(error.code, error.message, response.status)
  }
  return { games: payload.data, pagination: payload.pagination }
}

export const catalogApi = {
  categories: () => apiRequest<Taxonomy[]>('/categories'),
  tags: () => apiRequest<Taxonomy[]>('/tags'),
  game: (slug: string) => apiRequest<Game>(`/games/${encodeURIComponent(slug)}`),
  downloads: (slug: string) => apiRequest<DownloadSource[]>(`/games/${encodeURIComponent(slug)}/downloads`),
}

export const authApi = {
  me: () => apiRequest<CurrentUser | null>('/auth/me'),
  login: (username: string, password: string) => apiRequest<CurrentUser>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) => apiRequest<CurrentUser>('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => apiRequest<null>('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) => apiRequest<null>('/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }),
}

export const feedbackApi = {
  create: (payload: { type: FeedbackItem['type']; title: string; content: string; gameSlug?: string }) => apiRequest<{ id: number; status: string }>('/feedback', { method: 'POST', body: JSON.stringify(payload) }),
  mine: () => apiRequest<FeedbackItem[]>('/feedback/mine'),
}

export const membershipApi = {
  createOrder: (plan: MembershipOrder['plan'], paymentChannel: MembershipOrder['payment_channel']) => apiRequest<{ id: number; status: string }>('/membership/orders', { method: 'POST', body: JSON.stringify({ plan, paymentChannel }) }),
  orders: () => apiRequest<MembershipOrder[]>('/membership/orders'),
}

export const adminApi = {
  overview: () => apiRequest<AdminOverview>('/admin/overview'),
  users: () => apiRequest<AdminUser[]>('/admin/users'),
  updateUser: (id: number, payload: { status?: AdminUser['status']; role?: AdminUser['role']; memberType?: AdminUser['member_type']; memberExpireAt?: string | null }) => apiRequest<null>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  orders: () => apiRequest<AdminOrder[]>('/admin/orders'),
  reviewOrder: (id: number, status: 'approved' | 'rejected', adminNote = '') => apiRequest<null>(`/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status, adminNote }) }),
  feedback: () => apiRequest<AdminFeedback[]>('/admin/feedback'),
  updateFeedback: (id: number, status: FeedbackItem['status'], adminReply: string) => apiRequest<null>(`/admin/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status, adminReply }) }),
  games: () => apiRequest<AdminGame[]>('/admin/games'),
  game: (id: number) => apiRequest<AdminGameDetail>(`/admin/games/${id}`),
  createGame: (payload: GamePayload) => apiRequest<{ id: number }>('/admin/games', { method: 'POST', body: JSON.stringify(payload) }),
  updateGame: (id: number, payload: GamePayload) => apiRequest<null>(`/admin/games/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteGame: (id: number) => apiRequest<null>(`/admin/games/${id}`, { method: 'DELETE' }),
  categories: () => apiRequest<AdminTaxonomy[]>('/admin/categories'),
  tags: () => apiRequest<AdminTaxonomy[]>('/admin/tags'),
  createTaxonomy: (kind: 'categories' | 'tags', payload: TaxonomyPayload) => apiRequest<{ id: number }>(`/admin/${kind}`, { method: 'POST', body: JSON.stringify(payload) }),
  updateTaxonomy: (kind: 'categories' | 'tags', id: number, payload: TaxonomyPayload) => apiRequest<null>(`/admin/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTaxonomy: (kind: 'categories' | 'tags', id: number) => apiRequest<null>(`/admin/${kind}/${id}`, { method: 'DELETE' }),
}
