<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElButton, ElDialog, ElDrawer, ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import { RefreshCw, Search, Trash2 } from 'lucide-vue-next'
import { adminApi, ApiError, type AdminUser, type AdminUserUpdate } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatDateTimeInput, shanghaiInputToIso } from '@/utils/date'
import { withRequestTimeout } from '@/utils/requestTimeout'

const auth = useAuthStore()
const users = ref<AdminUser[]>([])
const counts = ref({ total: 0, admin: 0, user: 0 })
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const error = ref('')
const search = ref('')
const appliedSearch = ref('')
const role = ref<'' | AdminUser['role']>('')
const status = ref<'' | AdminUser['status']>('')
const memberType = ref<'' | AdminUser['member_type']>('')
const selected = ref<number[]>([])
const drawer = ref(false)
const editing = ref<AdminUser | null>(null)
const expiry = ref('')
const saving = ref(false)
const bulkDialog = ref(false)
const bulkType = ref<AdminUser['member_type']>('monthly')
const bulkExpiry = ref('')
const roleTabs = [{ value: '' as const, label: '全部', count: 'total' as const }, { value: 'admin' as const, label: '管理员', count: 'admin' as const }, { value: 'user' as const, label: '普通用户', count: 'user' as const }]
const memberLabels = { none: '普通', monthly: '月度会员', lifetime: '终身会员' }
let controller: AbortController | undefined
let version = 0

function protection(user: AdminUser) {
  if (user.is_super === 1) return '超级管理员不可操作'
  if (user.id === auth.user?.id) return '不能删除、禁用或降级自己'
  if (user.role === 'admin' && !auth.user?.isSuper) return '普通管理员只能管理普通用户'
  return ''
}
const selectable = computed(() => users.value.filter(user => !protection(user)))
const allSelected = computed(() => selectable.value.length > 0 && selectable.value.every(user => selected.value.includes(user.id)))
const partialSelected = computed(() => selected.value.length > 0 && !allSelected.value)
function toggleAll(checked: boolean) { selected.value = checked ? selectable.value.map(user => user.id) : [] }
function toggleUser(id: number, checked: boolean) { selected.value = checked ? [...selected.value, id] : selected.value.filter(value => value !== id) }

async function load() {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  const request = ++version
  loading.value = true
  error.value = ''
  selected.value = []
  try {
    const result = await withRequestTimeout(signal => adminApi.users({ q: appliedSearch.value, page: page.value, role: role.value || undefined, status: status.value || undefined, memberType: memberType.value || undefined }, signal), 15000, signal)
    if (request !== version || signal.aborted) return
    users.value = result.users
    counts.value = result.counts
    total.value = result.pagination.total
    page.value = result.pagination.page
  } catch (reason) {
    if (request === version && !signal.aborted) error.value = reason instanceof ApiError ? reason.message : '用户列表加载失败，请重试。'
  } finally { if (request === version) loading.value = false }
}
function applyFilters() { appliedSearch.value = search.value.trim(); page.value = 1; void load() }
function changeRole(value: typeof role.value) { role.value = value; page.value = 1; void load() }
function changePage(value: number) { page.value = value; void load() }
onMounted(() => { void load() })
onBeforeUnmount(() => { version++; controller?.abort() })
defineExpose({ refresh: load })

function nearExpiry(user: AdminUser) {
  if (user.member_type !== 'monthly') return false
  const value = shanghaiInputToIso(formatDateTimeInput(user.member_expire_at))
  const remaining = value ? Date.parse(value) - Date.now() : 0
  return remaining > 0 && remaining <= 7 * 86400000
}
function openEdit(user: AdminUser) {
  if (protection(user) || saving.value) return
  editing.value = { ...user }
  expiry.value = formatDateTimeInput(user.member_expire_at)
  drawer.value = true
}
function membershipExpiry(type: AdminUser['member_type'], value: string) {
  if (type !== 'monthly') return null
  const iso = value ? shanghaiInputToIso(value) : null
  if (!iso) throw new Error('月度会员必须设置有效的到期时间')
  return iso
}
function showError(reason: unknown) { ElMessage.error(reason instanceof Error ? reason.message : '操作失败，请重试') }
async function save() {
  if (!editing.value || saving.value) return
  const user = editing.value
  let payload: AdminUserUpdate
  try {
    payload = { status: user.status, memberType: user.member_type, memberExpireAt: membershipExpiry(user.member_type, expiry.value) }
    if (auth.user?.isSuper) payload.role = user.role
  } catch (reason) { showError(reason); return }
  saving.value = true
  try {
    await adminApi.updateUser(user.id, payload)
    drawer.value = false
    ElMessage.success(`${user.username} 已更新`)
    await load()
  } catch (reason) { showError(reason) } finally { saving.value = false }
}
async function deleteUser(user: AdminUser) {
  if (protection(user) || saving.value) return
  try {
    await ElMessageBox.confirm(`确定删除用户“${user.username}”吗？该账号将被禁用并退出登录。`, '删除用户', { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  saving.value = true
  try { await adminApi.deleteUser(user.id); ElMessage.success('用户已删除'); await load() }
  catch (reason) { showError(reason) } finally { saving.value = false }
}
async function bulkDisable() {
  if (!selected.value.length || saving.value) return
  const ids = [...selected.value]
  try { await ElMessageBox.confirm(`确定禁用选中的 ${ids.length} 个账号吗？这些用户将立即退出登录。`, '批量禁用', { type: 'warning', confirmButtonText: '确认禁用', cancelButtonText: '取消' }) }
  catch { return }
  saving.value = true
  try { await adminApi.bulkUsers({ action: 'disable', ids }); ElMessage.success(`已禁用 ${ids.length} 个账号`); await load() }
  catch (reason) { showError(reason) } finally { saving.value = false }
}
async function bulkMembership() {
  if (!selected.value.length || saving.value) return
  let memberExpireAt: string | null
  try { memberExpireAt = membershipExpiry(bulkType.value, bulkExpiry.value) } catch (reason) { showError(reason); return }
  saving.value = true
  try {
    const result = await adminApi.bulkUsers({ action: 'membership', ids: [...selected.value], memberType: bulkType.value, memberExpireAt })
    bulkDialog.value = false
    ElMessage.success(`已更新 ${result.updated} 个账号的会员`)
    await load()
  } catch (reason) { showError(reason) } finally { saving.value = false }
}
</script>

<template>
  <section class="admin-surface admin-users" :aria-busy="loading">
    <div class="user-role-tabs" role="tablist" aria-label="用户角色">
      <button v-for="tab in roleTabs" :key="tab.value" type="button" role="tab" :aria-selected="role === tab.value" :disabled="saving" @click="changeRole(tab.value)">{{ tab.label }} <span>({{ counts[tab.count] }})</span></button>
    </div>
    <form class="admin-game-filters user-filters" aria-label="用户筛选" @submit.prevent="applyFilters">
      <div class="admin-search"><Search :size="17" /><input v-model="search" aria-label="搜索用户名" maxlength="100" placeholder="搜索用户名" :disabled="saving" /><button type="submit" :disabled="saving">搜索</button></div>
      <label class="admin-filter"><span>账号状态</span><select v-model="status" aria-label="账号状态" :disabled="saving" @change="applyFilters"><option value="">全部</option><option value="active">启用</option><option value="disabled">禁用</option></select></label>
      <label class="admin-filter"><span>会员状态</span><select v-model="memberType" aria-label="会员状态" :disabled="saving" @change="applyFilters"><option value="">全部</option><option value="none">普通</option><option value="monthly">月度</option><option value="lifetime">终身</option></select></label>
    </form>
    <div class="user-bulk-bar"><span aria-live="polite">已选 {{ selected.length }} 项 <small>（当前页）</small></span><button type="button" class="button button-secondary button-small" :disabled="!selected.length || loading || saving" @click="bulkDisable">批量禁用</button><button type="button" class="button button-secondary button-small" :disabled="!selected.length || loading || saving" @click="bulkDialog = true">批量设置会员</button></div>
    <div v-if="error" class="admin-load-error" role="alert"><p>{{ error }}</p><button type="button" class="button button-secondary button-small" @click="load">重新加载</button></div>
    <div v-else class="admin-table-wrap"><table class="admin-table hoverable-table user-list-table">
      <thead><tr><th class="user-checkbox"><input type="checkbox" aria-label="全选当前页可操作用户" :checked="allSelected" :indeterminate="partialSelected" :disabled="loading || saving || !selectable.length" @change="toggleAll(($event.target as HTMLInputElement).checked)" /></th><th>用户</th><th>角色</th><th>账号状态</th><th>会员</th><th>最近登录时间</th><th class="actions-heading">操作</th></tr></thead>
      <tbody>
        <tr v-if="loading"><td colspan="7" class="admin-table-empty"><RefreshCw :size="22" /><p>正在加载用户…</p></td></tr>
        <tr v-else-if="!users.length"><td colspan="7" class="admin-table-empty">没有符合条件的用户</td></tr>
        <tr v-for="item in loading ? [] : users" :key="item.id">
          <td class="user-checkbox"><input type="checkbox" :aria-label="`选择${item.username}`" :title="protection(item) || undefined" :disabled="!!protection(item) || saving" :checked="selected.includes(item.id)" @change="toggleUser(item.id, ($event.target as HTMLInputElement).checked)" /></td>
          <td><strong>{{ item.username }}</strong><small class="table-subline">注册于 {{ formatDateTime(item.created_at) }}</small></td>
          <td><span :class="['user-badge', item.is_super === 1 ? 'super' : item.role]">{{ item.is_super === 1 ? '超级管理员' : item.role === 'admin' ? '管理员' : '普通用户' }}</span></td>
          <td><span :class="['user-badge', item.status]">{{ item.status === 'active' ? '启用' : '禁用' }}</span></td>
          <td :class="{ 'user-expiring': nearExpiry(item) }"><span>{{ memberLabels[item.member_type] }}</span><small v-if="item.member_type === 'monthly'" class="table-subline">到期 {{ formatDateTime(item.member_expire_at) }}</small><small v-else-if="item.member_expire_at" class="table-subline">原到期 {{ formatDateTime(item.member_expire_at) }}</small><small v-if="nearExpiry(item)" class="table-subline">7 天内到期</small></td>
          <td>{{ formatDateTime(item.last_login_at, '暂无记录') }}</td>
          <td><div class="row-actions"><button :disabled="!!protection(item) || saving" :title="protection(item) || undefined" @click="openEdit(item)">编辑</button><button class="danger" :aria-label="`删除${item.username}`" :disabled="!!protection(item) || saving" :title="protection(item) || '删除用户'" @click="deleteUser(item)"><Trash2 :size="16" /></button></div><small v-if="protection(item)" class="table-subline user-protection">{{ protection(item) }}</small></td>
        </tr>
      </tbody>
    </table></div>
    <div class="admin-pagination"><span aria-live="polite">共 {{ total }} 个用户</span><ElPagination v-if="total > 10" background layout="prev, pager, next" :pager-count="5" :disabled="loading || saving" :current-page="page" :page-size="10" :total="total" @current-change="changePage" /></div>
  </section>
  <ElDrawer v-model="drawer" class="admin-user-drawer" title="编辑用户" size="min(440px, 100vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
    <form v-if="editing" id="user-edit-form" class="user-edit-form" @submit.prevent="save">
      <p class="user-edit-name">{{ editing.username }}</p>
      <label>角色<select v-model="editing.role" aria-label="角色" :disabled="!auth.user?.isSuper || saving"><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
      <small v-if="!auth.user?.isSuper">只有超级管理员可以任命或撤销管理员。</small>
      <label>账号状态<select v-model="editing.status" :disabled="saving"><option value="active">启用</option><option value="disabled">禁用</option></select></label>
      <label>会员类型<select v-model="editing.member_type" :disabled="saving"><option value="none">普通</option><option value="monthly">月度会员</option><option value="lifetime">终身会员</option></select></label>
      <label v-if="editing.member_type === 'monthly'">到期时间（北京时间）<input v-model="expiry" type="datetime-local" :disabled="saving" required /></label>
    </form>
    <template #footer><ElButton :disabled="saving" @click="drawer = false">取消</ElButton><ElButton type="primary" :loading="saving" native-type="submit" form="user-edit-form">保存</ElButton></template>
  </ElDrawer>
  <ElDialog v-model="bulkDialog" title="批量设置会员" width="min(440px, 94vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
    <form id="bulk-membership-form" class="user-edit-form" @submit.prevent="bulkMembership"><p>统一调整选中的 {{ selected.length }} 个账号。</p><label>会员类型<select v-model="bulkType" :disabled="saving"><option value="none">普通</option><option value="monthly">月度会员</option><option value="lifetime">终身会员</option></select></label><label v-if="bulkType === 'monthly'">到期时间（北京时间）<input v-model="bulkExpiry" type="datetime-local" :disabled="saving" required /></label></form>
    <template #footer><ElButton :disabled="saving" @click="bulkDialog = false">取消</ElButton><ElButton type="primary" :loading="saving" native-type="submit" form="bulk-membership-form">确认设置</ElButton></template>
  </ElDialog>
</template>
