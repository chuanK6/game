import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv, AuthUser } from './types'

const COOKIE_NAME = 'youlun_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7
const PASSWORD_ITERATIONS = 210_000

type UserSessionRow = {
  id: number
  username: string
  avatar_url: string | null
  role: 'user' | 'admin'
  member_type: 'none' | 'monthly' | 'lifetime'
  member_expire_at: string | null
  status: 'active' | 'disabled'
  token_hash: string
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS)
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterationsText, saltText, hashText] = encoded.split('$')
  if (algorithm !== 'pbkdf2-sha256' || !iterationsText || !saltText || !hashText) return false
  const iterations = Number(iterationsText)
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false

  const actual = await derivePassword(password, fromBase64Url(saltText), iterations)
  return constantTimeEqual(actual, fromBase64Url(hashText))
}

export async function createSession(context: Context<AppEnv>, userId: number) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256(token)

  await context.env.DB.prepare(
    "INSERT INTO sessions (user_id, token_hash, expire_at) VALUES (?, ?, datetime('now', '+7 days'))",
  ).bind(userId, tokenHash).run()

  setCookie(context, COOKIE_NAME, token, {
    httpOnly: true,
    secure: new URL(context.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
}

export async function clearSession(context: Context<AppEnv>) {
  const token = getCookie(context, COOKIE_NAME)
  if (token) {
    await context.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  }
  deleteCookie(context, COOKIE_NAME, { path: '/' })
}

export async function readSession(context: Context<AppEnv>) {
  const token = getCookie(context, COOKIE_NAME)
  if (!token) return null

  const tokenHash = await sha256(token)
  const row = await context.env.DB.prepare(`
    SELECT u.id, u.username, u.avatar_url, u.role, u.member_type, u.member_expire_at, u.status, s.token_hash
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND datetime(s.expire_at) > datetime('now') AND u.deleted_at IS NULL
  `).bind(tokenHash).first<UserSessionRow>()

  if (!row || row.status !== 'active') {
    await context.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
    deleteCookie(context, COOKIE_NAME, { path: '/' })
    return null
  }

  await context.env.DB.prepare(
    "UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND datetime(last_seen_at) < datetime('now', '-15 minutes')",
  ).bind(tokenHash).run()

  return { user: serializeUser(row), tokenHash }
}

export function serializeUser(row: Pick<UserSessionRow, 'id' | 'username' | 'avatar_url' | 'role' | 'member_type' | 'member_expire_at'>): AuthUser {
  const expireAt = row.member_expire_at ? parseStoredDate(row.member_expire_at) : Number.NaN
  const isMember = row.member_type === 'lifetime'
    || (row.member_type === 'monthly' && Number.isFinite(expireAt) && expireAt > Date.now())

  return {
    id: row.id,
    username: row.username,
    avatarUrl: row.avatar_url,
    role: row.role,
    memberType: isMember ? row.member_type : 'none',
    memberExpireAt: row.member_expire_at,
    isMember,
  }
}

function parseStoredDate(value: string) {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  return Date.parse(hasTimezone ? normalized : `${normalized}Z`)
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toBase64Url(new Uint8Array(digest))
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const saltBuffer = Uint8Array.from(salt).buffer
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations }, key, 256)
  return new Uint8Array(bits)
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}
