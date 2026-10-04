import { ref } from 'vue'
import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

export const navigationPending = ref(false)
export const navigationError = ref('')
let pendingRoute: RouteLocationNormalized | undefined

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return { ...savedPosition, behavior: 'instant' }
    if (to.hash) return { el: to.hash, top: 92, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }
    // Keep filters and profile tabs in place; only a new page resets the scroll.
    if (to.path === from.path) return false
    return { top: 0, behavior: 'instant' }
  },
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    { path: '/games', name: 'games', component: () => import('@/views/GamesView.vue') },
    { path: '/games/:slug', name: 'game-detail', component: () => import('@/views/GameDetailView.vue') },
    { path: '/auth', name: 'auth', component: () => import('@/views/AuthView.vue') },
    { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue'), meta: { requiresAuth: true } },
    { path: '/feedback', name: 'feedback', component: () => import('@/views/FeedbackView.vue'), meta: { requiresAuth: true } },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  pendingRoute = to
  navigationPending.value = true
  navigationError.value = ''
  const auth = useAuthStore()
  if (!to.meta.requiresAuth && to.name !== 'auth') {
    // Public navigation must not wait for a slow session request.
    void auth.restore().catch(() => { /* Protected routes will offer a retry on failure. */ })
    return
  }
  try {
    await auth.restore()
  } catch {
    if (pendingRoute === to) navigationError.value = '登录状态暂时无法确认，请稍后再次点击导航。'
    return false
  }
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'auth', query: { redirect: to.fullPath } }
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) return { name: 'home' }
  if (to.name === 'auth' && auth.isLoggedIn) return { name: 'home' }
})

router.afterEach((to) => {
  if (pendingRoute === to) navigationPending.value = false
})

router.onError((_error, to) => {
  if (pendingRoute !== to) return
  navigationPending.value = false
  navigationError.value = '页面加载失败，请再次点击导航重试，或刷新页面。'
})

export default router
