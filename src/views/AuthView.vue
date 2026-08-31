<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Eye, EyeOff, Gamepad2, LockKeyhole, UserRound } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const loading = ref(false)
const canSubmit = computed(() => username.value.trim().length >= 3 && password.value.length >= 6 && (mode.value === 'login' || password.value === confirmPassword.value))

function submit() {
  if (!canSubmit.value) return
  loading.value = true
  window.setTimeout(() => {
    auth.login(username.value.trim())
    ElMessage.success(mode.value === 'login' ? '欢迎回来' : '注册成功')
    router.replace(String(route.query.redirect ?? '/'))
    loading.value = false
  }, 450)
}
</script>

<template>
  <section class="auth-page">
    <div class="auth-visual" role="img" aria-label="游戏场景背景">
      <div class="auth-visual-shade"></div>
      <div class="auth-visual-copy"><Gamepad2 :size="34" /><h1>欢迎来到游浪</h1><p>发现游戏，连接下一段冒险。</p></div>
    </div>
    <div class="auth-form-side">
      <RouterLink to="/" class="auth-logo"><img src="/assets/brand/logo.png" alt="游浪" /></RouterLink>
      <div class="auth-form-wrap">
        <div class="auth-tabs" role="tablist">
          <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
          <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
        </div>
        <h2>{{ mode === 'login' ? '登录你的账号' : '创建游浪账号' }}</h2>
        <p>{{ mode === 'login' ? '继续浏览和获取游戏资源。' : '只需用户名和密码即可开始。' }}</p>
        <form class="auth-form" @submit.prevent="submit">
          <label for="auth-username">用户名</label>
          <div class="input-with-icon"><UserRound :size="18" /><input id="auth-username" v-model="username" autocomplete="username" placeholder="至少 3 个字符" /></div>
          <label for="auth-password">密码</label>
          <div class="input-with-icon"><LockKeyhole :size="18" /><input id="auth-password" v-model="password" :type="showPassword ? 'text' : 'password'" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" placeholder="至少 6 个字符" /><button type="button" class="password-toggle" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="18" /><Eye v-else :size="18" /></button></div>
          <template v-if="mode === 'register'">
            <label for="auth-confirm-password">确认密码</label>
            <div class="input-with-icon"><LockKeyhole :size="18" /><input id="auth-confirm-password" v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入密码" /></div>
          </template>
          <button class="button button-primary auth-submit" :disabled="!canSubmit || loading">{{ loading ? '请稍候...' : mode === 'login' ? '登录' : '创建账号' }}</button>
        </form>
        <p class="auth-terms">继续即表示你同意《用户协议》和《隐私说明》。</p>
      </div>
    </div>
  </section>
</template>
