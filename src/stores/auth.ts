import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type MemberType = 'none' | 'monthly' | 'lifetime'

export interface CurrentUser {
  username: string
  avatarUrl?: string
  memberType: MemberType
  memberExpireAt?: string
  role: 'user' | 'admin'
}

const STORAGE_KEY = 'youlun-demo-user'

export const useAuthStore = defineStore('auth', () => {
  const stored = localStorage.getItem(STORAGE_KEY)
  const user = ref<CurrentUser | null>(stored ? JSON.parse(stored) : null)
  const isLoggedIn = computed(() => user.value !== null)
  const isMember = computed(() => user.value?.memberType !== 'none' && user.value !== null)

  function login(username: string) {
    user.value = { username, memberType: 'none', role: 'user' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user.value))
  }

  function logout() {
    user.value = null
    localStorage.removeItem(STORAGE_KEY)
  }

  return { user, isLoggedIn, isMember, login, logout }
})
