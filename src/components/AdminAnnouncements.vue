<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElPagination } from 'element-plus'
import { Bell, Plus, Search, Trash2 } from 'lucide-vue-next'
import { adminApi, ApiError, type AdminAnnouncementSummary, type Announcement, type AnnouncementsQuery } from '@/api/client'
import { formatDateTime } from '@/utils/date'
import { withRequestTimeout } from '@/utils/requestTimeout'
import AdminAnnouncementEditor from './AdminAnnouncementEditor.vue'

const items = ref<AdminAnnouncementSummary[]>([])
const filters = reactive({ q: '', status: '', showPopup: '' })
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const error = ref('')
const dialog = ref(false)
const editing = ref<Announcement | null>(null)
const opening = ref<number | null>(null)
const deleting = ref<number | null>(null)
const labels = { draft: '草稿', published: '已发布', archived: '已归档' }
let controller: AbortController | undefined
let detailController: AbortController | undefined
let disposed = false

async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  try {
    const query: AnnouncementsQuery = { q: filters.q.trim(), status: (filters.status || undefined) as AnnouncementsQuery['status'], showPopup: (filters.showPopup || undefined) as AnnouncementsQuery['showPopup'], page: page.value }
    const result = await withRequestTimeout(signal => adminApi.announcements(query, signal), 15000, current.signal)
    if (current.signal.aborted || disposed) return
    items.value = result.items
    page.value = result.pagination.page
    total.value = result.pagination.total
  } catch (cause) { if (!current.signal.aborted && !disposed) error.value = cause instanceof ApiError ? cause.message : '公告加载失败，请重试。' }
  finally { if (controller === current && !disposed) loading.value = false }
}
function search() { page.value = 1; void load() }
function changePage(value: number) { page.value = value; void load() }
function create() { detailController?.abort(); opening.value = null; editing.value = null; dialog.value = true }
async function edit(id: number) {
  detailController?.abort()
  const current = new AbortController()
  detailController = current
  opening.value = id
  try {
    const value = await withRequestTimeout(signal => adminApi.announcement(id, signal), 15000, current.signal)
    if (current.signal.aborted || disposed) return
    editing.value = value
    dialog.value = true
  } catch (cause) { if (!current.signal.aborted && !disposed) ElMessage.error(cause instanceof ApiError ? cause.message : '公告加载失败，请重试') }
  finally { if (detailController === current && !disposed) opening.value = null }
}
async function remove(item: AdminAnnouncementSummary) {
  if (deleting.value !== null || !window.confirm(`确定删除公告“${item.title}”吗？`)) return
  deleting.value = item.id
  try {
    await adminApi.deleteAnnouncement(item.id)
    if (disposed) return
    ElMessage.success('公告已删除')
    await load()
  } catch (cause) { if (!disposed) ElMessage.error(cause instanceof ApiError ? cause.message : '删除失败，请重试') }
  finally { deleting.value = null }
}
function saved() { dialog.value = false; void load() }
onMounted(() => { void load() })
onBeforeUnmount(() => { disposed = true; controller?.abort(); detailController?.abort() })
defineExpose({ refresh: load })
</script>

<template>
  <section class="admin-surface game-list-surface announcement-admin">
    <form class="admin-game-filters" aria-label="公告筛选" @submit.prevent="search">
      <div class="admin-search"><Search :size="17" /><input v-model="filters.q" aria-label="搜索公告" maxlength="100" placeholder="搜索公告标题或正文" /><button type="submit">搜索</button></div>
      <label class="admin-filter"><span>发布状态</span><select v-model="filters.status" @change="search"><option value="">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></label>
      <label class="admin-filter"><span>自动弹窗</span><select v-model="filters.showPopup" @change="search"><option value="">全部设置</option><option value="1">自动弹出</option><option value="0">不自动弹出</option></select></label>
      <button v-if="filters.q || filters.status || filters.showPopup" type="button" class="admin-reset" @click="Object.assign(filters, { q: '', status: '', showPopup: '' }); search()">重置</button>
      <button type="button" class="button button-primary" @click="create"><Plus :size="17" />新增公告</button>
    </form>
    <div v-if="error" class="admin-load-error" role="alert"><p>{{ error }}</p><button class="button button-secondary button-small" @click="load">重新加载</button></div>
    <div v-else class="admin-table-wrap" :aria-busy="loading"><table class="admin-table announcement-table"><thead><tr><th>公告标题</th><th>状态</th><th>自动弹窗</th><th>创建时间</th><th>更新时间</th><th class="actions-heading">操作</th></tr></thead><tbody>
      <tr v-if="loading"><td colspan="6" class="admin-table-empty">正在加载公告…</td></tr>
      <tr v-else-if="!items.length"><td colspan="6" class="admin-table-empty"><Bell :size="26" /><h3>暂无公告</h3><p>新增一条公告，或调整筛选条件。</p></td></tr>
      <tr v-for="item in loading ? [] : items" :key="item.id"><td><button class="announcement-title-link" :disabled="opening !== null" @click="edit(item.id)">{{ item.title }}</button></td><td><span :class="['admin-status', item.status]">{{ labels[item.status] }}</span></td><td>{{ item.show_popup ? '自动弹出' : '不自动弹出' }}</td><td>{{ formatDateTime(item.created_at) }}</td><td>{{ formatDateTime(item.updated_at) }}</td><td><div class="row-actions"><button :disabled="opening !== null" @click="edit(item.id)">{{ opening === item.id ? '加载中…' : '编辑' }}</button><button class="danger" :disabled="deleting !== null" :aria-label="`删除${item.title}`" @click="remove(item)"><Trash2 :size="16" /></button></div></td></tr>
    </tbody></table></div>
    <div class="admin-pagination"><span>共 {{ total }} 条公告</span><el-pagination v-if="total > 10" :current-page="page" :total="total" :page-size="10" layout="prev, pager, next" :pager-count="5" :disabled="loading" @current-change="changePage" /></div>
  </section>
  <AdminAnnouncementEditor v-if="dialog" :announcement="editing" @close="dialog = false" @saved="saved" />
</template>
