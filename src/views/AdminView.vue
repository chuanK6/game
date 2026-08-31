<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { CheckCircle2, ClipboardList, Gamepad2, LayoutDashboard, MessageSquareText, Plus, RefreshCw, Tags, Trash2, Upload, Users } from 'lucide-vue-next'
import { ElButton, ElDialog, ElMessage } from 'element-plus'
import {
  ApiError, adminApi, type AdminFeedback, type AdminGame, type AdminOrder, type AdminOverview,
  type AdminTaxonomy, type AdminUser, type GamePayload, type TaxonomyPayload,
} from '@/api/client'
import type { DownloadSource } from '@/types/game'

type Tab = 'overview' | 'games' | 'taxonomy' | 'orders' | 'feedback' | 'users'
type TaxonomyKind = 'categories' | 'tags'
const CONFIG_FIELDS = [
  { key: 'os', label: '操作系统', placeholder: '例如 Windows 10 64 位' },
  { key: 'cpu', label: '处理器（CPU）', placeholder: '例如 Intel Core i5-8400' },
  { key: 'memory', label: '内存', placeholder: '例如 8 GB RAM' },
  { key: 'gpu', label: '显卡', placeholder: '例如 GTX 1060 6 GB' },
  { key: 'storage', label: '存储空间', placeholder: '例如需要 45 GB 可用空间' },
  { key: 'other', label: '其他说明', placeholder: '例如需要支持 DirectX 12' },
] as const
type ConfigKey = typeof CONFIG_FIELDS[number]['key']
type ConfigFields = Record<ConfigKey, string>
type GameForm = GamePayload & { id?: number; minConfigFields: ConfigFields }
type TaxonomyForm = TaxonomyPayload & { id?: number }

const activeTab = ref<Tab>('overview')
const loading = ref(false)
const overview = ref<AdminOverview>({ users: 0, games: 0, pendingOrders: 0, openFeedback: 0 })
const games = ref<AdminGame[]>([])
const orders = ref<AdminOrder[]>([])
const feedback = ref<AdminFeedback[]>([])
const users = ref<AdminUser[]>([])
const categories = ref<AdminTaxonomy[]>([])
const tags = ref<AdminTaxonomy[]>([])
const userExpiryValues = ref<Record<number, string>>({})
const gameDialog = ref(false)
const savingGame = ref(false)
const uploadingCover = ref(false)
const gameForm = ref<GameForm>(emptyGameForm())
const taxonomyDialog = ref(false)
const savingTaxonomy = ref(false)
const taxonomyKind = ref<TaxonomyKind>('categories')
const taxonomyForm = ref<TaxonomyForm>({ name: '', slug: '', status: 'active', sort: 0 })
const tabs = [
  { value: 'overview' as const, label: '概览', icon: LayoutDashboard },
  { value: 'games' as const, label: '游戏资源', icon: Gamepad2 },
  { value: 'taxonomy' as const, label: '分类与标签', icon: Tags },
  { value: 'orders' as const, label: '会员工单', icon: ClipboardList },
  { value: 'feedback' as const, label: '反馈处理', icon: MessageSquareText },
  { value: 'users' as const, label: '用户管理', icon: Users },
]

onMounted(() => { void loadTab('overview') })

async function loadTab(tab: Tab) {
  activeTab.value = tab
  loading.value = true
  try {
    if (tab === 'overview') overview.value = await adminApi.overview()
    if (tab === 'games') {
      const [gameItems, categoryItems, tagItems] = await Promise.all([adminApi.games(), adminApi.categories(), adminApi.tags()])
      games.value = gameItems
      categories.value = categoryItems
      tags.value = tagItems
    }
    if (tab === 'taxonomy') await loadTaxonomies()
    if (tab === 'orders') orders.value = await adminApi.orders()
    if (tab === 'feedback') feedback.value = await adminApi.feedback()
    if (tab === 'users') {
      users.value = await adminApi.users()
      userExpiryValues.value = Object.fromEntries(users.value.map((user) => [user.id, user.member_expire_at?.replace(' ', 'T').slice(0, 16) ?? '']))
    }
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '管理数据加载失败')
  } finally {
    loading.value = false
  }
}

async function loadTaxonomies() {
  const [categoryItems, tagItems] = await Promise.all([adminApi.categories(), adminApi.tags()])
  categories.value = categoryItems
  tags.value = tagItems
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
    await loadTaxonomies()
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

function emptyGameForm(): GameForm {
  return {
    name: '', slug: '', coverUrl: '', description: '', minConfig: [], minConfigFields: emptyConfigFields(), categoryId: 0,
    resourceType: 'free', resourceStatus: 'available', status: 'draft', publishAt: new Date().toISOString().slice(0, 10),
    tagIds: [], downloads: [],
  }
}

function emptyConfigFields(): ConfigFields {
  return { os: '', cpu: '', memory: '', gpu: '', storage: '', other: '' }
}

function parseConfigFields(items: string[]): ConfigFields {
  const fields = emptyConfigFields()
  for (const item of items) {
    const separator = item.search(/[:：]/)
    if (separator < 0) {
      fields.other = [fields.other, item].filter(Boolean).join('\n')
      continue
    }
    const label = item.slice(0, separator).trim()
    const value = item.slice(separator + 1).trim()
    const key: ConfigKey = label.includes('操作系统') ? 'os'
      : label.includes('处理器') || label.toLowerCase().includes('cpu') ? 'cpu'
        : label.includes('内存') ? 'memory'
          : label.includes('显卡') || label.toLowerCase().includes('gpu') ? 'gpu'
            : label.includes('存储') || label.includes('硬盘') ? 'storage' : 'other'
    fields[key] = [fields[key], value].filter(Boolean).join('\n')
  }
  return fields
}

function serializeConfigFields(fields: ConfigFields) {
  return CONFIG_FIELDS.map((field) => {
    const value = fields[field.key].trim()
    return value ? `${field.label.replace('（CPU）', '')}：${value}` : ''
  }).filter(Boolean)
}

function openNewGame() {
  gameForm.value = emptyGameForm()
  gameDialog.value = true
}

async function openEditGame(id: number) {
  try {
    const item = await adminApi.game(id)
    gameForm.value = {
      id: item.id,
      name: item.name,
      slug: item.slug,
      coverUrl: item.cover_url,
      description: item.description,
      minConfig: JSON.parse(item.min_config) as string[],
      minConfigFields: parseConfigFields(JSON.parse(item.min_config) as string[]),
      categoryId: item.category_id,
      resourceType: item.resource_type,
      resourceStatus: item.resource_status,
      status: item.status,
      publishAt: item.publish_at,
      tagIds: item.tagIds,
      downloads: item.downloads,
    }
    gameDialog.value = true
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '游戏详情加载失败')
  }
}

function addDownload() {
  gameForm.value.downloads.push({ provider: '', label: '', url: '', sort: gameForm.value.downloads.length * 10 })
}

async function uploadCover(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    ElMessage.error('封面仅支持 JPG、PNG、WebP，大小不能超过 5 MB')
    input.value = ''
    return
  }
  uploadingCover.value = true
  try {
    const body = new FormData()
    body.append('file', file)
    body.append('upload_preset', 'muri10086')
    body.append('folder', 'game')
    const response = await fetch('https://api.cloudinary.com/v1_1/wmu4lce4/image/upload', { method: 'POST', body })
    if (!response.ok) throw new Error('upload_failed')
    const result = await response.json() as { secure_url: string }
    gameForm.value.coverUrl = result.secure_url
    ElMessage.success('封面上传成功')
  } catch {
    ElMessage.error('封面上传失败，请稍后重试')
  } finally {
    uploadingCover.value = false
    input.value = ''
  }
}

async function saveGame() {
  const value = gameForm.value
  value.minConfig = serializeConfigFields(value.minConfigFields)
  if (!value.name || !value.slug || !value.coverUrl || !value.description || !value.categoryId || !value.minConfig.length) {
    ElMessage.error('请完整填写游戏名称、slug、封面、分类、介绍和最低配置')
    return
  }
  savingGame.value = true
  try {
    const payload: GamePayload = {
      name: value.name, slug: value.slug, coverUrl: value.coverUrl, description: value.description,
      minConfig: value.minConfig, categoryId: Number(value.categoryId), resourceType: value.resourceType,
      resourceStatus: value.resourceStatus, status: value.status, publishAt: value.publishAt || null,
      tagIds: value.tagIds.map(Number), downloads: value.downloads.map((item, index) => ({ ...item, sort: Number(item.sort ?? index * 10) })),
    }
    if (value.id) await adminApi.updateGame(value.id, payload)
    else await adminApi.createGame(payload)
    ElMessage.success(value.id ? '游戏已更新' : '游戏已创建')
    gameDialog.value = false
    await loadTab('games')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '保存失败')
  } finally {
    savingGame.value = false
  }
}

async function deleteGame(item: AdminGame) {
  if (!window.confirm(`确定下架并删除“${item.name}”吗？`)) return
  try {
    await adminApi.deleteGame(item.id)
    ElMessage.success('游戏已删除')
    await loadTab('games')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '删除失败')
  }
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

async function saveUser(user: AdminUser) {
  let memberExpireAt: string | null = null
  if (user.member_type === 'monthly') {
    const raw = userExpiryValues.value[user.id]
    if (!raw) { ElMessage.error('月度会员必须设置到期时间'); return }
    memberExpireAt = new Date(raw).toISOString()
  }
  try {
    await adminApi.updateUser(user.id, { status: user.status, role: user.role, memberType: user.member_type, memberExpireAt })
    ElMessage.success(`${user.username} 已更新`)
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '用户更新失败')
  }
}
</script>

<template>
  <section class="admin-page">
    <div class="container admin-shell">
      <aside class="admin-sidebar">
        <div><span class="eyebrow">ADMIN</span><h1>管理后台</h1></div>
        <button v-for="tab in tabs" :key="tab.value" :class="{ active: activeTab === tab.value }" @click="loadTab(tab.value)"><component :is="tab.icon" :size="18" />{{ tab.label }}</button>
      </aside>

      <main class="admin-content">
        <div class="admin-toolbar"><div><h2>{{ tabs.find((tab) => tab.value === activeTab)?.label }}</h2><p>管理站点数据与待办事项。</p></div><button class="icon-button" title="刷新" @click="loadTab(activeTab)"><RefreshCw :size="18" /></button></div>
        <div v-if="loading" class="empty-state compact"><p>正在加载...</p></div>

        <div v-else-if="activeTab === 'overview'" class="admin-stats">
          <div><Users :size="22" /><span>用户</span><strong>{{ overview.users }}</strong></div>
          <div><Gamepad2 :size="22" /><span>游戏</span><strong>{{ overview.games }}</strong></div>
          <div><ClipboardList :size="22" /><span>待审工单</span><strong>{{ overview.pendingOrders }}</strong></div>
          <div><MessageSquareText :size="22" /><span>待处理反馈</span><strong>{{ overview.openFeedback }}</strong></div>
        </div>

        <template v-else-if="activeTab === 'games'">
          <div class="admin-actions"><button class="button button-primary" @click="openNewGame"><Plus :size="17" />新增游戏</button></div>
          <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>游戏</th><th>分类</th><th>权限</th><th>发布状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in games" :key="item.id"><td><div class="admin-game-cell"><img :src="item.cover_url" alt="" /><div><strong>{{ item.name }}</strong><small>{{ item.slug }}</small></div></div></td><td>{{ item.category }}</td><td>{{ item.resource_type === 'free' ? '免费' : '会员' }}</td><td>{{ item.status }}</td><td><div class="row-actions"><button @click="openEditGame(item.id)">编辑</button><button class="danger" title="删除" @click="deleteGame(item)"><Trash2 :size="16" /></button></div></td></tr></tbody></table></div>
        </template>

        <template v-else-if="activeTab === 'taxonomy'">
          <div class="taxonomy-sections">
            <section>
              <div class="taxonomy-heading"><div><h3>游戏分类</h3><p>用于游戏列表筛选与归档，可通过排序值调整展示顺序。</p></div><button class="button button-primary button-small" @click="openTaxonomy('categories')"><Plus :size="16" />新增分类</button></div>
              <div class="admin-table-wrap"><table class="admin-table taxonomy-table"><thead><tr><th>名称</th><th>Slug</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in categories" :key="item.id"><td><strong>{{ item.name }}</strong></td><td><code>{{ item.slug }}</code></td><td>{{ item.sort }}</td><td><span :class="['taxonomy-status', item.status]">{{ item.status === 'active' ? '启用' : '停用' }}</span></td><td><div class="row-actions"><button @click="openTaxonomy('categories', item)">编辑</button><button class="danger" title="删除" @click="deleteTaxonomy('categories', item)"><Trash2 :size="16" /></button></div></td></tr></tbody></table></div>
            </section>
            <section>
              <div class="taxonomy-heading"><div><h3>游戏标签</h3><p>用于标记游戏特征和组合筛选。</p></div><button class="button button-primary button-small" @click="openTaxonomy('tags')"><Plus :size="16" />新增标签</button></div>
              <div class="admin-table-wrap"><table class="admin-table taxonomy-table"><thead><tr><th>名称</th><th>Slug</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in tags" :key="item.id"><td><strong>{{ item.name }}</strong></td><td><code>{{ item.slug }}</code></td><td><span :class="['taxonomy-status', item.status]">{{ item.status === 'active' ? '启用' : '停用' }}</span></td><td><div class="row-actions"><button @click="openTaxonomy('tags', item)">编辑</button><button class="danger" title="删除" @click="deleteTaxonomy('tags', item)"><Trash2 :size="16" /></button></div></td></tr></tbody></table></div>
            </section>
          </div>
        </template>

        <template v-else-if="activeTab === 'orders'">
          <div v-if="!orders.length" class="empty-state compact"><CheckCircle2 :size="28" /><h3>暂无会员工单</h3></div>
          <div v-else class="admin-list"><article v-for="item in orders" :key="item.id" class="admin-list-row"><div><span class="history-type">#{{ item.id }} · {{ item.username }}</span><h3>{{ item.plan === 'monthly' ? '月度会员' : '终身会员' }} · {{ item.payment_channel === 'wechat' ? '微信' : '支付宝' }}</h3><p>{{ item.submitted_at }}</p><small v-if="item.admin_note">{{ item.admin_note }}</small></div><div class="row-actions"><span :class="['order-status', item.status]">{{ item.status }}</span><template v-if="item.status === 'pending'"><button class="approve" @click="reviewOrder(item, 'approved')">通过</button><button class="danger-text" @click="reviewOrder(item, 'rejected')">驳回</button></template></div></article></div>
        </template>

        <template v-else-if="activeTab === 'feedback'">
          <div v-if="!feedback.length" class="empty-state compact"><MessageSquareText :size="28" /><h3>暂无反馈</h3></div>
          <div v-else class="admin-list"><article v-for="item in feedback" :key="item.id" class="admin-list-row feedback-admin-row"><div><span class="history-type">{{ item.username }} · {{ item.type }}</span><h3>{{ item.title }}</h3><p>{{ item.content }}</p><small>{{ item.created_at }}</small></div><div class="admin-inline-form"><select v-model="item.status"><option value="pending">待处理</option><option value="processing">处理中</option><option value="resolved">已处理</option><option value="closed">已关闭</option></select><textarea v-model="item.admin_reply" placeholder="管理员回复" maxlength="500"></textarea><button class="button button-primary button-small" @click="saveFeedback(item)">保存</button></div></article></div>
        </template>

        <template v-else-if="activeTab === 'users'">
          <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>会员</th><th>到期时间</th><th>操作</th></tr></thead><tbody><tr v-for="item in users" :key="item.id"><td><strong>{{ item.username }}</strong><small class="table-subline">{{ item.created_at }}</small></td><td><select v-model="item.role"><option value="user">用户</option><option value="admin">管理员</option></select></td><td><select v-model="item.status"><option value="active">启用</option><option value="disabled">禁用</option></select></td><td><select v-model="item.member_type"><option value="none">普通</option><option value="monthly">月度</option><option value="lifetime">终身</option></select></td><td><input v-if="item.member_type === 'monthly'" v-model="userExpiryValues[item.id]" type="datetime-local" /><span v-else>-</span></td><td><button class="button button-secondary button-small" @click="saveUser(item)">保存</button></td></tr></tbody></table></div>
        </template>
      </main>
    </div>
  </section>

  <el-dialog v-model="gameDialog" :title="gameForm.id ? '编辑游戏' : '新增游戏'" width="min(860px, 96vw)" class="game-editor-dialog">
    <form class="game-editor" @submit.prevent="saveGame">
      <label>游戏名称<input v-model="gameForm.name" maxlength="100" required /></label>
      <label>Slug<input v-model="gameForm.slug" maxlength="100" placeholder="example-game" required /></label>
      <label class="wide">封面地址<div class="cover-input-row"><input v-model="gameForm.coverUrl" required /><label class="button button-secondary upload-button"><Upload :size="16" />{{ uploadingCover ? '上传中...' : '上传封面' }}<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="uploadingCover" @change="uploadCover" /></label></div></label>
      <img v-if="gameForm.coverUrl" :src="gameForm.coverUrl" alt="封面预览" class="cover-preview" />
      <label>分类<select v-model.number="gameForm.categoryId" required><option :value="0" disabled>请选择</option><option v-for="item in categories.filter((entry) => entry.status === 'active')" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      <label>资源权限<select v-model="gameForm.resourceType"><option value="free">免费</option><option value="member">会员</option></select></label>
      <label>资源状态<select v-model="gameForm.resourceStatus"><option value="available">可用</option><option value="checking">检查中</option><option value="unavailable">不可用</option></select></label>
      <label>发布状态<select v-model="gameForm.status"><option value="draft">草稿</option><option value="published">发布</option><option value="offline">下架</option></select></label>
      <label>发布日期<input v-model="gameForm.publishAt" type="date" /></label>
      <label class="wide">游戏介绍<textarea v-model="gameForm.description" rows="5" maxlength="5000" required></textarea></label>
      <fieldset class="wide config-editor"><legend>最低配置</legend><label v-for="field in CONFIG_FIELDS" :key="field.key">{{ field.label }}<input v-model="gameForm.minConfigFields[field.key]" :placeholder="field.placeholder" maxlength="200" /></label><p>至少填写一项；每个字段可填写多行内容。</p></fieldset>
      <fieldset class="wide"><legend>标签</legend><label v-for="item in tags.filter((entry) => entry.status === 'active')" :key="item.id" class="tag-option"><input v-model="gameForm.tagIds" type="checkbox" :value="item.id" />{{ item.name }}</label></fieldset>
      <fieldset class="wide download-editor"><legend>下载地址</legend><div v-for="(item, index) in gameForm.downloads" :key="index" class="download-editor-row"><input v-model="item.provider" placeholder="网盘名称" /><input v-model="item.label" placeholder="资源说明" /><input v-model="item.url" type="url" placeholder="https://..." /><button type="button" class="icon-button" title="移除" @click="gameForm.downloads.splice(index, 1)"><Trash2 :size="17" /></button></div><button type="button" class="button button-secondary button-small" @click="addDownload"><Plus :size="16" />添加地址</button></fieldset>
    </form>
    <template #footer><el-button @click="gameDialog = false">取消</el-button><el-button type="primary" :loading="savingGame" @click="saveGame">保存游戏</el-button></template>
  </el-dialog>

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
