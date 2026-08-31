<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, CalendarDays, Check, ChevronLeft, Download, ExternalLink, LockKeyhole, MonitorCog } from 'lucide-vue-next'
import { ElButton, ElDialog, ElInput, ElMessage } from 'element-plus'
import { games } from '@/data/games'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const feedbackOpen = ref(false)
const feedbackText = ref('')
const game = computed(() => games.find((item) => item.slug === route.params.slug))
const canDownload = computed(() => game.value?.resourceType === 'free' ? auth.isLoggedIn : auth.isMember)

function submitFeedback() {
  if (!feedbackText.value.trim()) return
  feedbackOpen.value = false
  feedbackText.value = ''
  ElMessage.success('已提交资源失效提醒')
}

function handleDownload() {
  if (!auth.isLoggedIn) router.push({ name: 'auth', query: { redirect: route.fullPath } })
  else if (!auth.isMember) router.push({ name: 'profile', query: { tab: 'membership' } })
}
</script>

<template>
  <div v-if="game" class="detail-page">
    <section class="detail-hero">
      <div class="detail-backdrop" :style="{ backgroundImage: `url(${game.cover})` }"></div>
      <div class="detail-overlay"></div>
      <div class="container detail-hero-inner">
        <RouterLink to="/games" class="back-link"><ChevronLeft :size="18" />返回游戏库</RouterLink>
        <div class="detail-title-row">
          <div>
            <div class="detail-tags"><span>{{ game.category }}</span><span v-for="tag in game.tags" :key="tag">{{ tag }}</span></div>
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
          <template v-if="canDownload">
            <p class="download-ready">资源权限已验证，请选择网盘。</p>
            <a v-for="source in game.downloads" :key="source.provider" :href="source.url" class="download-source">
              <span><strong>{{ source.provider }}</strong><small>{{ source.label }}</small></span>
              <ExternalLink :size="18" />
            </a>
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
      <p class="dialog-note">请简单说明遇到的问题，管理员会尽快检查资源。</p>
      <el-input v-model="feedbackText" type="textarea" :rows="4" maxlength="300" show-word-limit placeholder="例如：网盘链接已失效" />
      <template #footer><el-button @click="feedbackOpen = false">取消</el-button><el-button type="primary" :disabled="!feedbackText.trim()" @click="submitFeedback">提交提醒</el-button></template>
    </el-dialog>
  </div>
  <div v-else class="empty-state standalone"><h1>游戏不存在</h1><RouterLink to="/games" class="button button-primary">返回游戏库</RouterLink></div>
</template>
