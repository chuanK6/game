<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElButton, ElDialog, ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight, Check, ImagePlus, Plus, Trash2, Upload } from 'lucide-vue-next'
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
const tabs: Array<{ id: EditorTab; label: string; description: string }> = [
  { id: 'basic', label: '基础信息', description: '设置游戏名称、封面与发布信息。' },
  { id: 'introduction', label: '游戏介绍', description: '用文字和截图呈现游戏的特色。' },
  { id: 'requirements', label: '配置要求', description: '帮助玩家确认设备是否满足运行要求。' },
  { id: 'downloads', label: '标签与下载', description: '选择游戏特征，配置可用的下载来源。' },
]
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
  <el-dialog :model-value="true" :title="form.id ? '编辑游戏' : '新增游戏'" width="min(1180px, 96vw)" top="4vh" class="game-editor-dialog admin-editor-dialog" :close-on-click-modal="false" :show-close="!saving" :close-on-press-escape="!saving" @update:model-value="!$event && emit('close')">
    <template #header="{ titleId }"><div class="editor-title"><span class="editor-title-icon"><ImagePlus :size="23" /></span><div><h2 :id="titleId">{{ form.id ? '编辑游戏' : '新增游戏' }}</h2><p>{{ form.name || '完善游戏信息，让玩家轻松发现下一款好游戏。' }}</p></div><span :class="['admin-status', form.status]">{{ { draft: '草稿', published: '已发布', offline: '已下架' }[form.status] }}</span></div></template>
    <nav class="editor-tabs" role="tablist" aria-label="游戏编辑页签" @keydown="keyboardTab">
      <button v-for="(tab, index) in tabs" :id="`editor-tab-${tab.id}`" :key="tab.id" type="button" role="tab" :aria-selected="currentTab === tab.id" :aria-controls="`editor-panel-${tab.id}`" :tabindex="currentTab === tab.id ? 0 : -1" @click="selectTab(tab.id)"><span class="editor-step">{{ index + 1 }}</span>{{ tab.label }}<span v-if="issues.some(issue => issue.tab === tab.id)" class="tab-error-dot"><span class="visually-hidden">有未完成的必填项</span></span><Check v-else :size="13" class="tab-complete" /></button>
    </nav>
    <form ref="editorElement" class="game-editor tabbed-game-editor" novalidate @submit.prevent="save">
      <p v-if="submitted && issues.length" class="editor-validation" role="alert">还有 {{ issues.length }} 项需要完善。{{ currentIssues[0]?.message || '请检查带红点的页签。' }}<button type="button" @click="focusIssue">定位首个问题</button></p>
      <section v-show="currentTab === 'basic'" id="editor-panel-basic" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-basic">
        <div class="editor-section-heading"><div><h3>基础信息</h3><p>{{ tabs[0]!.description }}</p></div><span class="editor-step-count">步骤 1 / 4</span></div>
        <div class="editor-card"><div class="editor-group-heading"><h4>游戏信息</h4><p>为游戏设置清晰的名称和访问地址。</p></div>
        <div class="editor-field-grid">
          <div class="editor-field"><label for="game-name">游戏名称 <span class="required-mark">*</span></label><input id="game-name" v-model="form.name" maxlength="100" placeholder="输入游戏名称" required :disabled="saving" :aria-invalid="Boolean(fieldError('game-name'))" :aria-describedby="fieldError('game-name') ? 'error-game-name' : undefined" /><small v-if="fieldError('game-name')" id="error-game-name" class="field-error">{{ fieldError('game-name') }}</small></div>
          <div class="editor-field"><label for="game-slug">Slug <span class="required-mark">*</span></label><input id="game-slug" v-model.trim="form.slug" maxlength="100" placeholder="例如 island-craft" required :disabled="saving" :aria-invalid="Boolean(fieldError('game-slug'))" /><small :class="fieldError('game-slug') ? 'field-error' : 'field-help'">{{ fieldError('game-slug') || '用于详情页网址，支持小写字母、数字和连字符。' }}</small></div>
        </div></div>
        <div class="editor-card cover-field"><div class="editor-group-heading"><h4>游戏封面 <span class="required-mark">*</span></h4><p>上传一张能展现游戏特色的横向封面。</p></div><div class="cover-upload-layout">
          <button type="button" class="cover-dropzone" :class="{ 'has-cover': form.coverUrl && !coverFailed }" :disabled="busy" aria-label="上传封面，支持拖拽" @click="coverInput?.click()" @dragover.prevent @drop.prevent="dropCover"><img v-if="form.coverUrl && !coverFailed" :src="form.coverUrl" alt="封面预览" @error="coverFailed = true" /><template v-else><ImagePlus :size="28" /><strong>{{ coverFailed ? '封面暂时无法预览' : '拖拽图片到这里' }}</strong><span>或点击选择图片 · 16:9</span></template><span v-if="form.coverUrl && !coverFailed" class="cover-replace"><Upload :size="15" />{{ uploadingCover ? '上传中…' : '更换封面' }}</span></button>
          <div class="cover-url-fields"><input ref="coverInput" type="file" class="visually-hidden" accept="image/jpeg,image/png,image/webp" aria-label="选择封面文件" :disabled="busy" @change="chooseCover" /><label for="game-cover" class="cover-address-label">图片地址 <span class="required-mark">*</span></label><input id="game-cover" v-model="form.coverUrl" placeholder="上传后自动填入，也可粘贴图片地址" required :disabled="uploadingCover || saving" :aria-invalid="Boolean(fieldError('game-cover'))" /><p class="field-help">JPG、PNG、WebP，单张不超过 5 MB。建议使用 16:9 比例。</p><small v-if="fieldError('game-cover')" class="field-error">{{ fieldError('game-cover') }}</small><p v-if="uploadingCover" class="cover-upload-status" role="status">封面上传中…</p><p v-else-if="form.coverUrl && !coverFailed" class="cover-upload-success" role="status"><Check :size="14" />封面已就绪</p><div v-if="coverError" class="cover-upload-error" role="alert">{{ coverError }}<button v-if="failedCover" type="button" @click="uploadCover(failedCover)">重试</button></div></div>
        </div></div>
        <div class="editor-card"><div class="editor-group-heading"><h4>资源与发布</h4><p>设置游戏分类、访问权限和上线状态。</p></div>
        <div class="editor-field-grid">
          <div class="editor-field"><label for="game-category">分类 <span class="required-mark">*</span></label><select id="game-category" v-model.number="form.categoryId" required :disabled="saving" :aria-invalid="Boolean(fieldError('game-category'))"><option :value="0" disabled>选择游戏分类</option><option v-for="category in activeCategories" :key="category.id" :value="category.id">{{ category.name }}{{ category.status !== 'active' ? '（已停用）' : '' }}</option></select><small v-if="fieldError('game-category')" class="field-error">{{ fieldError('game-category') }}</small></div>
          <div class="editor-field"><label for="game-access">资源权限 <span class="required-mark">*</span></label><select id="game-access" v-model="form.resourceType" :disabled="saving"><option value="free">免费资源</option><option value="member">会员资源</option></select><small class="field-help">会员资源仅限有效会员获取下载链接。</small></div>
          <div class="editor-field"><label for="game-resource-status">资源状态 <span class="required-mark">*</span></label><select id="game-resource-status" v-model="form.resourceStatus" :disabled="saving"><option value="available">可用</option><option value="checking">检查中</option><option value="unavailable">不可用</option></select></div>
          <div class="editor-field"><label for="game-status">发布状态 <span class="required-mark">*</span></label><select id="game-status" v-model="form.status" :disabled="saving"><option value="draft">草稿</option><option value="published">发布</option><option value="offline">下架</option></select><small class="field-help">草稿保存后不会展示在公开游戏库。</small></div>
          <div class="editor-field"><label for="game-publish">发布日期 <span class="optional-mark">可选</span></label><input id="game-publish" v-model="form.publishAt" type="date" :disabled="saving" :aria-invalid="Boolean(fieldError('game-publish'))" /><small v-if="fieldError('game-publish')" class="field-error">{{ fieldError('game-publish') }}</small></div>
        </div></div>
      </section>
      <section v-show="currentTab === 'introduction'" id="editor-panel-introduction" class="editor-panel introduction-panel" role="tabpanel" aria-labelledby="editor-tab-introduction">
        <div class="editor-section-heading"><div><h3>游戏介绍 <span class="required-mark">*</span></h3><p>{{ tabs[1]!.description }}</p></div><span class="editor-step-count">步骤 2 / 4</span></div>
        <div class="editor-card introduction-card">
        <div id="game-description" :class="{ 'editor-field-invalid': fieldError('game-description') }"><MarkdownEditor ref="markdownEditor" v-if="form.descriptionFormat === 'markdown'" v-model="form.description" :disabled="saving" @uploading="uploadingContent = $event" /><div v-else class="legacy-description"><label for="legacy-description">游戏介绍（纯文本）</label><textarea id="legacy-description" v-model="form.description" rows="14" maxlength="30000" :disabled="saving"></textarea><p>原有介绍保留纯文本显示，转换后可插入截图。</p><button type="button" class="button button-secondary button-small" :disabled="saving" @click="previewConversion">转换为 Markdown</button></div></div><small v-if="fieldError('game-description')" class="field-error">{{ fieldError('game-description') }}</small>
        </div>
      </section>
      <section v-show="currentTab === 'requirements'" id="editor-panel-requirements" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-requirements">
        <div class="editor-section-heading"><div><h3>配置要求</h3><p>{{ tabs[2]!.description }}</p></div><span class="editor-step-count">步骤 3 / 4</span></div><div class="editor-card"><div class="editor-group-heading"><h4>最低配置 <span class="required-mark">*</span></h4><p>至少填写一项，建议补充操作系统、处理器、内存和显卡。</p></div><div class="editor-field-grid"><div v-for="field in CONFIG_FIELDS" :key="field.key" class="editor-field"><label :for="`config-${field.key}`">{{ field.label }}</label><textarea :id="`config-${field.key}`" v-model="form.config[field.key]" :rows="field.key === 'other' ? 3 : 2" :maxlength="199 - field.label.length" :placeholder="field.placeholder" :disabled="saving" :aria-invalid="Boolean(fieldError(`config-${field.key}`))"></textarea><small v-if="fieldError(`config-${field.key}`)" class="field-error">{{ fieldError(`config-${field.key}`) }}</small></div></div></div>
      </section>
      <section v-show="currentTab === 'downloads'" id="editor-panel-downloads" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-downloads">
        <div class="editor-section-heading"><div><h3>标签与下载</h3><p>{{ tabs[3]!.description }}</p></div><span class="editor-step-count">步骤 4 / 4</span></div>
        <div class="editor-card"><div class="editor-group-heading"><h4>游戏标签 <span class="optional-mark">可选</span></h4><p>选择适合的游戏特征，已选 {{ form.tagIds.length }} / 20。</p></div><div id="game-tags" class="tag-pills" role="group" aria-label="游戏标签"><button v-for="tag in selectableTags" :key="tag.id" type="button" role="checkbox" :aria-checked="form.tagIds.includes(tag.id)" :disabled="saving" @click="toggleTag(tag.id)"><Check v-if="form.tagIds.includes(tag.id)" :size="14" />{{ tag.name }}</button><p v-if="!selectableTags.length" class="field-help">暂无标签，可在“分类与标签”中添加。</p></div><small v-if="fieldError('game-tags')" class="field-error">{{ fieldError('game-tags') }}</small></div>
        <div class="editor-card"><div class="editor-group-heading"><h4>下载地址 <span class="optional-mark">可选</span></h4><p>填写任一字段后，请补全该行带星号的内容；整行留空时不会保存。</p></div>
        <article v-for="(row, index) in form.downloads" :key="row.key" class="download-source-editor"><div class="download-row-heading"><strong>下载来源 {{ index + 1 }}</strong><button type="button" class="icon-button" :aria-label="`移除下载来源 ${index + 1}`" :disabled="saving" @click="removeDownload(index)"><Trash2 :size="16" /></button></div><div class="download-fields"><div class="editor-field"><label :for="`provider-${row.key}`">网盘名称 <span class="required-mark">*</span></label><input :id="`provider-${row.key}`" v-model="row.provider" placeholder="例如：夸克网盘" maxlength="50" :disabled="saving" :aria-invalid="Boolean(fieldError(`provider-${row.key}`))" /><small v-if="fieldError(`provider-${row.key}`)" class="field-error">{{ fieldError(`provider-${row.key}`) }}</small></div><div class="editor-field"><label :for="`label-${row.key}`">资源说明 <span class="required-mark">*</span></label><input :id="`label-${row.key}`" v-model="row.label" placeholder="例如：中文版 / 提取码" maxlength="100" :disabled="saving" :aria-invalid="Boolean(fieldError(`label-${row.key}`))" /><small v-if="fieldError(`label-${row.key}`)" class="field-error">{{ fieldError(`label-${row.key}`) }}</small></div><div class="editor-field download-url"><label :for="`url-${row.key}`">下载链接 <span class="required-mark">*</span></label><input :id="`url-${row.key}`" v-model="row.url" type="url" placeholder="https://…" maxlength="2000" :disabled="saving" :aria-invalid="Boolean(fieldError(`url-${row.key}`))" /><small v-if="fieldError(`url-${row.key}`)" class="field-error">{{ fieldError(`url-${row.key}`) }}</small></div></div></article>
        <button type="button" class="button button-secondary button-small add-download" :disabled="saving || form.downloads.length >= 20" @click="form.downloads.push(blankDownload())"><Plus :size="16" />添加地址</button>
        </div>
      </section>
    </form>
    <template #footer><div class="editor-footer"><span class="editor-footer-note">{{ uploadingCover || uploadingContent ? '图片上传中，完成后即可保存' : '带 * 的内容为必填项' }}</span><div><el-button text class="editor-cancel" :disabled="saving" @click="emit('close')">取消</el-button><el-button v-if="tabIndex > 0" :disabled="saving" @click="selectTab(tabs[tabIndex - 1]!.id)"><ArrowLeft :size="14" />上一步</el-button><el-button :type="tabIndex === tabs.length - 1 ? 'primary' : 'default'" :loading="saving" :disabled="uploadingCover || uploadingContent" @click="save">保存游戏</el-button><el-button v-if="tabIndex < tabs.length - 1" type="primary" :disabled="saving" @click="selectTab(tabs[tabIndex + 1]!.id)">下一步<ArrowRight :size="14" /></el-button></div></div></template>
  </el-dialog>
  <el-dialog v-model="converting" title="转换介绍预览" width="min(800px, 94vw)" append-to-body><p class="dialog-note">特殊符号已转义。确认预览后，可继续编辑并插入图片。</p><MarkdownContent :content="converted" /><template #footer><el-button @click="converting = false">取消</el-button><el-button type="primary" @click="form.description = converted; form.descriptionFormat = 'markdown'; converting = false">使用 Markdown</el-button></template></el-dialog>
</template>
