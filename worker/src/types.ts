export type MemberType = 'none' | 'monthly' | 'lifetime'
export type UserRole = 'user' | 'admin'

export type Bindings = {
  DB: D1Database
  ASSETS: Fetcher
  APP_ENV: string
  ALLOWED_ORIGIN: string
}

export type AuthUser = {
  id: number
  username: string
  avatarUrl: string | null
  role: UserRole
  memberType: MemberType
  memberExpireAt: string | null
  isMember: boolean
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    user: AuthUser
    sessionTokenHash: string
  }
}

