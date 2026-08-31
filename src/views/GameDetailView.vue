<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, CalendarDays, Check, ChevronLeft, Download, ExternalLink, LockKeyhole, MonitorCog, ShieldCheck } from 'lucide-vue-next'
import { ElButton, ElDialog, ElInput, ElMessage } from 'element-plus'
import { ApiError, catalogApi, feedbackApi } from '@/api/client'
import type { DownloadSource, Game } from '@/types/game'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const game = ref<Game | null>(null)
const downloads = ref<DownloadSource[] | null>(null)
const loading = ref(true)
const loadError = ref('')
const downloadLoading = ref(false)
const feedbackOpen = ref(false)
const feedbackText = ref('')
const feedbackLoading = ref(false)
const hasPermission = computed(() => Boolean(game.value && auth.isLoggedIn && (game.value.resourceType === 'free' || auth.isMember || auth.isAdmin)))

watch(() => route.params.slug, () => { void loadGame() }, { immediate: true })

async function loadGame() {
  loading.value = true
  loadError.value = ''
  downloads.value = null
  try {
    game.value = await catalogApi.game(String(route.params.slug))
  } catch (error) {
    game.value = null
    loadError.value = error instanceof ApiError ? error.message : '游戏详情加载失败。'
  } finally {
    loading.value = false
  }
}

async function submitFeedback() {
  if (!feedbackText.value.trim() || !game.value) return
  feedbackLoading.value = true
  try {
    await feedbackApi.create({
      type: 'resource_invalid',
      title: `${game.value.name} 资源失效`,
      content: feedbackText.value.trim(),
      gameSlug: game.value.slug,
    })
    feedbackOpen.value = false
    feedbackText.value = ''
    ElMessage.success('资源失效提醒已提交')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '提交失败，请稍后重试')
  } finally {
    feedbackLoading.value = false
  }
}

async function handleDownload() {
  if (!game.value) return
  if (!auth.isLoggedIn) {
    await router.push({ name: 'auth', query: { redirect: route.fullPath } })
    return
  }
  if (game.value.resourceType === 'member' && !auth.isMember && !auth.isAdmin) {
    await router.push({ name: 'profile', query: { tab: 'membership' } })
    return
  }

  downloadLoading.value = true
  try {
    downloads.value = await catalogApi.downloads(game.value.slug)
    if (!downloads.value.length) ElMessage.info('管理员暂未配置可用下载地址')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '下载地址加载失败')
  } finally {
    downloadLoading.value = false
  }
}
</script>

<template>
  <div v-if="loading" class="empty-state standalone"><p>正在加载游戏详情...</p></div>
  <div v-else-if="game" class="detail-page">
    <section class="detail-hero">
      <div class="detail-backdrop" :style="{ backgroundImage: `url(${game.cover})` }"></div>
      <div class="detail-overlay"></div>
      <div class="container detail-hero-inner">
        <RouterLink to="/games" class="back-link"><ChevronLeft :size="18" />返回游戏库</RouterLink>
        <div class="detail-title-row">
          <div>
            <div class="detail-tags"><span>{{ game.category.name }}</span><span v-for="tag in game.tags" :key="tag.slug">{{ tag.name }}</span></div>
            <h1>{{ game.name }}</h1>
            <div class="detail-date"><CalendarDays :size="17" />发布于 {{ game.publishAt }}</div>
          </div>
          <span :class="['large-resource-badge', game.resourceType]">{{ game.resourceType === 'free' ? '免费资源' : '会员资源' }}</span>
        </div>
      </div>
    </section>

    <section class="section detail-content-section">
      <div class="container detail-layout">
        <article class="detail-main">
          <div class="detail-block">
            <h2>游戏介绍</h2>
            <p class="description">{{ game.description }}</p>
          </div>
          <div class="detail-block">
            <h2><MonitorCog :size="22" />最低配置</h2>
            <ul class="config-list">
              <li v-for="item in game.minConfig" :key="item"><Check :size="17" />{{ item }}</li>
            </ul>
          </div>
        </article>

        <aside class="download-panel">
          <div class="download-panel-title"><Download :size="21" /><h2>下载资源</h2></div>
          <template v-if="downloads !== null">
            <p v-if="downloads.length" class="download-ready">权限已验证，请选择网盘。</p>
            <a v-for="source in downloads" :key="`${source.provider}-${source.url}`" :href="source.url" target="_blank" rel="noopener noreferrer" class="download-source">
              <span><strong>{{ source.provider }}</strong><small>{{ source.label }}</small></span>
              <ExternalLink :size="18" />
            </a>
            <div v-if="!downloads.length" class="permission-state"><AlertTriangle :size="26" /><strong>暂无可用下载地址</strong><p>管理员正在补充或检查资源。</p></div>
          </template>
          <template v-else-if="hasPermission">
            <div class="permission-state"><ShieldCheck :size="29" /><strong>身份验证通过</strong><p>点击后由服务器返回可用下载地址。</p></div>
            <button class="button button-primary full-width" :disabled="downloadLoading" @click="handleDownload">{{ downloadLoading ? '正在获取...' : '获取下载地址' }}</button>
          </template>
          <template v-else>
            <div class="permission-state"><LockKeyhole :size="29" /><strong>{{ auth.isLoggedIn ? '此资源需要会员权限' : '登录后获取下载地址' }}</strong><p>{{ auth.isLoggedIn ? '开通会员即可访问完整资源库。' : '免费资源登录后即可下载。' }}</p></div>
            <button class="button button-primary full-width" @click="handleDownload">{{ auth.isLoggedIn ? '查看会员方案' : '登录下载' }}</button>
          </template>
          <button v-if="auth.isLoggedIn" class="report-link" @click="feedbackOpen = true"><AlertTriangle :size="16" />资源失效？告诉我们</button>
        </aside>
      </div>
    </section>

    <el-dialog v-model="feedbackOpen" title="资源失效提醒" width="min(460px, 92vw)">
      <p class="dialog-note">请简要说明遇到的问题，管理员会尽快检查资源。</p>
      <el-input v-model="feedbackText" type="textarea" :rows="4" maxlength="300" show-word-limit placeholder="例如：网盘链接已失效" />
      <template #footer><el-button @click="feedbackOpen = false">取消</el-button><el-button type="primary" :loading="feedbackLoading" :disabled="!feedbackText.trim()" @click="submitFeedback">提交提醒</el-button></template>
    </el-dialog>
  </div>
  <div v-else class="empty-state standalone"><h1>游戏不可用</h1><p>{{ loadError }}</p><RouterLink to="/games" class="button button-primary">返回游戏库</RouterLink></div>
</template>
