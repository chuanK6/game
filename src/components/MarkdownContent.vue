<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElDialog } from 'element-plus'
import { renderMarkdown } from '@/utils/markdown'
import '@/styles/markdown.css'

const props = defineProps<{ content: string }>()
const html = computed(() => renderMarkdown(props.content))
const previewOpen = ref(false)
const previewImage = ref({ src: '', alt: '' })

function openImage(event: Event) {
  const image = event.target
  if (!(image instanceof HTMLImageElement) || image.classList.contains('image-failed')) return
  event.preventDefault()
  previewImage.value = { src: image.src, alt: image.alt || '游戏截图' }
  previewOpen.value = true
}

function handleKey(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') openImage(event)
}

function imageError(event: Event) {
  if (!(event.target instanceof HTMLImageElement)) return
  event.target.classList.add('image-failed')
  event.target.alt = `图片暂不可用：${event.target.alt || '游戏截图'}`
  event.target.removeAttribute('tabindex')
  event.target.removeAttribute('role')
}
</script>

<template>
  <div class="markdown-host">
    <div class="markdown-content" @click="openImage" @keydown="handleKey" @error.capture="imageError" v-html="html"></div>
    <el-dialog v-model="previewOpen" :title="previewImage.alt" width="min(1200px, 96vw)" append-to-body class="markdown-lightbox" destroy-on-close>
      <img :src="previewImage.src" :alt="previewImage.alt" />
    </el-dialog>
  </div>
</template>
