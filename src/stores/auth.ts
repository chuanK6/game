import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, authApi, type CurrentUser } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<CurrentUser | null>(null)
  const initialized = ref(false)
  let restorePromise: Promise<void> | null = null

  const isLoggedIn = computed(() => user.value !== null)
  const isMember = computed(() => user.value?.isMember ?? false)
  const isAdmin = computed(() => user.value?.role === 'admin')

  function restore() {
    if (initialized.value) return Promise.resolve()
    if (restorePromise) return restorePromise
    restorePromise = authApi.me()
      .then((currentUser) => { user.value = currentUser })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 401) throw error
        user.value = null
      })
      .finally(() => {
        initialized.value = true
        restorePromise = null
      })
    return restorePromise
  }

  async function login(username: string, password: string) {
    user.value = await authApi.login(username, password)
    initialized.value = true
  }

  async function register(username: string, password: string) {
    user.value = await authApi.register(username, password)
    initialized.value = true
  }

  async function logout() {
    try {
      await authApi.logout()
    } finally {
      user.value = null
      initialized.value = true
    }
  }

  async function refresh() {
    user.value = await authApi.me()
    initialized.value = true
  }

  return { user, initialized, isLoggedIn, isMember, isAdmin, restore, login, register, logout, refresh }
})
