<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Bold, Code, CodeXml, Heading2, ImagePlus, Italic, Link, List, ListOrdered, Maximize2, Minimize2, Minus, Quote, Redo2, Strikethrough, Table2, Undo2 } from 'lucide-vue-next'
import MarkdownContent from './MarkdownContent.vue'
import { uploadImage } from '@/utils/imageUpload'

const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; uploading: [value: boolean] }>()
const textarea = ref<HTMLTextAreaElement>()
const preview = ref<HTMLDivElement>()
const editor = ref<HTMLDivElement>()
const frame = ref<HTMLDivElement>()
const fullscreenHeight = ref(0)
const fileInput = ref<HTMLInputElement>()
const mode = ref<'edit' | 'preview' | 'split'>('split')
const fullscreen = ref(false)
const uploading = ref(false)
const uploadStatus = ref('')
const failedFiles = ref<File[]>([])
const errorText = ref('')
const busy = computed(() => Boolean(props.disabled || uploading.value))
type Selection = { start: number; end: number }
type HistoryEntry = { value: string; selection: Selection }
let selection: Selection = { start: 0, end: 0 }
const history = ref<HistoryEntry[]>([{ value: props.modelValue, selection: { ...selection } }])
const historyIndex = ref(0)
const canUndo = computed(() => historyIndex.value > 0 && !busy.value)
const canRedo = computed(() => historyIndex.value < history.value.length - 1 && !busy.value)
let lastTyping = 0
let scrollFrame = 0
let disposed = false
let controller: AbortController | undefined
let paneScroll = { source: 0, preview: 0 }

watch(() => props.modelValue, value => {
  if (value === history.value[historyIndex.value]?.value) return
  history.value = [{ value, selection: { start: 0, end: 0 } }]
  historyIndex.value = 0
  selection = { start: 0, end: 0 }
  lastTyping = 0
})

function rememberSelection() {
  if (textarea.value) selection = { start: textarea.value.selectionStart, end: textarea.value.selectionEnd }
}

function preserveToolbarSelection(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('button')) return
  // Keep the textarea's selection and prevent the browser from focusing a toolbar button.
  event.preventDefault()
}

function captureScroll() {
  const positions: Array<{ element: HTMLElement; top: number; left: number }> = []
  if (preview.value?.getClientRects().length) positions.push({ element: preview.value, top: preview.value.scrollTop, left: preview.value.scrollLeft })
  for (let element: HTMLElement | null = textarea.value ?? editor.value ?? null; element; element = element.parentElement) {
    if (element === textarea.value && !element.getClientRects().length) continue
    positions.push({ element, top: element.scrollTop, left: element.scrollLeft })
  }
  const restore = () => positions.forEach(({ element, top, left }) => {
    element.scrollTop = top
    element.scrollLeft = left
  })
  return () => {
    restore()
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => { if (!disposed) restore() })
  }
}

function commit(value: string, range: Selection, typing = false) {
  const previous = history.value[historyIndex.value]!
  const now = Date.now()
  if (previous.value !== value) {
    const merge = typing && lastTyping > 0 && now - lastTyping < 750 && historyIndex.value === history.value.length - 1
    if (merge) history.value[historyIndex.value] = { value, selection: { ...range } }
    else {
      previous.selection = { ...selection }
      history.value = history.value.slice(0, historyIndex.value + 1)
      history.value.push({ value, selection: { ...range } })
      if (history.value.length > 60) history.value.shift()
      historyIndex.value = history.value.length - 1
    }
  }
  lastTyping = typing ? now : 0
  selection = { ...range }
  emit('update:modelValue', value)
}

async function applyEdit(value: string, range: Selection) {
  if (value.length > 30000) { ElMessage.error('介绍不能超过 30000 字符'); return }
  const restore = captureScroll()
  if (mode.value === 'preview') mode.value = 'edit'
  commit(value, range)
  await nextTick()
  if (disposed) return
  textarea.value?.focus({ preventScroll: true })
  textarea.value?.setSelectionRange(range.start, range.end)
  restore()
}

async function insert(before: string, after = '', placeholder = '', replaceSelection = false) {
  if (busy.value) return
  const chosen = (!replaceSelection && props.modelValue.slice(selection.start, selection.end)) || placeholder
  const value = props.modelValue.slice(0, selection.start) + before + chosen + after + props.modelValue.slice(selection.end)
  const start = selection.start + before.length
  await applyEdit(value, { start, end: start + chosen.length })
}

async function formatLines(prefix: string | ((index: number) => string), placeholder: string, heading = false) {
  if (busy.value) return
  const source = props.modelValue
  const start = selection.start === 0 ? 0 : source.lastIndexOf('\n', selection.start - 1) + 1
  const lastSelected = selection.end > selection.start && source[selection.end - 1] === '\n' ? selection.end - 1 : selection.end
  const lineEnd = source.indexOf('\n', lastSelected)
  const end = lineEnd < 0 ? source.length : lineEnd
  const lines = source.slice(start, end).split('\n')
  const formatted = lines.map((line, index) => {
    const content = heading ? line.replace(/^#{1,6}\s+/, '') : line
    return (typeof prefix === 'function' ? prefix(index) : prefix) + (content || placeholder)
  }).join('\n')
  await applyEdit(source.slice(0, start) + formatted + source.slice(end), { start, end: start + formatted.length })
}

function changeHeading(event: Event) {
  const select = event.target as HTMLSelectElement
  void formatLines('#'.repeat(Number(select.value)) + ' ', '标题', true)
  select.value = ''
}

async function insertBlock(before: string, after: string, placeholder: string, replaceSelection = false) {
  const leading = selection.start > 0 ? (props.modelValue[selection.start - 1] === '\n' ? '\n' : '\n\n') : ''
  const trailing = selection.end < props.modelValue.length ? '\n\n' : '\n'
  await insert(leading + before, after + trailing, placeholder, replaceSelection)
}

async function travelHistory(direction: -1 | 1) {
  if (direction === -1 ? !canUndo.value : !canRedo.value) return
  const restore = captureScroll()
  history.value[historyIndex.value]!.selection = { ...selection }
  historyIndex.value += direction
  const entry = history.value[historyIndex.value]!
  lastTyping = 0
  selection = { ...entry.selection }
  if (mode.value === 'preview') mode.value = 'edit'
  emit('update:modelValue', entry.value)
  await nextTick()
  if (disposed) return
  textarea.value?.focus({ preventScroll: true })
  textarea.value?.setSelectionRange(selection.start, selection.end)
  restore()
}

function beforeInput(event: InputEvent) {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault()
    void travelHistory(event.inputType === 'historyUndo' ? -1 : 1)
  } else rememberSelection()
}

function keyboardShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return
  const key = event.key.toLowerCase()
  if (!['b', 'i', 'k', 'z', 'y'].includes(key)) return
  event.preventDefault()
  if (busy.value) return
  rememberSelection()
  if (key === 'z' || key === 'y') void travelHistory(key === 'y' || event.shiftKey ? 1 : -1)
  else if (key === 'b') void insert('**', '**', '加粗文字')
  else if (key === 'i') void insert('*', '*', '斜体文字')
  else void insert('[', '](https://example.com)', '链接文字')
}

function toggleFullscreen() {
  if (!fullscreen.value) fullscreenHeight.value = frame.value?.getBoundingClientRect().height ?? 0
  fullscreen.value = !fullscreen.value
}

async function selectMode(value: typeof mode.value) {
  if (mode.value === value) return
  if (textarea.value?.getClientRects().length) paneScroll.source = textarea.value.scrollTop
  if (preview.value?.getClientRects().length) paneScroll.preview = preview.value.scrollTop
  const restore = captureScroll()
  mode.value = value
  await nextTick()
  if (disposed) return
  restore()
  if (textarea.value) textarea.value.scrollTop = paneScroll.source
  if (preview.value) preview.value.scrollTop = paneScroll.preview
}

function input(event: Event) {
  const target = event.target as HTMLTextAreaElement
  commit(target.value, { start: target.selectionStart, end: target.selectionEnd }, true)
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
        const restore = captureScroll()
        position += snippet.length
        end = position
        commit(value, { start: position, end: position })
        await nextTick()
        if (!disposed) restore()
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
      if (!batch.signal.aborted && !disposed && textarea.value?.getClientRects().length && editor.value?.contains(document.activeElement)) {
        const restore = captureScroll()
        textarea.value.focus({ preventScroll: true })
        textarea.value?.setSelectionRange(position, position)
        selection = { start: position, end: position }
        restore()
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
onBeforeUnmount(() => { disposed = true; cancelAnimationFrame(scrollFrame); controller?.abort(); emit('uploading', false) })
</script>

<template>
  <div ref="frame" class="markdown-editor-frame" :style="fullscreen ? { height: `${fullscreenHeight}px` } : undefined">
  <div ref="editor" :class="['markdown-editor', { 'is-fullscreen': fullscreen }]" @keydown.esc.stop="fullscreen = false">
    <div class="markdown-editor-chrome" @mousedown="preserveToolbarSelection">
    <div class="markdown-toolbar" role="toolbar" aria-label="Markdown 工具栏">
      <div class="markdown-tool-group" role="group" aria-label="编辑历史">
        <button type="button" aria-label="撤销" title="撤销 · Ctrl/⌘ Z" :disabled="!canUndo" @click="travelHistory(-1)"><Undo2 :size="17" /></button>
        <button type="button" aria-label="重做" title="重做 · Ctrl/⌘ Shift Z" :disabled="!canRedo" @click="travelHistory(1)"><Redo2 :size="17" /></button>
      </div>
      <div class="markdown-tool-group" role="group" aria-label="文字格式">
        <label class="markdown-heading-select"><Heading2 :size="17" /><select aria-label="标题级别" title="设置当前行或选中行的标题级别" :disabled="busy" @change="changeHeading"><option value="" selected disabled>标题</option><option value="1">一级标题</option><option value="2">二级标题</option><option value="3">三级标题</option><option value="4">四级标题</option></select></label>
        <button type="button" aria-label="加粗" title="加粗 · Ctrl/⌘ B" :disabled="busy" @click="insert('**', '**', '加粗文字')"><Bold :size="17" /></button>
        <button type="button" aria-label="斜体" title="斜体 · Ctrl/⌘ I" :disabled="busy" @click="insert('*', '*', '斜体文字')"><Italic :size="17" /></button>
        <button type="button" aria-label="删除线" title="删除线" :disabled="busy" @click="insert('~~', '~~', '删除文字')"><Strikethrough :size="17" /></button>
        <button type="button" aria-label="行内代码" title="行内代码" :disabled="busy" @click="insert('`', '`', '代码')"><Code :size="17" /></button>
      </div>
      <div class="markdown-tool-group" role="group" aria-label="段落格式">
        <button type="button" aria-label="插入列表" title="无序列表 · 支持多行选区" :disabled="busy" @click="formatLines('- ', '列表内容')"><List :size="17" /></button>
        <button type="button" aria-label="有序列表" title="有序列表 · 支持多行选区" :disabled="busy" @click="formatLines(index => `${index + 1}. `, '列表内容')"><ListOrdered :size="17" /></button>
        <button type="button" aria-label="插入引用" title="引用 · 支持多行选区" :disabled="busy" @click="formatLines('> ', '引用内容')"><Quote :size="17" /></button>
        <button type="button" aria-label="插入代码块" title="代码块" :disabled="busy" @click="insertBlock('```text\n', '\n```', '在这里输入代码')"><CodeXml :size="17" /></button>
        <button type="button" aria-label="插入表格" title="插入表格" :disabled="busy" @click="insertBlock('', '', '| 项目 | 说明 |\n| --- | --- |\n| 内容 | 内容 |\n| 内容 | 内容 |', true)"><Table2 :size="17" /></button>
        <button type="button" aria-label="插入分隔线" title="分隔线" :disabled="busy" @click="insertBlock('---', '', '', true)"><Minus :size="17" /></button>
      </div>
      <div class="markdown-tool-group" role="group" aria-label="链接与图片">
      <button type="button" aria-label="插入链接" title="插入链接 · Ctrl/⌘ K" :disabled="busy" @click="insert('[', '](https://example.com)', '链接文字')"><Link :size="17" /></button>
      <button type="button" :disabled="busy" @click="fileInput?.click()"><ImagePlus :size="17" />上传图片</button>
      </div>
      <input ref="fileInput" type="file" class="visually-hidden" accept="image/jpeg,image/png,image/webp" multiple :disabled="busy" aria-label="上传介绍图片" @change="chooseFiles" />
    </div>
    <div class="markdown-modes" role="group" aria-label="介绍编辑模式">
      <button type="button" :aria-pressed="mode === 'edit'" @click="selectMode('edit')">编辑</button>
      <button type="button" :aria-pressed="mode === 'preview'" @click="selectMode('preview')">预览</button>
      <button type="button" class="split-mode" :aria-pressed="mode === 'split'" @click="selectMode('split')">双栏</button>
      <button type="button" :aria-label="fullscreen ? '退出全屏编辑' : '全屏编辑'" :title="fullscreen ? '退出全屏编辑' : '全屏编辑'" @click="toggleFullscreen"><Minimize2 v-if="fullscreen" :size="16" /><Maximize2 v-else :size="16" /></button>
    </div>
    </div>
    <div :class="['markdown-editor-panes', `mode-${mode}`]">
      <textarea ref="textarea" class="markdown-source" :value="modelValue" :readonly="busy" maxlength="30000" aria-label="游戏介绍 Markdown" placeholder="输入游戏介绍，支持标题、列表、表格和图片。可粘贴截图或拖入图片。" @beforeinput="beforeInput" @input="input" @keydown="keyboardShortcut" @select="rememberSelection" @click="rememberSelection" @keyup="rememberSelection" @blur="rememberSelection" @paste="paste" @dragover.prevent @drop="drop"></textarea>
      <div ref="preview" class="markdown-preview" aria-label="游戏介绍预览"><MarkdownContent v-if="modelValue" :content="modelValue" /><p v-else class="markdown-placeholder">预览会显示在这里</p></div>
    </div>
    <div class="markdown-editor-footer"><span>{{ modelValue.length }} / 30000</span></div>
    <div v-if="uploading" class="markdown-upload-status" role="status">{{ uploadStatus }}<button type="button" @click="cancelUpload">取消上传</button></div>
    <div v-if="failedFiles.length" class="markdown-upload-error" role="alert"><span>{{ failedFiles.length }} 张图片未插入：{{ errorText }}</span><button type="button" :disabled="busy" @click="uploadFiles([...failedFiles])">重试失败图片</button></div>
  </div>
  </div>
</template>
