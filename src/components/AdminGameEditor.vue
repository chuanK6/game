<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElButton, ElDialog, ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight, Check, Plus, Trash2, Upload } from 'lucide-vue-next'
import { adminApi, ApiError, type AdminGameDetail, type AdminTaxonomy } from '@/api/client'
import MarkdownEditor from './MarkdownEditor.vue'
import MarkdownContent from './MarkdownContent.vue'
import { uploadImage } from '@/utils/imageUpload'
import { plainToMarkdown } from '@/utils/markdown'
import { CONFIG_FIELDS, blankDownload, createGameForm, gameFormIssues, gamePayload, type EditorTab } from '@/utils/adminGameForm'

const props = defineProps<{ game: AdminGameDetail | null; categories: AdminTaxonomy[]; tags: AdminTaxonomy[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const form = reactive(createGameForm(props.game))
const currentTab = ref<EditorTab>('basic')
const submitted = ref(false)
const saving = ref(false)
const uploadingCover = ref(false)
const uploadingContent = ref(false)
const coverError = ref('')
const failedCover = ref<File>()
const coverFailed = ref(false)
const coverInput = ref<HTMLInputElement>()
const editorElement = ref<HTMLFormElement>()
const markdownEditor = ref<InstanceType<typeof MarkdownEditor>>()
const converting = ref(false)
const converted = ref('')
const issues = computed(() => gameFormIssues(form))
const busy = computed(() => saving.value || uploadingCover.value || uploadingContent.value)
const tabs: Array<{ id: EditorTab; label: string }> = [
  { id: 'basic', label: '基础信息' },
  { id: 'introduction', label: '游戏介绍' },
  { id: 'requirements', label: '最低配置' },
  { id: 'downloads', label: '标签与下载' },
]
const accessOptions = [{ value: 'free', label: '免费' }, { value: 'member', label: '会员' }] as const
const resourceOptions = [{ value: 'available', label: '可用' }, { value: 'checking', label: '检查中' }, { value: 'unavailable', label: '失效' }] as const
const publishOptions = [{ value: 'draft', label: '草稿' }, { value: 'published', label: '已发布' }, { value: 'offline', label: '下架' }] as const
const tabIndex = computed(() => tabs.findIndex(tab => tab.id === currentTab.value))
const activeCategories = computed(() => props.categories.filter(category => category.status === 'active' || category.id === form.categoryId))
const selectableTags = computed(() => props.tags.filter(tag => tag.status === 'active' || form.tagIds.includes(tag.id)))
const currentIssues = computed(() => issues.value.filter(issue => issue.tab === currentTab.value))
let uploadController: AbortController | undefined
let disposed = false
watch(() => form.coverUrl, () => { coverFailed.value = false })
onBeforeUnmount(() => { disposed = true; uploadController?.abort() })

function fieldError(field: string) { return submitted.value ? issues.value.find(issue => issue.field === field)?.message : undefined }
function selectTab(tab: EditorTab) { currentTab.value = tab }
async function keyboardTab(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabIndex.value + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  currentTab.value = tabs[index]!.id
  await nextTick()
  document.getElementById(`editor-tab-${currentTab.value}`)?.focus()
}
async function focusIssue() {
  const issue = issues.value[0]
  if (!issue) return
  currentTab.value = issue.tab
  await nextTick()
  const target = editorElement.value?.querySelector<HTMLElement>(`#${issue.field}`)
  const field = target?.matches('input,select,textarea,button') ? target : target?.querySelector<HTMLElement>('textarea,input,select') ?? target?.querySelector<HTMLElement>('button')
  if (issue.field === 'game-description' && markdownEditor.value) await markdownEditor.value.focus()
  else field?.focus({ preventScroll: true })
  const container = editorElement.value
  if (container && target) {
    const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 20
    container.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
}
async function uploadCover(file?: File) {
  if (!file || busy.value) return
  const controller = new AbortController()
  uploadController = controller
  uploadingCover.value = true
  coverError.value = ''
  failedCover.value = undefined
  try {
    const image = await uploadImage(file, 'cover', controller.signal)
    if (disposed || controller.signal.aborted) return
    form.coverUrl = image.url
  } catch (error) {
    if (disposed || controller.signal.aborted) return
    failedCover.value = file
    coverError.value = error instanceof Error ? error.message : '封面上传失败，请重试'
  } finally { if (!disposed) uploadingCover.value = false }
}
function chooseCover(event: Event) {
  const input = event.target as HTMLInputElement
  void uploadCover(input.files?.[0])
  input.value = ''
}
function dropCover(event: DragEvent) {
  if ((event.dataTransfer?.files.length ?? 0) > 1) { ElMessage.error('每次请选择一张封面'); return }
  void uploadCover(event.dataTransfer?.files[0])
}
function toggleTag(id: number) {
  if (saving.value) return
  if (form.tagIds.includes(id)) form.tagIds = form.tagIds.filter(value => value !== id)
  else if (form.tagIds.length < 20) form.tagIds.push(id)
  else ElMessage.info('最多选择 20 个标签')
}
function removeDownload(index: number) {
  form.downloads.splice(index, 1)
  if (!form.downloads.length) form.downloads.push(blankDownload())
}
function previewConversion() {
  converted.value = plainToMarkdown(form.description)
  if (converted.value.length > 30000) { ElMessage.error('转换后超过 30000 字符，请先精简介绍'); return }
  converting.value = true
}
async function save() {
  if (busy.value) return
  submitted.value = true
  if (issues.value.length) { await focusIssue(); return }
  saving.value = true
  try {
    if (form.id) await adminApi.updateGame(form.id, gamePayload(form))
    else await adminApi.createGame(gamePayload(form))
    ElMessage.success(form.id ? '游戏已更新' : '游戏已创建')
    emit('saved')
  } catch (error) { ElMessage.error(error instanceof ApiError ? error.message : '保存失败，请重试') }
  finally { saving.value = false }
}
</script>

<template>
  <el-dialog :model-value="true" :title="form.id ? '编辑游戏' : '新增游戏'" width="min(1000px, 96vw)" top="4vh" class="game-editor-dialog admin-editor-dialog" :close-on-click-modal="false" :show-close="!saving" :close-on-press-escape="!saving" @update:model-value="!$event && emit('close')">
    <template #header="{ titleId }"><div class="editor-title"><h2 :id="titleId">{{ form.id ? '编辑游戏' : '新增游戏' }}</h2><span :class="['admin-status', form.status]">{{ { draft: '草稿', published: '已发布', offline: '已下架' }[form.status] }}</span></div></template>
    <nav class="editor-tabs" role="tablist" aria-label="游戏编辑页签" @keydown="keyboardTab">
      <button v-for="tab in tabs" :id="`editor-tab-${tab.id}`" :key="tab.id" type="button" role="tab" :aria-selected="currentTab === tab.id" :aria-controls="`editor-panel-${tab.id}`" :tabindex="currentTab === tab.id ? 0 : -1" @click="selectTab(tab.id)">{{ tab.label }}<span v-if="submitted && issues.some(issue => issue.tab === tab.id)" class="tab-error-dot"><span class="visually-hidden">有未完成的必填项</span></span></button>
    </nav>
    <form ref="editorElement" class="game-editor tabbed-game-editor" novalidate @submit.prevent="save">
      <p v-if="submitted && issues.length" class="editor-validation" role="alert">还有 {{ issues.length }} 项需要完善。{{ currentIssues[0]?.message || '请检查带红点的页签。' }}<button type="button" @click="focusIssue">定位首个问题</button></p>
      <section v-show="currentTab === 'basic'" id="editor-panel-basic" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-basic">
        <div class="editor-field-grid">
          <div class="editor-field"><label for="game-name">游戏名称 <span class="required-mark">*</span></label><input id="game-name" v-model="form.name" maxlength="100" placeholder="例如 双人成行" required :disabled="saving" :aria-invalid="Boolean(fieldError('game-name'))" :aria-describedby="fieldError('game-name') ? 'error-game-name' : undefined" /><small v-if="fieldError('game-name')" id="error-game-name" class="field-error">{{ fieldError('game-name') }}</small></div>
          <div class="editor-field"><label for="game-slug">Slug <span class="required-mark">*</span></label><input id="game-slug" v-model.trim="form.slug" maxlength="100" placeholder="example-game" title="详情页网址：小写字母、数字和连字符" required :disabled="saving" :aria-invalid="Boolean(fieldError('game-slug'))" /><small v-if="fieldError('game-slug')" class="field-error">{{ fieldError('game-slug') }}</small></div>
        </div>
        <div class="editor-field cover-field"><label for="game-cover">封面 <span class="required-mark">*</span></label><div class="cover-upload-layout">
          <button type="button" class="cover-dropzone" :class="{ 'has-cover': form.coverUrl && !coverFailed }" :disabled="busy" aria-label="上传封面，支持拖拽" @click="coverInput?.click()" @dragover.prevent @drop.prevent="dropCover"><img v-if="form.coverUrl && !coverFailed" :src="form.coverUrl" alt="封面预览" @error="coverFailed = true" /><template v-else><Upload :size="23" /><span>{{ coverFailed ? '封面无法预览，点击更换' : '拖入图片，16:9' }}</span></template><span v-if="form.coverUrl && !coverFailed" class="cover-replace"><Upload :size="15" />{{ uploadingCover ? '上传中…' : '更换封面' }}</span></button>
          <div class="cover-url-fields"><input ref="coverInput" type="file" class="visually-hidden" accept="image/jpeg,image/png,image/webp" aria-label="选择封面文件" :disabled="busy" @change="chooseCover" /><input id="game-cover" v-model="form.coverUrl" placeholder="封面地址，或点击下方上传" required :disabled="uploadingCover || saving" :aria-invalid="Boolean(fieldError('game-cover'))" /><div class="cover-upload-actions"><button type="button" class="button button-secondary button-small" :disabled="busy" @click="coverInput?.click()">{{ uploadingCover ? '上传中…' : '上传封面' }}</button><span class="field-help">JPG、PNG、WebP，每张 ≤ 5 MB</span></div><small v-if="fieldError('game-cover')" class="field-error">{{ fieldError('game-cover') }}</small><p v-if="uploadingCover" class="cover-upload-status" role="status">封面上传中…</p><div v-if="coverError" class="cover-upload-error" role="alert">{{ coverError }}<button v-if="failedCover" type="button" @click="uploadCover(failedCover)">重试</button></div></div>
        </div></div>
        <div class="editor-field-grid editor-three-columns">
          <div class="editor-field"><label for="game-category">分类 <span class="required-mark">*</span></label><select id="game-category" v-model.number="form.categoryId" required :disabled="saving" :aria-invalid="Boolean(fieldError('game-category'))"><option :value="0" disabled>选择游戏分类</option><option v-for="category in activeCategories" :key="category.id" :value="category.id">{{ category.name }}{{ category.status !== 'active' ? '（已停用）' : '' }}</option></select><small v-if="fieldError('game-category')" class="field-error">{{ fieldError('game-category') }}</small></div>
          <div class="editor-field"><span id="game-access-label" class="editor-field-label">资源权限</span><div id="game-access" class="editor-segments" role="group" aria-labelledby="game-access-label"><button v-for="option in accessOptions" :key="option.value" type="button" :aria-pressed="form.resourceType === option.value" :disabled="saving" @click="form.resourceType = option.value">{{ option.label }}</button></div></div>
          <div class="editor-field"><span id="game-resource-status-label" class="editor-field-label">资源状态</span><div id="game-resource-status" class="editor-segments" role="group" aria-labelledby="game-resource-status-label"><button v-for="option in resourceOptions" :key="option.value" type="button" :aria-pressed="form.resourceStatus === option.value" :disabled="saving" @click="form.resourceStatus = option.value">{{ option.label }}</button></div></div>
          <div class="editor-field"><span id="game-status-label" class="editor-field-label">发布状态</span><div id="game-status" class="editor-segments" role="group" aria-labelledby="game-status-label"><button v-for="option in publishOptions" :key="option.value" type="button" :aria-pressed="form.status === option.value" :disabled="saving" @click="form.status = option.value">{{ option.label }}</button></div></div>
          <div class="editor-field"><label for="game-publish">发布日期 <span class="optional-mark">可选</span></label><input id="game-publish" v-model="form.publishAt" type="date" :disabled="saving" :aria-invalid="Boolean(fieldError('game-publish'))" /><small v-if="fieldError('game-publish')" class="field-error">{{ fieldError('game-publish') }}</small></div>
        </div>
      </section>
      <section v-show="currentTab === 'introduction'" id="editor-panel-introduction" class="editor-panel introduction-panel" role="tabpanel" aria-labelledby="editor-tab-introduction">
        <div id="game-description" :class="{ 'editor-field-invalid': fieldError('game-description') }"><MarkdownEditor ref="markdownEditor" v-if="form.descriptionFormat === 'markdown'" v-model="form.description" :disabled="saving" @uploading="uploadingContent = $event" /><div v-else class="legacy-description"><label for="legacy-description">游戏介绍（纯文本）</label><textarea id="legacy-description" v-model="form.description" rows="14" maxlength="30000" :disabled="saving"></textarea><p>原有介绍保留纯文本显示，转换后可插入截图。</p><button type="button" class="button button-secondary button-small" :disabled="saving" @click="previewConversion">转换为 Markdown</button></div></div><small v-if="fieldError('game-description')" class="field-error">{{ fieldError('game-description') }}</small>
      </section>
      <section v-show="currentTab === 'requirements'" id="editor-panel-requirements" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-requirements">
        <p class="editor-panel-note">至少填写一项，每个字段可写多行。</p><div class="editor-field-grid editor-three-columns requirements-grid"><div v-for="field in CONFIG_FIELDS" :key="field.key" class="editor-field"><label :for="`config-${field.key}`">{{ field.label }}{{ field.key === 'cpu' ? '（CPU）' : '' }}</label><textarea :id="`config-${field.key}`" v-model="form.config[field.key]" :rows="2" :maxlength="199 - field.label.length" :placeholder="field.placeholder" :disabled="saving" :aria-invalid="Boolean(fieldError(`config-${field.key}`))"></textarea><small v-if="fieldError(`config-${field.key}`)" class="field-error">{{ fieldError(`config-${field.key}`) }}</small></div></div>
      </section>
      <section v-show="currentTab === 'downloads'" id="editor-panel-downloads" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-downloads">
        <div class="editor-inline-heading"><h3>游戏标签 <span class="optional-mark">可选</span></h3><span>{{ form.tagIds.length }} / 20</span></div>
        <div id="game-tags" class="tag-pills" role="group" aria-label="游戏标签"><button v-for="tag in selectableTags" :key="tag.id" type="button" role="checkbox" :aria-checked="form.tagIds.includes(tag.id)" :disabled="saving" @click="toggleTag(tag.id)"><Check v-if="form.tagIds.includes(tag.id)" :size="14" />{{ tag.name }}</button><p v-if="!selectableTags.length" class="field-help">暂无标签，可在“分类与标签”中添加。</p></div><small v-if="fieldError('game-tags')" class="field-error">{{ fieldError('game-tags') }}</small>
        <section class="editor-downloads" aria-label="下载地址">
          <div class="editor-inline-heading"><h3>下载地址 <span class="optional-mark">可选</span></h3><button type="button" class="button button-secondary button-small add-download" :disabled="saving || form.downloads.length >= 20" @click="form.downloads.push(blankDownload())"><Plus :size="15" />添加地址</button></div>
          <p class="field-help download-help">空行不保存；填写后需补全网盘、说明和链接。</p>
          <div class="download-column-labels" aria-hidden="true"><span>网盘名称</span><span>资源说明</span><span>下载链接</span><span></span></div>
          <article v-for="(row, index) in form.downloads" :key="row.key" class="download-source-editor" :aria-label="`下载来源 ${index + 1}`">
            <div class="editor-field"><label :for="`provider-${row.key}`" class="download-field-label">网盘名称</label><input :id="`provider-${row.key}`" v-model="row.provider" placeholder="例如 百度网盘" maxlength="50" :disabled="saving" :aria-invalid="Boolean(fieldError(`provider-${row.key}`))" /><small v-if="fieldError(`provider-${row.key}`)" class="field-error">{{ fieldError(`provider-${row.key}`) }}</small></div>
            <div class="editor-field"><label :for="`label-${row.key}`" class="download-field-label">资源说明</label><input :id="`label-${row.key}`" v-model="row.label" placeholder="解压密码 / 提取码" maxlength="100" :disabled="saving" :aria-invalid="Boolean(fieldError(`label-${row.key}`))" /><small v-if="fieldError(`label-${row.key}`)" class="field-error">{{ fieldError(`label-${row.key}`) }}</small></div>
            <div class="editor-field download-url"><label :for="`url-${row.key}`" class="download-field-label">下载链接</label><input :id="`url-${row.key}`" v-model="row.url" type="url" placeholder="https://…" maxlength="2000" :disabled="saving" :aria-invalid="Boolean(fieldError(`url-${row.key}`))" /><small v-if="fieldError(`url-${row.key}`)" class="field-error">{{ fieldError(`url-${row.key}`) }}</small></div>
            <button type="button" class="icon-button download-remove" :aria-label="`移除下载来源 ${index + 1}`" :disabled="saving" @click="removeDownload(index)"><Trash2 :size="16" /></button>
          </article>
        </section>
      </section>
    </form>
    <template #footer><div class="editor-footer"><span class="editor-footer-note">{{ uploadingCover || uploadingContent ? '图片上传中，完成后即可保存' : '带 * 的内容为必填项' }}</span><div><el-button text class="editor-cancel" :disabled="saving" @click="emit('close')">取消</el-button><el-button v-if="tabIndex > 0" :disabled="saving" @click="selectTab(tabs[tabIndex - 1]!.id)"><ArrowLeft :size="14" />上一步</el-button><el-button :type="tabIndex === tabs.length - 1 ? 'primary' : 'default'" :loading="saving" :disabled="uploadingCover || uploadingContent" @click="save">保存游戏</el-button><el-button v-if="tabIndex < tabs.length - 1" type="primary" :disabled="saving" @click="selectTab(tabs[tabIndex + 1]!.id)">下一步<ArrowRight :size="14" /></el-button></div></div></template>
  </el-dialog>
  <el-dialog v-model="converting" title="转换介绍预览" width="min(800px, 94vw)" append-to-body><p class="dialog-note">特殊符号已转义。确认预览后，可继续编辑并插入图片。</p><MarkdownContent :content="converted" /><template #footer><el-button @click="converting = false">取消</el-button><el-button type="primary" @click="form.description = converted; form.descriptionFormat = 'markdown'; converting = false">使用 Markdown</el-button></template></el-dialog>
</template>
