import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, authApi, type CurrentUser } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<CurrentUser | null>(null)
  const initialized = ref(false)
  let restorePromise: Promise<void> | null = null
  let sessionVersion = 0

  const isLoggedIn = computed(() => user.value !== null)
  const isMember = computed(() => user.value?.isMember ?? false)
  const isAdmin = computed(() => user.value?.role === 'admin')

  function restore() {
    if (initialized.value) return Promise.resolve()
    if (restorePromise) return restorePromise
    const version = sessionVersion
    restorePromise = authApi.me()
      .then((currentUser) => {
        if (version !== sessionVersion) return
        user.value = currentUser
        initialized.value = true
      })
      .catch((error: unknown) => {
        if (version !== sessionVersion) return
        if (!(error instanceof ApiError) || error.status !== 401) throw error
        user.value = null
        initialized.value = true
      })
      .finally(() => {
        restorePromise = null
      })
    return restorePromise
  }

  async function confirmLogin(result: CurrentUser) {
    const version = ++sessionVersion
    user.value = null
    initialized.value = false
    const currentUser = await authApi.me()
    if (version !== sessionVersion) return
    if (!currentUser || currentUser.id !== result.id) {
      initialized.value = true
      throw new ApiError('SESSION_NOT_PERSISTED', '登录会话未能保存，请允许此网站使用 Cookie 后重试。', 401)
    }
    user.value = currentUser
    initialized.value = true
  }

  async function login(username: string, password: string) {
    await confirmLogin(await authApi.login(username, password))
  }

  async function register(username: string, password: string) {
    await confirmLogin(await authApi.register(username, password))
  }

  async function logout() {
    try {
      await authApi.logout()
    } finally {
      sessionVersion += 1
      user.value = null
      initialized.value = true
    }
  }

  async function refresh() {
    user.value = await authApi.me()
    sessionVersion += 1
    initialized.value = true
  }

  return { user, initialized, isLoggedIn, isMember, isAdmin, restore, login, register, logout, refresh }
})
