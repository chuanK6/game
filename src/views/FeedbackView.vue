<script setup lang="ts">
import { ref } from 'vue'
import { Bug, Gamepad2, HelpCircle, MessageSquareText, Send } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'

const type = ref('add_game')
const title = ref('')
const content = ref('')
const types = [
  { value: 'add_game', label: '添加游戏', icon: Gamepad2 },
  { value: 'resource', label: '资源失效', icon: Bug },
  { value: 'website', label: '网站问题', icon: HelpCircle },
  { value: 'other', label: '其他反馈', icon: MessageSquareText },
]

function submit() {
  ElMessage.success('留言已提交，可在个人中心查看处理进度')
  title.value = ''
  content.value = ''
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
        <button class="button button-primary feedback-submit" :disabled="!title.trim() || !content.trim()"><Send :size="17" />提交留言</button>
      </form>
    </div>
  </section>
</template>
