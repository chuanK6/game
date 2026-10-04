<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, ArrowDown, CalendarDays, ChevronLeft, Download, ExternalLink, Gamepad2, LockKeyhole, Monitor, MonitorCog, ShieldCheck } from 'lucide-vue-next'
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
const slug = String(route.params.slug)
const coverFailed = ref(false)
const resourceStatusText = computed(() => ({ available: '资源可用', checking: '资源维护中', unavailable: '资源暂不可用' })[game.value?.resourceStatus ?? 'checking'])
const requirements = computed(() => (game.value?.minConfig ?? []).filter((item) => item.trim()).map((item) => {
  const separator = item.search(/[：:]/)
  if (separator <= 0) return { label: '', value: item }
  return { label: item.slice(0, separator).trim(), value: item.slice(separator + 1).trim() }
}))

onMounted(() => { void loadGame() })

async function loadGame() {
  loading.value = true
  loadError.value = ''
  downloads.value = null
  try {
    game.value = await catalogApi.game(slug)
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
  if (!game.value || downloadLoading.value || game.value.resourceStatus !== 'available') return
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
  <div v-if="loading" class="detail-page detail-loading" role="status" aria-label="正在加载游戏详情" aria-busy="true">
    <div class="container detail-skeleton" aria-hidden="true">
      <div class="skeleton skeleton-back"></div>
      <div class="detail-overview">
        <div class="skeleton skeleton-cover"></div>
        <div class="skeleton-summary"><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-heading"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>
      </div>
      <div class="detail-layout skeleton-content"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>
    </div>
  </div>
  <div v-else-if="game" class="detail-page">
    <section class="detail-hero">
      <div class="detail-backdrop" :style="{ backgroundImage: coverFailed ? undefined : `url(${game.cover})` }" aria-hidden="true"></div>
      <div class="detail-overlay" aria-hidden="true"></div>
      <div class="container detail-hero-inner">
        <RouterLink to="/games" class="back-link"><ChevronLeft :size="18" />返回游戏库</RouterLink>
        <div class="detail-overview">
          <div class="detail-cover-frame">
            <img v-if="!coverFailed" :src="game.cover" :alt="`${game.name} 游戏封面`" class="detail-cover" fetchpriority="high" @error="coverFailed = true" />
            <div v-else class="detail-cover-fallback"><Gamepad2 :size="48" /><span>游戏封面暂不可用</span></div>
            <span class="detail-platform"><Monitor :size="14" />PC 游戏</span>
          </div>
          <div class="detail-summary">
            <div class="detail-meta"><span :class="['large-resource-badge', game.resourceType]">{{ game.resourceType === 'free' ? '免费资源' : '会员资源' }}</span><span :class="['resource-status', game.resourceStatus]"><span aria-hidden="true"></span>{{ resourceStatusText }}</span></div>
            <h1>{{ game.name }}</h1>
            <div class="detail-tags"><RouterLink :to="{ name: 'games', query: { category: game.category.slug } }">{{ game.category.name }}</RouterLink><RouterLink v-for="tag in game.tags" :key="tag.slug" :to="{ name: 'games', query: { tags: tag.slug } }">{{ tag.name }}</RouterLink></div>
            <div class="detail-date"><CalendarDays :size="15" />发布于 <time :datetime="game.publishAt">{{ game.publishAt?.slice(0, 10) || '待更新' }}</time></div>
            <div class="detail-hero-actions"><a href="#downloads" class="button button-accent"><Download :size="18" />前往下载</a><a href="#requirements" class="detail-config-link">查看配置<ArrowDown :size="16" /></a></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section detail-content-section">
      <div class="container detail-layout">
        <section class="detail-block detail-introduction" aria-labelledby="introduction-title">
          <div class="detail-block-heading"><span class="detail-section-icon"><Gamepad2 :size="21" /></span><h2 id="introduction-title">游戏介绍</h2></div>
          <p class="description">{{ game.description || '游戏介绍正在补充中。' }}</p>
        </section>

        <aside id="downloads" class="download-panel" aria-labelledby="downloads-title" :aria-busy="downloadLoading">
          <div class="download-panel-title"><span class="detail-section-icon"><Download :size="21" /></span><h2 id="downloads-title">下载资源</h2></div>
          <div class="download-summary"><span>资源类型</span><strong>{{ game.resourceType === 'free' ? '免费资源' : '会员专享' }}</strong></div>
          <div v-if="game.resourceStatus !== 'available'" class="permission-state"><span class="permission-icon maintenance"><AlertTriangle :size="25" /></span><strong>{{ resourceStatusText }}</strong><p>正在检查和补充下载链接，请稍后再来。</p></div>
          <div v-else-if="downloads !== null" class="download-results" aria-live="polite">
            <p v-if="downloads.length" class="download-ready"><ShieldCheck :size="16" />下载地址已就绪，选择网盘前往下载。</p>
            <a v-for="source in downloads" :key="`${source.provider}-${source.url}`" :href="source.url" target="_blank" rel="noopener noreferrer" class="download-source">
              <span><strong>{{ source.provider }}</strong><small>{{ source.label }}</small></span>
              <ExternalLink :size="18" />
            </a>
            <div v-if="!downloads.length" class="permission-state"><AlertTriangle :size="26" /><strong>暂无可用下载地址</strong><p>管理员正在补充或检查资源。</p></div>
          </div>
          <template v-else-if="hasPermission">
            <div class="permission-state"><span class="permission-icon"><ShieldCheck :size="25" /></span><strong>可以下载此资源</strong><p>获取网盘链接，开始你的下一段冒险。</p></div>
            <button class="button button-primary full-width" :disabled="downloadLoading" @click="handleDownload">{{ downloadLoading ? '正在获取...' : '获取下载地址' }}</button>
          </template>
          <template v-else>
            <div class="permission-state"><span class="permission-icon"><LockKeyhole :size="25" /></span><strong>{{ auth.isLoggedIn ? '此资源需要会员权限' : '登录后获取下载地址' }}</strong><p>{{ game.resourceType === 'member' ? '会员专享资源，开通会员后即可下载。' : '免费资源，登录后即可获取网盘链接。' }}</p></div>
            <button class="button button-primary full-width" @click="handleDownload">{{ auth.isLoggedIn ? '查看会员方案' : '登录下载' }}</button>
          </template>
          <button v-if="auth.isLoggedIn" class="report-link" @click="feedbackOpen = true"><AlertTriangle :size="16" />资源失效？告诉我们</button>
        </aside>
        <section id="requirements" class="detail-block detail-requirements" aria-labelledby="requirements-title">
          <div class="detail-block-heading"><span class="detail-section-icon"><MonitorCog :size="21" /></span><div><h2 id="requirements-title">最低配置</h2><p>下载前，确认你的设备满足以下要求。</p></div></div>
          <dl v-if="requirements.length" class="config-list">
            <div v-for="(item, index) in requirements" :key="index" :class="{ 'config-unlabeled': !item.label }"><dt :class="{ 'visually-hidden': !item.label }">{{ item.label || '配置要求' }}</dt><dd>{{ item.value }}</dd></div>
          </dl>
          <p v-else class="detail-muted">配置要求正在补充中，请留意后续更新。</p>
        </section>
      </div>
    </section>

    <el-dialog v-model="feedbackOpen" title="资源失效提醒" width="min(460px, 92vw)">
      <p class="dialog-note">请简要说明遇到的问题，管理员会尽快检查资源。</p>
      <el-input v-model="feedbackText" type="textarea" :rows="4" maxlength="300" show-word-limit placeholder="例如：网盘链接已失效" />
      <template #footer><el-button @click="feedbackOpen = false">取消</el-button><el-button type="primary" :loading="feedbackLoading" :disabled="!feedbackText.trim()" @click="submitFeedback">提交提醒</el-button></template>
    </el-dialog>
  </div>
  <div v-else class="empty-state standalone detail-error"><Gamepad2 :size="40" /><h1>游戏不可用</h1><p>{{ loadError }}</p><div class="detail-error-actions"><button class="button button-primary" @click="loadGame">重新加载</button><RouterLink to="/games" class="button button-secondary">返回游戏库</RouterLink></div></div>
</template>
