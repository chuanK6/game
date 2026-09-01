<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-vue-next'
import { ElCheckbox, ElCheckboxGroup, ElPagination } from 'element-plus'
import GameCard from '@/components/GameCard.vue'
import { catalogApi, getGames } from '@/api/client'
import type { Game, Taxonomy } from '@/types/game'

const route = useRoute()
const router = useRouter()
const keyword = ref('')
const category = ref('')
const selectedTags = ref<string[]>([])
const currentPage = ref(1)
const categories = ref<Taxonomy[]>([])
const tags = ref<Taxonomy[]>([])
const games = ref<Game[]>([])
const total = ref(0)
const loading = ref(true)
const loadError = ref('')
const desktopPageSize = 20
const mobilePageSize = 8
const isMobile = ref(window.matchMedia('(max-width: 760px)').matches)
const pageSize = computed(() => isMobile.value ? mobilePageSize : desktopPageSize)
let searchTimer: number | undefined

Promise.all([catalogApi.categories(), catalogApi.tags()])
  .then(([categoryItems, tagItems]) => {
    categories.value = categoryItems
    tags.value = tagItems
  })
  .catch(() => { loadError.value = '筛选项加载失败，请刷新重试。' })

watch(() => route.query, async (query) => {
  keyword.value = String(query.q ?? '')
  category.value = String(query.category ?? '')
  selectedTags.value = query.tags ? String(query.tags).split(',').filter(Boolean) : []
  currentPage.value = Math.max(1, Number(query.page ?? 1) || 1)
  await loadGames()
}, { immediate: true })
watch(pageSize, () => { void loadGames() })

function updateQuery(page = 1) {
  return router.replace({
    query: {
      ...(keyword.value.trim() ? { q: keyword.value.trim() } : {}),
      ...(category.value ? { category: category.value } : {}),
      ...(selectedTags.value.length ? { tags: selectedTags.value.join(',') } : {}),
      ...(page > 1 ? { page: String(page) } : {}),
    },
  })
}

function scheduleSearch() {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { void updateQuery() }, 350)
}

function selectCategory(slug: string) {
  category.value = slug
  void updateQuery()
}

function applyTags() {
  void updateQuery()
}

function reset() {
  keyword.value = ''
  category.value = ''
  selectedTags.value = []
  void updateQuery()
}

async function loadGames() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await getGames({
      q: keyword.value,
      category: category.value,
      tags: selectedTags.value.join(','),
      page: currentPage.value,
      pageSize: pageSize.value,
    })
    games.value = result.games
    total.value = result.pagination.total
  } catch {
    games.value = []
    total.value = 0
    loadError.value = '游戏列表加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(() => window.clearTimeout(searchTimer))
function updateViewport() { isMobile.value = window.matchMedia('(max-width: 760px)').matches }
onMounted(() => {
  updateViewport()
  window.addEventListener('resize', updateViewport)
})
onBeforeUnmount(() => window.removeEventListener('resize', updateViewport))
</script>

<template>
  <section class="page-banner games-banner">
    <div class="container">
      <span class="eyebrow light">GAME LIBRARY</span>
      <h1>全部游戏</h1>
      <p>筛选分类与玩法标签，找到下一款想玩的游戏。</p>
    </div>
  </section>

  <section class="section games-layout-section">
    <div class="container games-layout">
      <aside class="filter-panel">
        <div class="filter-title"><SlidersHorizontal :size="19" />筛选</div>
        <div class="filter-group">
          <label>关键词</label>
          <div class="filter-search"><Search :size="17" /><input v-model="keyword" placeholder="游戏名称或关键词" @input="scheduleSearch" @keyup.enter="updateQuery()" /></div>
        </div>
        <div class="filter-group">
          <label>分类</label>
          <div class="option-list">
            <button :class="{ active: !category }" @click="selectCategory('')">全部</button>
            <button v-for="item in categories" :key="item.slug" :class="{ active: category === item.slug }" @click="selectCategory(item.slug)">{{ item.name }}</button>
          </div>
        </div>
        <div class="filter-group">
          <label>标签</label>
          <el-checkbox-group v-model="selectedTags" class="tag-checks" @change="applyTags">
            <el-checkbox v-for="tag in tags" :key="tag.slug" :value="tag.slug">{{ tag.name }}</el-checkbox>
          </el-checkbox-group>
        </div>
        <button class="reset-button" @click="reset"><RotateCcw :size="16" />重置筛选</button>
      </aside>

      <div class="results-area">
        <div class="results-header">
          <div><strong>{{ total }}</strong> 个结果</div>
          <span>按最近更新排序</span>
        </div>
        <div v-if="loading" class="empty-state"><p>正在加载游戏...</p></div>
        <div v-else-if="loadError" class="empty-state">
          <Search :size="32" /><h2>加载失败</h2><p>{{ loadError }}</p>
          <button class="button button-secondary" @click="loadGames">重新加载</button>
        </div>
        <template v-else-if="games.length">
          <div class="game-grid three-cols">
            <GameCard v-for="game in games" :key="game.id" :game="game" />
          </div>
          <el-pagination
            v-if="total > pageSize"
            class="results-pagination"
            background
            layout="prev, pager, next"
            :current-page="currentPage"
            :page-size="pageSize"
            :total="total"
            @current-change="updateQuery"
          />
        </template>
        <div v-else class="empty-state">
          <Search :size="32" />
          <h2>没有找到相关游戏</h2>
          <p>换一个关键词，或减少筛选条件后再试。</p>
          <button class="button button-secondary" @click="reset">清除筛选</button>
        </div>
      </div>
    </div>
  </section>
</template>
