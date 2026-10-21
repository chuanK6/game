<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElButton, ElDialog, ElPagination } from 'element-plus'
import { ArrowLeft, Bell } from 'lucide-vue-next'
import { announcementsApi, ApiError, type Announcement, type AnnouncementSummary } from '@/api/client'
import { formatDateTime } from '@/utils/date'
import { withRequestTimeout } from '@/utils/requestTimeout'
import MarkdownContent from './MarkdownContent.vue'
import '@/styles/announcements.css'

const route = useRoute()
const visible = ref(false)
const tab = ref<'latest' | 'history'>('latest')
const detail = ref<Announcement | null>(null)
const items = ref<AnnouncementSummary[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const error = ref('')
const storageKey = 'youlun-announcements-dismissed-date'
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
let dismissedDate = ''
let attemptedAuto = false
let disposed = false
let controller: AbortController | undefined
let retry: () => void = () => { void latest() }

function closedToday() {
  try { return localStorage.getItem(storageKey) === today() || dismissedDate === today() }
  catch { return dismissedDate === today() }
}
function close(forToday = false) {
  if (forToday) {
    dismissedDate = today()
    try { localStorage.setItem(storageKey, dismissedDate) } catch { /* Storage may be unavailable in private browsers. */ }
  }
  visible.value = false
  controller?.abort()
  loading.value = false
}
async function request(action: (signal: AbortSignal) => Promise<void>) {
  controller?.abort()
  const current = new AbortController()
  controller = current
  error.value = ''
  loading.value = true
  try { await withRequestTimeout(action, 15000, current.signal) }
  catch (cause) { if (!current.signal.aborted && !disposed) error.value = cause instanceof ApiError ? cause.message : '公告加载失败，请重试。' }
  finally { if (controller === current && !disposed) loading.value = false }
}
async function latest() {
  tab.value = 'latest'
  detail.value = null
  retry = () => { void latest() }
  await request(async signal => {
    const value = await announcementsApi.latest(false, signal)
    if (!signal.aborted && !disposed) detail.value = value
  })
}
async function history(value = 1) {
  tab.value = 'history'
  detail.value = null
  retry = () => { void history(value) }
  await request(async signal => {
    const result = await announcementsApi.list(value, signal)
    if (signal.aborted || disposed) return
    items.value = result.items
    page.value = result.pagination.page
    total.value = result.pagination.total
  })
}
async function view(id: number) {
  detail.value = null
  retry = () => { void view(id) }
  await request(async signal => {
    const value = await announcementsApi.detail(id, signal)
    if (!signal.aborted && !disposed) detail.value = value
  })
}
function back() { controller?.abort(); loading.value = false; detail.value = null; error.value = ''; retry = () => { void history(page.value) } }
function open() { visible.value = true; void latest() }

watch(() => route.path, path => {
  if (path === '/admin') { close(); return }
  if (attemptedAuto) return
  attemptedAuto = true
  if (closedToday()) return
  const current = new AbortController()
  controller = current
  void withRequestTimeout(signal => announcementsApi.latest(true, signal), 15000, current.signal).then(value => {
    if (disposed || current.signal.aborted || route.path === '/admin' || closedToday() || !value) return
    detail.value = value
    tab.value = 'latest'
    visible.value = true
  }).catch(() => { /* Failed automatic notices must not interrupt browsing. */ })
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; controller?.abort() })
defineExpose({ open })
</script>

<template>
  <el-dialog :model-value="visible" title="网站公告" width="min(760px, 94vw)" top="6vh" class="announcement-dialog" :close-on-click-modal="false" @update:model-value="!$event && close()">
    <div class="announcement-tabs" role="group" aria-label="公告分类"><button type="button" :aria-pressed="tab === 'latest'" @click="latest">最新公告</button><button type="button" :aria-pressed="tab === 'history'" @click="history()">往期公告</button></div>
    <div class="announcement-body" :aria-busy="loading">
      <button v-if="tab === 'history' && (detail || error)" type="button" class="announcement-back" @click="back"><ArrowLeft :size="16" />返回公告列表</button>
      <div v-if="loading" class="announcement-empty" role="status">正在加载公告…</div>
      <div v-else-if="error" class="announcement-empty" role="alert"><p>{{ error }}</p><el-button @click="retry">重新加载</el-button></div>
      <article v-else-if="detail" class="announcement-article"><h2>{{ detail.title }}</h2><time :datetime="detail.created_at">{{ formatDateTime(detail.created_at) }}</time><MarkdownContent :content="detail.content" /></article>
      <template v-else-if="tab === 'history' && items.length"><ul class="announcement-history"><li v-for="item in items" :key="item.id"><button type="button" @click="view(item.id)"><span>{{ item.title }}</span><time :datetime="item.created_at">{{ formatDateTime(item.created_at).slice(0, 10) }}</time></button></li></ul><el-pagination v-if="total > 10" class="announcement-history-pagination" :current-page="page" :total="total" :page-size="10" :pager-count="5" layout="prev, pager, next" @current-change="history" /></template>
      <div v-else class="announcement-empty"><Bell :size="28" /><p>暂无已发布公告</p></div>
    </div>
    <template #footer><div class="announcement-footer"><el-button @click="close(true)">本日关闭</el-button><el-button type="primary" @click="close()">本次关闭</el-button></div></template>
  </el-dialog>
</template>
