import { computed, onScopeDispose, ref, watchEffect } from 'vue'
import { defineStore } from 'pinia'

type Theme = 'light' | 'dark'
const STORAGE_KEY = 'youlun-theme'

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export const useThemeStore = defineStore('theme', () => {
  const preference = ref<Theme | null>(storedTheme())
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(media.matches)
  const isDark = computed(() => preference.value ? preference.value === 'dark' : systemDark.value)

  watchEffect(() => {
    document.documentElement.classList.toggle('dark', isDark.value)
    document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark.value ? '#0d1520' : '#0788c7')
  })

  function toggle() {
    preference.value = isDark.value ? 'light' : 'dark'
    try { localStorage.setItem(STORAGE_KEY, preference.value) } catch { /* Still works for this visit when storage is unavailable. */ }
  }

  function syncSystem(event: MediaQueryListEvent) { systemDark.value = event.matches }
  function syncStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY || event.key === null) preference.value = storedTheme()
  }
  media.addEventListener('change', syncSystem)
  window.addEventListener('storage', syncStorage)
  onScopeDispose(() => {
    media.removeEventListener('change', syncSystem)
    window.removeEventListener('storage', syncStorage)
  })

  return { isDark, toggle }
})
