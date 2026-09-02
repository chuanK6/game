<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Bug, Gamepad2, HelpCircle, MessageSquareText, Send } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import { ApiError, feedbackApi, type FeedbackItem } from '@/api/client'
import { formatDateTime } from '@/utils/date'

const type = ref<FeedbackItem['type']>('add_game')
const title = ref('')
const content = ref('')
const submitting = ref(false)
const historyLoading = ref(true)
const history = ref<FeedbackItem[]>([])
const types = [
  { value: 'add_game' as const, label: '添加游戏', icon: Gamepad2 },
  { value: 'resource_invalid' as const, label: '资源失效', icon: Bug },
  { value: 'website' as const, label: '网站问题', icon: HelpCircle },
  { value: 'other' as const, label: '其他反馈', icon: MessageSquareText },
]
const statusLabels: Record<FeedbackItem['status'], string> = {
  pending: '待处理', processing: '处理中', resolved: '已处理', closed: '已关闭',
}

onMounted(() => { void loadHistory() })

async function loadHistory() {
  historyLoading.value = true
  try {
    history.value = await feedbackApi.mine()
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '反馈记录加载失败')
  } finally {
    historyLoading.value = false
  }
}

async function submit() {
  if (!title.value.trim() || !content.value.trim()) return
  submitting.value = true
  try {
    await feedbackApi.create({ type: type.value, title: title.value.trim(), content: content.value.trim() })
    ElMessage.success('留言已提交，可在下方查看处理进度')
    title.value = ''
    content.value = ''
    await loadHistory()
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '提交失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="page-banner feedback-banner"><div class="container"><span class="eyebrow light">FEEDBACK</span><h1>留言板</h1><p>推荐游戏、报告问题，或告诉我们哪里可以做得更好。</p></div></section>
  <section class="section feedback-section">
    <div class="container feedback-layout">
      <aside><h2>选择留言类型</h2><button v-for="item in types" :key="item.value" :class="{ active: type === item.value }" @click="type = item.value"><component :is="item.icon" :size="19" /><span>{{ item.label }}</span></button></aside>
      <form class="feedback-form" @submit.prevent="submit">
        <div class="content-title"><h2>提交留言</h2><p>请尽量提供清楚的信息，方便管理员快速处理。</p></div>
        <label>标题<input v-model="title" maxlength="60" placeholder="用一句话说明你的留言" required /></label>
        <label>详细内容<textarea v-model="content" maxlength="500" placeholder="补充游戏名称、链接状态或复现步骤等信息" required></textarea><small>{{ content.length }} / 500</small></label>
        <button class="button button-primary feedback-submit" :disabled="submitting || !title.trim() || !content.trim()"><Send :size="17" />{{ submitting ? '正在提交...' : '提交留言' }}</button>
      </form>
    </div>

    <div class="container feedback-history">
      <div class="content-title"><h2>我的留言</h2><p>最近提交的反馈和管理员处理结果。</p></div>
      <div v-if="historyLoading" class="empty-state compact"><p>正在加载...</p></div>
      <div v-else-if="!history.length" class="empty-state compact"><MessageSquareText :size="28" /><h3>暂无留言</h3></div>
      <div v-else class="history-list">
        <article v-for="item in history" :key="item.id" class="history-row">
          <div><span class="history-type">{{ types.find((entry) => entry.value === item.type)?.label }}</span><h3>{{ item.title }}</h3><p>{{ item.content }}</p><small>{{ formatDateTime(item.created_at) }}</small></div>
          <div class="history-status"><strong>{{ statusLabels[item.status] }}</strong><p v-if="item.admin_reply">{{ item.admin_reply }}</p></div>
        </article>
      </div>
    </div>
  </section>
</template>
