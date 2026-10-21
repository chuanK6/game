<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useAdminGames } from '@/composables/useAdminGames'
import { withRequestTimeout } from '@/utils/requestTimeout'
import AdminGameEditor from '@/components/AdminGameEditor.vue'
import AdminUsers from '@/components/AdminUsers.vue'
import AdminAnnouncements from '@/components/AdminAnnouncements.vue'
import '@/styles/admin.css'
import { CheckCircle2, ClipboardList, Gamepad2, LayoutDashboard, MessageSquareText, Plus, RefreshCw, Tags, Trash2, Users, ArrowUpRight, ChevronRight, Moon, Sun, Search, SlidersHorizontal, X, House, Bell } from 'lucide-vue-next'
import { ElButton, ElDialog, ElMessage, ElPagination } from 'element-plus'
import {
  ApiError, adminApi, type AdminFeedback, type AdminGame, type AdminOrder, type AdminOverview,
  type AdminTaxonomy, type AdminGameDetail, type TaxonomyPayload,
} from '@/api/client'
import { formatDateTime } from '@/utils/date'

type Tab = 'overview' | 'announcements' | 'games' | 'taxonomy' | 'orders' | 'feedback' | 'users'
type TaxonomyKind = 'categories' | 'tags'
type TaxonomyForm = TaxonomyPayload & { id?: number }

const activeTab = ref<Tab>('overview')
const loading = ref(false)
const overview = ref<AdminOverview>({ users: 0, games: 0, pendingOrders: 0, openFeedback: 0 })
const gameList = useAdminGames()
const { games, page: gamePage, total: gameTotal, loading: gamesLoading, error: gamesError, filters: gameFilters } = gameList
const loadError = ref('')
const auth = useAuthStore()
const theme = useThemeStore()
const editingGame = ref<AdminGameDetail | null>(null)
const openingGameId = ref<number | null>(null)
const taxonomyReady = ref(false)
let detailController: AbortController | undefined
let tabRequest = 0
const activeFilterCount = computed(() => [gameFilters.q, gameFilters.categoryId, gameFilters.resourceType, gameFilters.status].filter(Boolean).length)
const gamePageSize = 10
const orders = ref<AdminOrder[]>([])
const feedback = ref<AdminFeedback[]>([])
const usersPanel = ref<InstanceType<typeof AdminUsers> | null>(null)
const announcementsPanel = ref<InstanceType<typeof AdminAnnouncements> | null>(null)
const orderPage = ref(1)
const orderTotal = ref(0)
const feedbackPage = ref(1)
const feedbackTotal = ref(0)
let listController: AbortController | undefined
const gameSearch = ref('')
const orderSearch = ref('')
const feedbackSearch = ref('')
const categories = ref<AdminTaxonomy[]>([])
const tags = ref<AdminTaxonomy[]>([])
const gameDialog = ref(false)
const taxonomyDialog = ref(false)
const savingTaxonomy = ref(false)
const taxonomyKind = ref<TaxonomyKind>('categories')
const taxonomySection = ref<TaxonomyKind>('categories')
const taxonomyForm = ref<TaxonomyForm>({ name: '', slug: '', status: 'active', sort: 0 })
const tabs = [
  { value: 'overview' as const, label: '概览', icon: LayoutDashboard },
  { value: 'announcements' as const, label: '公告管理', icon: Bell },
  { value: 'games' as const, label: '游戏资源', icon: Gamepad2 },
  { value: 'taxonomy' as const, label: '分类与标签', icon: Tags },
  { value: 'orders' as const, label: '会员工单', icon: ClipboardList },
  { value: 'feedback' as const, label: '反馈处理', icon: MessageSquareText },
  { value: 'users' as const, label: '用户管理', icon: Users },
]

const tabDescriptions: Record<Tab, string> = {
  announcements: '发布站点公告，管理弹窗与历史内容。',
  overview: '站点动态与待办，一目了然。', games: '管理游戏、封面、介绍和下载地址。', taxonomy: '整理游戏分类，维护便于发现内容的标签。',
  orders: '查看会员申请，及时处理付款工单。', feedback: '回应玩家反馈，跟进资源与使用问题。', users: '管理账号状态与会员权限。',
}
onMounted(() => { void loadTab('overview') })
onBeforeUnmount(() => { tabRequest++; detailController?.abort(); listController?.abort() })

async function loadTab(tab: Tab, force = false) {
  if (tab === 'announcements' && activeTab.value === 'announcements') { await announcementsPanel.value?.refresh(); return }
  if (tab === 'users' && activeTab.value === 'users') { await usersPanel.value?.refresh(); return }
  const version = ++tabRequest
  listController?.abort()
  listController = new AbortController()
  const signal = listController.signal
  if (tab === 'taxonomy' && activeTab.value !== 'taxonomy') taxonomySection.value = 'categories'
  activeTab.value = tab
  if (tab !== 'games') { gameList.cancel(); detailController?.abort(); openingGameId.value = null }
  loading.value = tab !== 'games' && tab !== 'users' && tab !== 'announcements'
  loadError.value = ''
  const current = () => version === tabRequest
  try {
    if (tab === 'overview') { const value = await adminApi.overview(); if (current()) overview.value = value }
    if (tab === 'games') await Promise.all([gameList.load(force), (!taxonomyReady.value || force) ? loadTaxonomies() : Promise.resolve()])
    if (tab === 'taxonomy') await loadTaxonomies()
    if (tab === 'orders') {
      const value = await withRequestTimeout(signal => adminApi.orders({ q: orderSearch.value.trim(), page: orderPage.value }, signal), 15000, signal)
      if (current()) { orders.value = value.items; orderPage.value = value.pagination.page; orderTotal.value = value.pagination.total }
    }
    if (tab === 'feedback') {
      const value = await withRequestTimeout(signal => adminApi.feedback({ q: feedbackSearch.value.trim(), page: feedbackPage.value }, signal), 15000, signal)
      if (current()) { feedback.value = value.items; feedbackPage.value = value.pagination.page; feedbackTotal.value = value.pagination.total }
    }
  } catch (error) {
    if (current()) loadError.value = error instanceof ApiError ? error.message : '加载失败，请重试。'
  } finally { if (current()) loading.value = false }
}

function searchTab(tab: Tab) {
  if (tab === 'orders') orderPage.value = 1
  if (tab === 'feedback') feedbackPage.value = 1
  if (tab === 'games') { gameFilters.q = gameSearch.value.trim(); gamePage.value = 1 }
  void loadTab(tab)
}
function changeOrderPage(page: number) { orderPage.value = page; void loadTab('orders') }
function changeFeedbackPage(page: number) { feedbackPage.value = page; void loadTab('feedback') }
function changeGamePage(page: number) { gamePage.value = page; void gameList.load() }
function applyGameFilters() { gamePage.value = 1; gameFilters.q = gameSearch.value.trim(); void gameList.load() }
function resetGameFilters() { gameSearch.value = ''; Object.assign(gameFilters, { q: '', categoryId: '', resourceType: '', status: '' }); gamePage.value = 1; void gameList.load() }

async function deleteOrder(item: AdminOrder) {
  if (!window.confirm(`确定删除 ${item.username} 的会员工单吗？`)) return
  try {
    await adminApi.deleteOrder(item.id)
    ElMessage.success('工单已删除')
    await loadTab('orders')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

async function deleteFeedback(item: AdminFeedback) {
  if (!window.confirm(`确定删除“${item.title}”吗？`)) return
  try {
    await adminApi.deleteFeedback(item.id)
    ElMessage.success('反馈已删除')
    await loadTab('feedback')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

const gameStatusLabels: Record<AdminGame['status'], string> = { draft: '草稿', published: '已发布', offline: '已下架' }

async function loadTaxonomies() {
  const [categoryItems, tagItems] = await Promise.all([adminApi.categories(), adminApi.tags()])
  categories.value = categoryItems
  tags.value = tagItems
  taxonomyReady.value = true
}

function openTaxonomy(kind: TaxonomyKind, item?: AdminTaxonomy) {
  taxonomyKind.value = kind
  taxonomyForm.value = item
    ? { id: item.id, name: item.name, slug: item.slug, status: item.status, sort: item.sort }
    : { name: '', slug: '', status: 'active', sort: 0 }
  taxonomyDialog.value = true
}

async function saveTaxonomy() {
  const value = taxonomyForm.value
  if (!value.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) {
    ElMessage.error('请填写名称，slug 只能包含小写字母、数字和连字符')
    return
  }
  savingTaxonomy.value = true
  try {
    const payload: TaxonomyPayload = {
      name: value.name.trim(), slug: value.slug, status: value.status,
      sort: taxonomyKind.value === 'categories' ? Number(value.sort ?? 0) : 0,
    }
    if (value.id) await adminApi.updateTaxonomy(taxonomyKind.value, value.id, payload)
    else await adminApi.createTaxonomy(taxonomyKind.value, payload)
    ElMessage.success(value.id ? '已更新' : '已创建')
    taxonomyDialog.value = false
    gameList.invalidate()
    await loadTaxonomies()
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '保存失败')
  } finally {
    savingTaxonomy.value = false
  }
}

async function deleteTaxonomy(kind: TaxonomyKind, item: AdminTaxonomy) {
  if (!window.confirm(`确定删除“${item.name}”吗？`)) return
  try {
    await adminApi.deleteTaxonomy(kind, item.id)
    ElMessage.success('已删除')
    gameList.invalidate()
    await loadTaxonomies()
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

function openNewGame() {
  detailController?.abort()
  openingGameId.value = null
  editingGame.value = null
  gameDialog.value = true
}
async function openEditGame(id: number) {
  detailController?.abort()
  const controller = new AbortController()
  detailController = controller
  openingGameId.value = id
  try {
    const item = await withRequestTimeout(signal => adminApi.game(id, signal), 15000, controller.signal)
    if (controller.signal.aborted) return
    editingGame.value = item
    gameDialog.value = true
  } catch (error) {
    if (!controller.signal.aborted) ElMessage.error(error instanceof ApiError ? error.message : '游戏详情加载失败，请重试')
  } finally { if (detailController === controller) openingGameId.value = null }
}
function gameSaved() { gameDialog.value = false; gameList.invalidate(); void loadTab('games', true) }
async function deleteGame(item: AdminGame) {
  if (!window.confirm('确定下架并删除“' + item.name + '”吗？')) return
  try {
    await adminApi.deleteGame(item.id)
    ElMessage.success('游戏已删除')
    gameList.invalidate()
    await loadTab('games', true)
  } catch (error) { ElMessage.error(error instanceof ApiError ? error.message : '删除失败') }
}

async function reviewOrder(order: AdminOrder, status: 'approved' | 'rejected') {
  const note = window.prompt(status === 'approved' ? '审核备注（可留空）' : '请输入驳回原因', '')
  if (note === null) return
  try {
    await adminApi.reviewOrder(order.id, status, note)
    ElMessage.success(status === 'approved' ? '会员已开通' : '工单已驳回')
    await loadTab('orders')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '审核失败')
  }
}

async function saveFeedback(item: AdminFeedback) {
  try {
    await adminApi.updateFeedback(item.id, item.status, item.admin_reply ?? '')
    ElMessage.success('反馈状态已保存')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '保存失败')
  }
}

</script>

<template>
  <section class="admin-page">
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <RouterLink to="/admin" class="admin-brand"><span class="admin-brand-mark">游</span><span><strong>游浪</strong><small>管理后台</small></span></RouterLink>
        <span class="admin-nav-label">工作空间</span>
        <nav aria-label="后台导航"><button v-for="tab in tabs" :key="tab.value" :class="{ active: activeTab === tab.value }" :aria-label="tab.label" :aria-current="activeTab === tab.value ? 'page' : undefined" @click="loadTab(tab.value)"><component :is="tab.icon" :size="18" /><span>{{ tab.label }}</span><span v-if="tab.value === 'orders' && overview.pendingOrders" class="admin-nav-count">{{ overview.pendingOrders }}</span><span v-if="tab.value === 'feedback' && overview.openFeedback" class="admin-nav-count">{{ overview.openFeedback }}</span></button></nav>
      </aside>
      <div class="admin-workspace">
      <header class="admin-topbar"><div class="admin-breadcrumb"><span>管理后台</span><ChevronRight :size="14" /><strong>{{ tabs.find(tab => tab.value === activeTab)?.label }}</strong></div><div class="admin-topbar-actions"><button class="icon-button" :aria-label="theme.isDark ? '切换到日间模式' : '切换到夜间模式'" @click="theme.toggle"><Sun v-if="theme.isDark" :size="18" /><Moon v-else :size="18" /></button><span class="admin-avatar" :title="auth.user?.username">{{ auth.user?.username?.slice(0, 1) }}</span><span class="admin-username">{{ auth.user?.username }}</span><RouterLink to="/" class="admin-return-link"><House :size="16" />回到网站</RouterLink></div></header>
      <main class="admin-content">
        <div class="admin-toolbar"><div><h1>{{ tabs.find((tab) => tab.value === activeTab)?.label }}</h1><p>{{ tabDescriptions[activeTab] }}</p></div><div class="admin-heading-actions"><button class="icon-button" title="刷新" aria-label="刷新" @click="loadTab(activeTab, true)"><RefreshCw :size="18" /></button><button v-if="activeTab === 'games'" class="button button-primary" :disabled="!taxonomyReady" @click="openNewGame"><Plus :size="17" />新增游戏</button></div></div>
        <div v-if="loading" class="empty-state compact"><p>正在加载...</p></div>
        <div v-else-if="loadError" class="admin-load-error" role="alert"><p>{{ loadError }}</p><button class="button button-secondary button-small" @click="loadTab(activeTab, true)">重新加载</button></div>
        <AdminAnnouncements v-else-if="activeTab === 'announcements'" ref="announcementsPanel" />
        <template v-else-if="activeTab === 'overview'">
        <div class="admin-stats">
          <button class="admin-stat-card" @click="loadTab('users')"><Users :size="22" /><span>用户</span><strong>{{ overview.users }}</strong></button>
          <button class="admin-stat-card" @click="loadTab('games')"><Gamepad2 :size="22" /><span>游戏</span><strong>{{ overview.games }}</strong></button>
          <button class="admin-stat-card" @click="loadTab('orders')"><ClipboardList :size="22" /><span>待审工单</span><strong>{{ overview.pendingOrders }}</strong></button>
          <button class="admin-stat-card" @click="loadTab('feedback')"><MessageSquareText :size="22" /><span>待处理反馈</span><strong>{{ overview.openFeedback }}</strong></button>
        </div>
        <div class="admin-overview-grid"><section class="admin-surface admin-todos"><div class="admin-card-heading"><h2>待办事项</h2><span>及时响应每一位玩家</span></div><button @click="loadTab('orders')"><span class="admin-todo-icon"><ClipboardList :size="21" /></span><span><strong>会员工单</strong><small>{{ overview.pendingOrders ? '有待审核的会员申请' : '当前没有待审核的申请' }}</small></span><b>{{ overview.pendingOrders }}</b><ChevronRight :size="16" /></button><button @click="loadTab('feedback')"><span class="admin-todo-icon"><MessageSquareText :size="21" /></span><span><strong>玩家反馈</strong><small>{{ overview.openFeedback ? '有反馈等待跟进处理' : '当前没有待处理的反馈' }}</small></span><b>{{ overview.openFeedback }}</b><ChevronRight :size="16" /></button></section><section class="admin-surface admin-shortcuts"><div class="admin-card-heading"><h2>内容管理</h2><span>让内容更容易被发现</span></div><button @click="loadTab('games')"><Gamepad2 :size="20" /><span><strong>管理游戏资源</strong><small>更新图文介绍与下载来源</small></span><ArrowUpRight :size="18" /></button><button @click="loadTab('taxonomy')"><Tags :size="20" /><span><strong>整理分类与标签</strong><small>维护清晰的游戏分类</small></span><ArrowUpRight :size="18" /></button></section></div>
        </template>

        <template v-else-if="activeTab === 'games'">
          <section class="admin-surface game-list-surface">
          <form class="admin-game-filters" aria-label="游戏筛选" @submit.prevent="searchTab('games')"><div class="admin-search"><Search :size="17" /><input v-model="gameSearch" aria-label="搜索游戏" maxlength="100" placeholder="搜索游戏名称或 slug" /><button type="submit">搜索</button></div><label class="admin-filter"><span>游戏分类</span><select v-model="gameFilters.categoryId" @change="applyGameFilters"><option value="">全部分类</option><option v-for="category in categories" :key="category.id" :value="String(category.id)">{{ category.name }}</option></select></label><label class="admin-filter"><span>资源权限</span><select v-model="gameFilters.resourceType" @change="applyGameFilters"><option value="">全部权限</option><option value="free">免费资源</option><option value="member">会员资源</option></select></label><label class="admin-filter"><span>发布状态</span><select v-model="gameFilters.status" @change="applyGameFilters"><option value="">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="offline">已下架</option></select></label><button v-if="activeFilterCount" class="admin-reset" type="button" @click="resetGameFilters"><X :size="14" />重置</button></form>
          <div v-if="gamesError" class="admin-load-error" role="alert"><p>{{ gamesError }}</p><button class="button button-secondary button-small" @click="gameList.load(true)">重新加载</button></div>
          <div v-else class="admin-table-wrap" :aria-busy="gamesLoading"><table class="admin-table hoverable-table game-list-table"><thead><tr><th>游戏</th><th>分类</th><th>权限</th><th>发布状态</th><th class="actions-heading">操作</th></tr></thead><tbody><tr v-if="gamesLoading"><td colspan="5" class="admin-table-empty"><RefreshCw :size="22" /><p>正在加载游戏…</p></td></tr><tr v-else-if="!games.length"><td colspan="5" class="admin-table-empty"><SlidersHorizontal :size="26" /><h3>{{ activeFilterCount ? '没有符合条件的游戏' : '还没有游戏资源' }}</h3><p>{{ activeFilterCount ? '试试调整筛选条件，或清空后重新搜索。' : '点击“新增游戏”，创建第一份游戏内容。' }}</p><button v-if="activeFilterCount" type="button" class="button button-secondary button-small" @click="resetGameFilters">清空筛选</button></td></tr><template v-else><tr v-for="item in games" :key="item.id"><td><div class="admin-game-cell"><img :src="item.cover_url" alt="" loading="lazy" /><div><strong>{{ item.name }}<span v-if="item.is_pinned" class="admin-pinned-label">置顶</span></strong><small>{{ item.slug }}</small></div></div></td><td><span class="admin-category-name">{{ item.category }}</span></td><td><span :class="['admin-access', item.resource_type]">{{ item.resource_type === 'free' ? '免费' : '会员' }}</span></td><td><span :class="['admin-status', item.status]">{{ gameStatusLabels[item.status] }}</span></td><td><div class="row-actions"><button :disabled="openingGameId !== null" @click="openEditGame(item.id)">{{ openingGameId === item.id ? '加载中…' : '编辑' }}</button><button class="danger" :aria-label="`删除${item.name}`" title="删除" @click="deleteGame(item)"><Trash2 :size="16" /></button></div></td></tr></template></tbody></table></div>
          <div class="admin-pagination"><span aria-live="polite">共 {{ gameTotal }} 个游戏<span v-if="activeFilterCount"> · 已筛选</span></span><ElPagination v-if="gameTotal > gamePageSize" background layout="prev, pager, next" :pager-count="5" :current-page="gamePage" :page-size="gamePageSize" :total="gameTotal" @current-change="changeGamePage" /></div>
          </section>
        </template>

        <template v-else-if="activeTab === 'taxonomy'">
          <div class="taxonomy-switch" role="group" aria-label="分类与标签切换">
            <button type="button" :aria-pressed="taxonomySection === 'categories'" aria-controls="taxonomy-categories" @click="taxonomySection = 'categories'">分类</button>
            <button type="button" :aria-pressed="taxonomySection === 'tags'" aria-controls="taxonomy-tags" @click="taxonomySection = 'tags'">标签</button>
          </div>
          <div class="taxonomy-sections">
            <section v-if="taxonomySection === 'categories'" id="taxonomy-categories">
              <div class="taxonomy-heading"><div><h3>游戏分类</h3><p>用于游戏列表筛选与归档，可通过排序值调整展示顺序。</p></div><button class="button button-primary button-small" @click="openTaxonomy('categories')"><Plus :size="16" />新增分类</button></div>
              <div class="admin-table-wrap"><table class="admin-table taxonomy-table"><thead><tr><th>名称</th><th>Slug</th><th>排序</th><th>状态</th><th class="actions-heading">操作</th></tr></thead><tbody><tr v-for="item in categories" :key="item.id"><td><strong>{{ item.name }}</strong></td><td><code>{{ item.slug }}</code></td><td>{{ item.sort }}</td><td><span :class="['taxonomy-status', item.status]">{{ item.status === 'active' ? '启用' : '停用' }}</span></td><td><div class="row-actions"><button @click="openTaxonomy('categories', item)">编辑</button><button class="danger" title="删除" @click="deleteTaxonomy('categories', item)"><Trash2 :size="16" /></button></div></td></tr></tbody></table></div>
            </section>
            <section v-else id="taxonomy-tags">
              <div class="taxonomy-heading"><div><h3>游戏标签</h3><p>用于标记游戏特征和组合筛选。</p></div><button class="button button-primary button-small" @click="openTaxonomy('tags')"><Plus :size="16" />新增标签</button></div>
              <div class="admin-table-wrap"><table class="admin-table taxonomy-table"><thead><tr><th>名称</th><th>Slug</th><th>状态</th><th class="actions-heading">操作</th></tr></thead><tbody><tr v-for="item in tags" :key="item.id"><td><strong>{{ item.name }}</strong></td><td><code>{{ item.slug }}</code></td><td><span :class="['taxonomy-status', item.status]">{{ item.status === 'active' ? '启用' : '停用' }}</span></td><td><div class="row-actions"><button @click="openTaxonomy('tags', item)">编辑</button><button class="danger" title="删除" @click="deleteTaxonomy('tags', item)"><Trash2 :size="16" /></button></div></td></tr></tbody></table></div>
            </section>
          </div>
        </template>

        <template v-else-if="activeTab === 'orders'">
          <div class="admin-list-toolbar"><form class="admin-search" @submit.prevent="searchTab('orders')"><input v-model="orderSearch" placeholder="搜索用户名" /><button class="button button-secondary button-small" type="submit">搜索</button></form></div>
          <div v-if="!orders.length" class="empty-state compact"><CheckCircle2 :size="28" /><h3>暂无会员工单</h3></div>
          <div v-else class="admin-list"><article v-for="item in orders" :key="item.id" class="admin-list-row"><div><span class="history-type">#{{ item.id }} · {{ item.username }}</span><h3>{{ item.plan === 'monthly' ? '月度会员' : '终身会员' }} · {{ item.payment_channel === 'wechat' ? '微信' : '支付宝' }}</h3><p>{{ formatDateTime(item.submitted_at) }}</p><small v-if="item.admin_note">{{ item.admin_note }}</small></div><div class="row-actions"><span :class="['order-status', item.status]">{{ item.status === 'pending' ? '待审核' : item.status === 'approved' ? '已开通' : '已驳回' }}</span><template v-if="item.status === 'pending'"><button class="approve" @click="reviewOrder(item, 'approved')">通过</button><button class="danger-text" @click="reviewOrder(item, 'rejected')">驳回</button></template><button class="danger-text" title="删除工单" @click="deleteOrder(item)"><Trash2 :size="16" /></button></div></article></div>
          <div class="admin-pagination"><span>共 {{ orderTotal }} 条工单</span><ElPagination v-if="orderTotal > 10" background layout="prev, pager, next" :pager-count="5" :current-page="orderPage" :page-size="10" :total="orderTotal" @current-change="changeOrderPage" /></div>
        </template>

        <template v-else-if="activeTab === 'feedback'">
          <div class="admin-list-toolbar"><form class="admin-search" @submit.prevent="searchTab('feedback')"><input v-model="feedbackSearch" placeholder="搜索用户名、标题或内容" /><button class="button button-secondary button-small" type="submit">搜索</button></form></div>
          <div v-if="!feedback.length" class="empty-state compact"><MessageSquareText :size="28" /><h3>暂无反馈</h3></div>
          <div v-else class="admin-list"><article v-for="item in feedback" :key="item.id" class="admin-list-row feedback-admin-row"><div><span class="history-type">{{ item.username }} · {{ item.type }}</span><h3>{{ item.title }}</h3><p>{{ item.content }}</p><small>{{ formatDateTime(item.created_at) }}</small></div><div class="admin-inline-form"><select v-model="item.status"><option value="pending">待处理</option><option value="processing">处理中</option><option value="resolved">已处理</option><option value="closed">已关闭</option></select><textarea v-model="item.admin_reply" placeholder="管理员回复" maxlength="500"></textarea><div class="row-actions"><button class="button button-primary button-small" @click="saveFeedback(item)">保存</button><button class="danger-text" title="删除反馈" @click="deleteFeedback(item)"><Trash2 :size="16" /></button></div></div></article></div>
          <div class="admin-pagination"><span>共 {{ feedbackTotal }} 条反馈</span><ElPagination v-if="feedbackTotal > 10" background layout="prev, pager, next" :pager-count="5" :current-page="feedbackPage" :page-size="10" :total="feedbackTotal" @current-change="changeFeedbackPage" /></div>
        </template>

        <template v-else-if="activeTab === 'users'">
          <AdminUsers ref="usersPanel" />
        </template>
      </main>
      </div>
    </div>
  </section>

  <AdminGameEditor v-if="gameDialog" :game="editingGame" :categories="categories" :tags="tags" @close="gameDialog = false" @saved="gameSaved" />

  <el-dialog v-model="taxonomyDialog" :title="`${taxonomyForm.id ? '编辑' : '新增'}${taxonomyKind === 'categories' ? '分类' : '标签'}`" width="min(480px, 94vw)">
    <form class="taxonomy-form" @submit.prevent="saveTaxonomy">
      <label>名称<input v-model="taxonomyForm.name" maxlength="50" required /></label>
      <label>Slug<input v-model.trim="taxonomyForm.slug" maxlength="60" placeholder="action-game" required /></label>
      <label v-if="taxonomyKind === 'categories'">排序值<input v-model.number="taxonomyForm.sort" type="number" min="0" max="10000" required /></label>
      <label>状态<select v-model="taxonomyForm.status"><option value="active">启用</option><option value="disabled">停用</option></select></label>
    </form>
    <template #footer><el-button @click="taxonomyDialog = false">取消</el-button><el-button type="primary" :loading="savingTaxonomy" @click="saveTaxonomy">保存</el-button></template>
  </el-dialog>
</template>
