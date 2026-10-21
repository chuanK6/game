<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { ElButton, ElDialog, ElMessage } from 'element-plus'
import { adminApi, ApiError, type Announcement, type AnnouncementPayload } from '@/api/client'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps<{ announcement: Announcement | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const form = reactive<AnnouncementPayload>({ title: props.announcement?.title ?? '', content: props.announcement?.content ?? '', status: props.announcement?.status ?? 'draft', showPopup: props.announcement ? props.announcement.show_popup === 1 : true })
const saving = ref(false)
const uploading = ref(false)
const submitted = ref(false)
const titleInput = ref<HTMLInputElement>()
const editor = ref<InstanceType<typeof MarkdownEditor>>()
const titleError = computed(() => !form.title.trim() || form.title.trim().length > 100 ? '请输入 1～100 字符的公告标题' : '')
const contentError = computed(() => !form.content.trim() || form.content.length > 30000 ? '公告正文须为 1～30000 字符' : '')

async function save() {
  if (saving.value || uploading.value) return
  submitted.value = true
  if (titleError.value || contentError.value) {
    await nextTick()
    if (titleError.value) titleInput.value?.focus()
    else await editor.value?.focus()
    return
  }
  saving.value = true
  try {
    const payload = { ...form, title: form.title.trim() }
    if (props.announcement) await adminApi.updateAnnouncement(props.announcement.id, payload)
    else await adminApi.createAnnouncement(payload)
    ElMessage.success(props.announcement ? '公告已更新' : '公告已创建')
    emit('saved')
  } catch (error) { ElMessage.error(error instanceof ApiError ? error.message : '保存失败，请重试') }
  finally { saving.value = false }
}
</script>

<template>
  <el-dialog :model-value="true" :title="announcement ? '编辑公告' : '新增公告'" width="min(1000px, 96vw)" top="4vh" class="admin-editor-dialog announcement-editor-dialog" :close-on-click-modal="false" :show-close="!saving" :close-on-press-escape="!saving" @update:model-value="!$event && emit('close')">
    <form id="announcement-form" class="game-editor tabbed-game-editor announcement-form" novalidate @submit.prevent="save">
      <div class="editor-field"><label for="announcement-title">公告标题 <span class="required-mark">*</span></label><input id="announcement-title" ref="titleInput" v-model="form.title" maxlength="100" :disabled="saving" :aria-invalid="submitted && !!titleError" :aria-describedby="submitted && titleError ? 'announcement-title-error' : undefined" placeholder="请输入公告标题" /><p v-if="submitted && titleError" id="announcement-title-error" class="announcement-field-error" role="alert">{{ titleError }}</p></div>
      <div class="editor-field-grid"><div class="editor-field"><label for="announcement-status">发布状态</label><select id="announcement-status" v-model="form.status" :disabled="saving"><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></div><div class="editor-field"><span class="editor-field-label">弹窗设置</span><label class="announcement-checkbox"><input v-model="form.showPopup" type="checkbox" :disabled="saving" />进入网站时自动弹出</label><small class="announcement-help">仅已发布的公告会对访客显示。</small></div></div>
      <div class="editor-field"><span class="editor-field-label">公告正文 <span class="required-mark">*</span></span><p v-if="submitted && contentError" class="announcement-field-error" role="alert">{{ contentError }}</p><MarkdownEditor label="公告正文" ref="editor" v-model="form.content" :disabled="saving" @uploading="uploading = $event" /></div>
    </form>
    <template #footer><div class="editor-footer"><span class="editor-footer-note">{{ uploading ? '图片上传中，完成后即可保存' : '支持 Markdown 与图片，正文最多 30000 字符' }}</span><div><el-button :disabled="saving" @click="emit('close')">取消</el-button><el-button type="primary" :loading="saving" :disabled="uploading" @click="save">保存公告</el-button></div></div></template>
  </el-dialog>
</template>
