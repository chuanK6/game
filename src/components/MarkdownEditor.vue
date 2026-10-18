<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Bold, Heading2, ImagePlus, Link, List, Maximize2, Minimize2, Quote } from 'lucide-vue-next'
import MarkdownContent from './MarkdownContent.vue'
import { uploadImage } from '@/utils/imageUpload'

const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; uploading: [value: boolean] }>()
const textarea = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const mode = ref<'edit' | 'preview' | 'split'>('split')
const fullscreen = ref(false)
const uploading = ref(false)
const uploadStatus = ref('')
const failedFiles = ref<File[]>([])
const errorText = ref('')
const busy = computed(() => Boolean(props.disabled || uploading.value))
let selection = { start: 0, end: 0 }
let controller: AbortController | undefined

function rememberSelection() {
  if (textarea.value) selection = { start: textarea.value.selectionStart, end: textarea.value.selectionEnd }
}

async function insert(before: string, after = '', placeholder = '') {
  if (busy.value) return
  const chosen = props.modelValue.slice(selection.start, selection.end) || placeholder
  const value = props.modelValue.slice(0, selection.start) + before + chosen + after + props.modelValue.slice(selection.end)
  if (value.length > 30000) { ElMessage.error('介绍不能超过 30000 字符'); return }
  const start = selection.start + before.length
  emit('update:modelValue', value)
  await nextTick()
  textarea.value?.focus()
  textarea.value?.setSelectionRange(start, start + chosen.length)
  rememberSelection()
}

function input(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  rememberSelection()
}

async function uploadFiles(files: File[]) {
  if (busy.value || !files.length) return
  if (files.length > 10) { ElMessage.error('每次最多上传 10 张图片'); return }
  const batch = new AbortController()
  controller = batch
  uploading.value = true
  emit('uploading', true)
  failedFiles.value = []
  errorText.value = ''
  let position = selection.start
  let end = selection.end
  try {
    for (const [index, file] of files.entries()) {
      if (batch.signal.aborted) break
      uploadStatus.value = `正在上传 ${index + 1}/${files.length}：${file.name}`
      try {
        const result = await uploadImage(file, 'content', batch.signal)
        if (batch.signal.aborted) break
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\r\n]/g, ' ').slice(0, 100) || '游戏截图'
        const snippet = `\n\n![${alt}](${result.url})\n\n`
        const value = props.modelValue.slice(0, position) + snippet + props.modelValue.slice(end)
        if (value.length > 30000) throw new Error('介绍已接近 30000 字符，请精简后重新插图')
        emit('update:modelValue', value)
        position += snippet.length
        end = position
        await nextTick()
      } catch (error) {
        if (batch.signal.aborted) break
        failedFiles.value.push(file)
        errorText.value = error instanceof Error ? error.message : '图片上传失败，请重试'
      }
    }
  } finally {
    if (controller === batch) {
      uploading.value = false
      emit('uploading', false)
      uploadStatus.value = ''
      controller = undefined
      if (!batch.signal.aborted) {
        textarea.value?.focus()
        textarea.value?.setSelectionRange(position, position)
        selection = { start: position, end: position }
      }
    }
  }
}

function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  void uploadFiles(Array.from(input.files ?? []))
  input.value = ''
}

function paste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  rememberSelection()
  void uploadFiles(files)
}

function drop(event: DragEvent) {
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  rememberSelection()
  void uploadFiles(Array.from(event.dataTransfer.files))
}

function cancelUpload() { controller?.abort() }
async function focus() {
  mode.value = 'edit'
  await nextTick()
  textarea.value?.focus({ preventScroll: true })
}
defineExpose({ focus })
onBeforeUnmount(() => { controller?.abort(); emit('uploading', false) })
</script>

<template>
  <div :class="['markdown-editor', { 'is-fullscreen': fullscreen }]" @keydown.esc.stop="fullscreen = false">
    <div class="markdown-editor-heading">
      <strong>游戏介绍 <small>Markdown</small></strong>
      <div class="markdown-modes" role="group" aria-label="介绍编辑模式">
        <button type="button" :aria-pressed="mode === 'edit'" @click="mode = 'edit'">编辑</button>
        <button type="button" :aria-pressed="mode === 'preview'" @click="mode = 'preview'">预览</button>
        <button type="button" class="split-mode" :aria-pressed="mode === 'split'" @click="mode = 'split'">双栏</button>
        <button type="button" :aria-label="fullscreen ? '退出全屏编辑' : '全屏编辑'" @click="fullscreen = !fullscreen"><Minimize2 v-if="fullscreen" :size="16" /><Maximize2 v-else :size="16" /></button>
      </div>
    </div>
    <div class="markdown-toolbar" role="toolbar" aria-label="Markdown 工具栏">
      <button type="button" aria-label="插入标题" :disabled="busy" @click="insert('\n## ', '', '标题')"><Heading2 :size="17" /></button>
      <button type="button" aria-label="加粗" :disabled="busy" @click="insert('**', '**', '加粗文字')"><Bold :size="17" /></button>
      <button type="button" aria-label="插入列表" :disabled="busy" @click="insert('\n- ', '', '列表内容')"><List :size="17" /></button>
      <button type="button" aria-label="插入引用" :disabled="busy" @click="insert('\n> ', '', '引用内容')"><Quote :size="17" /></button>
      <button type="button" aria-label="插入链接" :disabled="busy" @click="insert('[', '](https://example.com)', '链接文字')"><Link :size="17" /></button>
      <button type="button" :disabled="busy" @click="fileInput?.click()"><ImagePlus :size="17" />上传图片</button>
      <input ref="fileInput" type="file" class="visually-hidden" accept="image/jpeg,image/png,image/webp" multiple :disabled="busy" aria-label="上传介绍图片" @change="chooseFiles" />
    </div>
    <div :class="['markdown-editor-panes', `mode-${mode}`]">
      <textarea ref="textarea" class="markdown-source" :value="modelValue" :readonly="busy" maxlength="30000" aria-label="游戏介绍 Markdown" placeholder="输入游戏介绍，支持标题、列表和图片。可粘贴截图或拖入图片。" @input="input" @select="rememberSelection" @click="rememberSelection" @keyup="rememberSelection" @blur="rememberSelection" @paste="paste" @dragover.prevent @drop="drop"></textarea>
      <div class="markdown-preview" aria-label="游戏介绍预览"><MarkdownContent v-if="modelValue" :content="modelValue" /><p v-else class="markdown-placeholder">预览会显示在这里</p></div>
    </div>
    <div class="markdown-editor-footer"><span>支持粘贴 / 拖入图片 · JPG、PNG、WebP · 每张 ≤ 5 MB</span><span>{{ modelValue.length }} / 30000</span></div>
    <div v-if="uploading" class="markdown-upload-status" role="status">{{ uploadStatus }}<button type="button" @click="cancelUpload">取消上传</button></div>
    <div v-if="failedFiles.length" class="markdown-upload-error" role="alert"><span>{{ failedFiles.length }} 张图片未插入：{{ errorText }}</span><button type="button" :disabled="busy" @click="uploadFiles([...failedFiles])">重试失败图片</button></div>
  </div>
</template>
