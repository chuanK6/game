<script setup lang="ts">
import AppHeader from '@/components/AppHeader.vue'

function disableLeavingPage(element: Element) {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}

function enablePage(element: Element) {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <main class="route-stage">
      <RouterView v-slot="{ Component, route }">
        <Transition name="page" @before-leave="disableLeavingPage" @before-enter="enablePage" @leave-cancelled="enablePage">
          <div v-if="Component" :key="route.path" class="route-page">
            <component :is="Component" />
          </div>
        </Transition>
      </RouterView>
    </main>
    <footer class="site-footer">
      <div class="container footer-inner">
        <div>
          <img src="/assets/brand/logo.png" alt="游浪" class="footer-logo" />
          <p>发现值得投入时间的 PC 游戏。</p>
        </div>
        <div class="footer-links">
          <RouterLink to="/games">全部游戏</RouterLink>
          <RouterLink to="/feedback">问题反馈</RouterLink>
          <a href="mailto:3389893163@qq.com">联系我们</a>
        </div>
      </div>
      <div class="container footer-bottom">© 2026 游浪 · 游戏资源仅供学习交流，请支持正版。</div>
    </footer>
  </div>
</template>
