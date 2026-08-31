<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronRight, Clock3, Crown, LogOut, ReceiptText, ShieldCheck, UserRound } from 'lucide-vue-next'
import { ElButton, ElDialog, ElMessage } from 'element-plus'
import { ApiError, authApi, membershipApi, type MembershipOrder } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const activeTab = ref(String(route.query.tab ?? 'account'))
const paymentOpen = ref(false)
const selectedPlan = ref<'monthly' | 'lifetime'>('monthly')
const selectedChannel = ref<'wechat' | 'alipay'>('wechat')
const submittingOrder = ref(false)
const ordersLoading = ref(true)
const orders = ref<MembershipOrder[]>([])
const currentPassword = ref('')
const newPassword = ref('')
const passwordLoading = ref(false)
const plans = {
  monthly: { name: '月度会员', price: '1', suffix: '/ 月', features: ['完整会员资源库', '有效期内持续访问', '到期自动恢复普通用户'] },
  lifetime: { name: '终身会员', price: '9.9', suffix: '一次买断', features: ['完整会员资源库', '无需续费', '永久会员标识'] },
}
const paymentImage = computed(() => `/assets/payment/${selectedChannel.value}-${selectedPlan.value}.jpg`)
const memberStatus = computed(() => {
  if (auth.user?.memberType === 'lifetime') return '终身会员'
  if (auth.user?.memberType === 'monthly') return `有效至 ${auth.user.memberExpireAt ?? '-'}`
  return '普通用户'
})
const orderStatusLabels: Record<MembershipOrder['status'], string> = { pending: '待审核', approved: '已开通', rejected: '已驳回' }

watch(() => route.query.tab, (tab) => { activeTab.value = String(tab ?? 'account') })
onMounted(() => { void loadOrders() })

function setTab(tab: string) {
  activeTab.value = tab
  void router.replace({ query: tab === 'account' ? {} : { tab } })
}

function openPayment(plan: 'monthly' | 'lifetime') {
  selectedPlan.value = plan
  selectedChannel.value = 'wechat'
  paymentOpen.value = true
}

async function loadOrders() {
  ordersLoading.value = true
  try {
    orders.value = await membershipApi.orders()
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '工单加载失败')
  } finally {
    ordersLoading.value = false
  }
}

async function submitOrder() {
  submittingOrder.value = true
  try {
    await membershipApi.createOrder(selectedPlan.value, selectedChannel.value)
    ElMessage.success('工单已提交，请等待管理员核对')
    paymentOpen.value = false
    await loadOrders()
    setTab('orders')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '工单提交失败')
  } finally {
    submittingOrder.value = false
  }
}

async function changePassword() {
  if (!currentPassword.value || newPassword.value.length < 8) return
  passwordLoading.value = true
  try {
    await authApi.changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = ''
    newPassword.value = ''
    ElMessage.success('密码已修改，其他设备的登录会话已失效')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '密码修改失败')
  } finally {
    passwordLoading.value = false
  }
}

async function logout() {
  await auth.logout()
  await router.push('/')
}
</script>

<template>
  <section class="page-banner profile-banner"><div class="container"><span class="eyebrow light">MY YOULUN</span><h1>个人中心</h1><p>管理账号、会员状态和服务工单。</p></div></section>
  <section class="section profile-section">
    <div class="container profile-layout">
      <aside class="profile-nav">
        <div class="profile-user"><span class="profile-avatar">{{ auth.user?.username.slice(0, 1).toUpperCase() }}</span><div><strong>{{ auth.user?.username }}</strong><span>{{ memberStatus }}</span></div></div>
        <button :class="{ active: activeTab === 'account' }" @click="setTab('account')"><UserRound :size="18" />账号信息<ChevronRight :size="16" /></button>
        <button :class="{ active: activeTab === 'membership' }" @click="setTab('membership')"><Crown :size="18" />会员中心<ChevronRight :size="16" /></button>
        <button :class="{ active: activeTab === 'orders' }" @click="setTab('orders')"><ReceiptText :size="18" />我的工单<ChevronRight :size="16" /></button>
        <button class="logout-link" @click="logout"><LogOut :size="18" />退出登录</button>
      </aside>

      <div class="profile-content">
        <template v-if="activeTab === 'account'">
          <div class="content-title"><h2>账号信息</h2><p>查看账号状态和修改登录密码。</p></div>
          <div class="info-rows">
            <div><span>用户名</span><strong>{{ auth.user?.username }}</strong></div>
            <div><span>账号状态</span><strong class="status-ok"><ShieldCheck :size="17" />正常</strong></div>
            <div><span>会员状态</span><strong>{{ memberStatus }}</strong></div>
          </div>
          <div class="content-title secondary"><h2>修改密码</h2></div>
          <form class="password-form" @submit.prevent="changePassword">
            <label>当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" required /></label>
            <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" minlength="8" placeholder="至少 8 位，包含字母和数字" required /></label>
            <button class="button button-primary" :disabled="passwordLoading || !currentPassword || newPassword.length < 8">{{ passwordLoading ? '正在保存...' : '保存新密码' }}</button>
          </form>
        </template>

        <template v-else-if="activeTab === 'membership'">
          <div class="content-title"><h2>会员中心</h2><p>选择适合你的方案，访问完整会员资源库。</p></div>
          <div class="membership-status"><div><Crown :size="25" /><span><small>当前状态</small><strong>{{ auth.isMember ? '会员有效' : '尚未开通会员' }}</strong></span></div><span>{{ memberStatus }}</span></div>
          <div class="plans-grid">
            <div v-for="(plan, key) in plans" :key="key" :class="['plan-card', { featured: key === 'lifetime' }]">
              <span v-if="key === 'lifetime'" class="best-value">更省心</span>
              <h3>{{ plan.name }}</h3>
              <div class="plan-price"><span>¥</span>{{ plan.price }}<small>{{ plan.suffix }}</small></div>
              <ul><li v-for="feature in plan.features" :key="feature"><Check :size="17" />{{ feature }}</li></ul>
              <button :class="['button', key === 'lifetime' ? 'button-accent' : 'button-primary']" @click="openPayment(key as 'monthly' | 'lifetime')">选择此方案</button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="content-title"><h2>我的工单</h2><p>查看会员开通申请的审核进度。</p></div>
          <div v-if="ordersLoading" class="empty-state compact"><p>正在加载工单...</p></div>
          <div v-else-if="orders.length" class="order-list">
            <div v-for="order in orders" :key="order.id" class="order-row"><div class="order-icon"><Clock3 :size="20" /></div><div><strong>{{ plans[order.plan].name }}开通申请</strong><span>{{ order.submitted_at }} · {{ order.payment_channel === 'wechat' ? '微信支付' : '支付宝' }}</span><small v-if="order.admin_note">{{ order.admin_note }}</small></div><span :class="['order-status', order.status]">{{ orderStatusLabels[order.status] }}</span></div>
          </div>
          <div v-else class="empty-state compact"><ReceiptText :size="30" /><h3>暂无工单</h3><p>提交会员开通申请后，可在这里查看进度。</p></div>
        </template>
      </div>
    </div>
  </section>

  <el-dialog v-model="paymentOpen" :title="`开通${plans[selectedPlan].name}`" width="min(520px, 94vw)" class="payment-dialog">
    <div class="channel-switch"><button :class="{ active: selectedChannel === 'wechat' }" @click="selectedChannel = 'wechat'">微信支付</button><button :class="{ active: selectedChannel === 'alipay' }" @click="selectedChannel = 'alipay'">支付宝</button></div>
    <div class="payment-body"><img :src="paymentImage" :alt="`${plans[selectedPlan].name}${selectedChannel === 'wechat' ? '微信' : '支付宝'}收款码`" /><div><span>应付金额</span><strong>¥{{ plans[selectedPlan].price }}</strong><p>付款时请务必备注用户名：</p><code>{{ auth.user?.username }}</code></div></div>
    <div class="payment-notice">付款完成后提交工单，管理员核对到账信息后开通会员。</div>
    <template #footer><el-button @click="paymentOpen = false">稍后支付</el-button><el-button type="primary" :loading="submittingOrder" @click="submitOrder">我已付款，提交工单</el-button></template>
  </el-dialog>
</template>
