<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Menu, Search, UserRound, X } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const keyword = ref('')
const mobileOpen = ref(false)

function search() {
  const value = keyword.value.trim()
  router.push({ name: 'games', query: value ? { q: value } : {} })
  mobileOpen.value = false
}

function closeMenu() {
  mobileOpen.value = false
}
</script>

<template>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink to="/" class="brand" aria-label="游浪首页" @click="closeMenu">
        <img src="/assets/brand/logo.png" alt="游浪" />
      </RouterLink>

      <nav :class="['main-nav', { open: mobileOpen }]" aria-label="主导航">
        <RouterLink to="/" @click="closeMenu">首页</RouterLink>
        <RouterLink to="/games" @click="closeMenu">全部游戏</RouterLink>
        <RouterLink to="/feedback" @click="closeMenu">留言板</RouterLink>
        <RouterLink v-if="auth.isAdmin" to="/admin" @click="closeMenu">管理后台</RouterLink>
      </nav>

      <div class="header-actions">
        <form class="header-search" role="search" @submit.prevent="search">
          <Search :size="17" aria-hidden="true" />
          <input v-model="keyword" aria-label="搜索游戏" placeholder="搜索游戏" />
        </form>
        <RouterLink v-if="!auth.isLoggedIn" to="/auth" class="button button-primary button-small">
          <UserRound :size="17" />
          登录
        </RouterLink>
        <RouterLink v-else to="/profile" class="user-entry" aria-label="进入个人中心">
          <span class="avatar">{{ auth.user?.username.slice(0, 1).toUpperCase() }}</span>
          <span>{{ auth.user?.username }}</span>
        </RouterLink>
        <button class="icon-button menu-button" :aria-label="mobileOpen ? '关闭导航' : '打开导航'" @click="mobileOpen = !mobileOpen">
          <X v-if="mobileOpen" :size="22" />
          <Menu v-else :size="22" />
        </button>
      </div>
    </div>
  </header>
</template>
