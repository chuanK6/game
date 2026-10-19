<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ArrowUp, Check, Gamepad2, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-vue-next'
import { ElPagination } from 'element-plus'
import GameCard from '@/components/GameCard.vue'
import { catalogApi, getGames } from '@/api/client'
import { navigationPending } from '@/router'
import { catalogRequest, catalogRouteQuery, normalizeCatalogQuery, type CatalogQuery } from '@/utils/catalogQuery'
import { catalogKey, catalogRevision, readCatalogFilters, readCatalogPage, writeCatalogFilters, writeCatalogPage, invalidateCatalogCache } from '@/utils/catalogCache'
import { beginCatalogRender, finishCatalogRender, rememberCatalogPosition } from '@/utils/catalogNavigation'
import type { GameSummary, Taxonomy } from '@/types/game'
import { withRequestTimeout } from '@/utils/requestTimeout'
import '@/styles/catalog.css'

const route = useRoute()
const router = useRouter()
const keyword = ref('')
const category = ref('')
const selectedTags = ref<string[]>([])
const selectedYear = ref('')
const resourceType = ref<'' | 'free' | 'member'>('')
const currentPage = ref(1)
const categories = ref<Taxonomy[]>([])
const tags = ref<Taxonomy[]>([])
const years = ref<number[]>([])
const games = ref<GameSummary[]>([])
const total = ref(0)
const loading = ref(true)
const filtersLoading = ref(true)
const loadError = ref('')
const filterError = ref('')
const viewport = window.matchMedia('(max-width: 760px)')
const isMobile = ref(viewport.matches)
const pageSize = computed(() => isMobile.value ? 8 : 20)
const yearsToShow = computed(() => [...new Set([...years.value, ...(selectedYear.value ? [Number(selectedYear.value)] : [])])].sort((a, b) => b - a))
const activeCount = computed(() => Number(Boolean(keyword.value.trim())) + Number(Boolean(category.value)) + selectedTags.value.length + Number(Boolean(selectedYear.value)) + Number(Boolean(resourceType.value)))
const tagNames = computed(() => selectedTags.value.map(slug => ({ slug, name: tags.value.find(tag => tag.slug === slug)?.name ?? slug })))
let searchTimer: number | undefined
let listRequest: AbortController | undefined
let filterRequest: AbortController | undefined
let leaving = false
let disposed = false
let filterDrag: { element: HTMLElement; pointerId: number; startX: number; scrollLeft: number; dragging: boolean } | undefined
let draggedFilter: HTMLElement | undefined

function startFilterDrag(event: PointerEvent) {
  draggedFilter = undefined
  filterDrag = undefined
  const element = event.currentTarget as HTMLElement
  if (event.pointerType !== 'mouse' || event.button !== 0 || element.scrollWidth <= element.clientWidth) return
  filterDrag = { element, pointerId: event.pointerId, startX: event.clientX, scrollLeft: element.scrollLeft, dragging: false }
}
function moveFilterDrag(event: PointerEvent) {
  const drag = filterDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  if (!(event.buttons & 1)) { endFilterDrag(event); return }
  const distance = event.clientX - drag.startX
  if (!drag.dragging && Math.abs(distance) < 6) return
  if (!drag.dragging) {
    drag.dragging = true
    drag.element.setPointerCapture(event.pointerId)
    drag.element.classList.add('is-dragging')
  }
  event.preventDefault()
  drag.element.scrollLeft = drag.scrollLeft - distance
}
function endFilterDrag(event: PointerEvent) {
  const drag = filterDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  filterDrag = undefined
  if (drag.dragging) draggedFilter = drag.element
  drag.element.classList.remove('is-dragging')
  if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId)
}
function filterClick(event: MouseEvent) {
  if (event.detail && draggedFilter === event.currentTarget) {
    event.preventDefault()
    event.stopPropagation()
    draggedFilter = undefined
  }
}

const draftQuery = (page = 1): CatalogQuery => ({ q: keyword.value.trim().slice(0, 80), category: category.value, tags: [...selectedTags.value].sort(), year: selectedYear.value, resourceType: resourceType.value, page })

async function loadFilters(force = false) {
  if (leaving || disposed) return
  filterRequest?.abort()
  const request = new AbortController()
  filterRequest = request
  const revision = catalogRevision()
  filterError.value = ''
  const cached = force ? null : readCatalogFilters()
  if (cached) { categories.value = cached.categories; tags.value = cached.tags; years.value = cached.years; filtersLoading.value = false; return }
  filtersLoading.value = true
  try {
    const result = await withRequestTimeout(signal => catalogApi.filters(signal), 15000, request.signal)
    if (request.signal.aborted || filterRequest !== request || leaving || disposed) return
    categories.value = result.categories
    tags.value = result.tags
    years.value = result.years
    writeCatalogFilters(result, revision)
  } catch {
    if (!request.signal.aborted && filterRequest === request && !leaving && !disposed) filterError.value = '筛选项加载失败，请重试。'
  } finally { if (filterRequest === request && !leaving && !disposed) filtersLoading.value = false }
}

watch(() => route.fullPath, () => {
  if (route.name !== 'games' || leaving || disposed) return
  window.clearTimeout(searchTimer)
  const query = normalizeCatalogQuery(route.query)
  keyword.value = query.q
  category.value = query.category
  selectedTags.value = query.tags
  selectedYear.value = query.year
  resourceType.value = query.resourceType
  currentPage.value = query.page
  beginCatalogRender(route.fullPath)
  void loadGames()
}, { immediate: true })

watch([loading, filtersLoading, () => route.fullPath], async () => {
  if (loading.value || filtersLoading.value || leaving || disposed) return
  const path = route.fullPath
  await nextTick()
  requestAnimationFrame(() => {
    if (!loading.value && !filtersLoading.value && route.fullPath === path && !leaving && !disposed) finishCatalogRender(path)
  })
}, { flush: 'post' })

function updateQuery(page = 1, pagination = false) {
  window.clearTimeout(searchTimer)
  if (leaving || disposed || route.name !== 'games') return
  const target = { name: 'games', query: catalogRouteQuery(draftQuery(page)), state: { restoreCatalog: false } }
  return pagination ? router.push(target) : router.replace(target)
}
function changePage(page: number) { void updateQuery(page, true) }
function scheduleSearch() { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { void updateQuery() }, 350) }
function selectCategory(slug: string) { category.value = slug; void updateQuery() }
function selectYear(year: string) { selectedYear.value = year; void updateQuery() }
function selectAccess(value: '' | 'free' | 'member') { resourceType.value = value; void updateQuery() }
function toggleTag(slug: string) {
  if (selectedTags.value.includes(slug)) selectedTags.value = selectedTags.value.filter(tag => tag !== slug)
  else if (selectedTags.value.length < 20) selectedTags.value.push(slug)
  void updateQuery()
}
function clearTags() { selectedTags.value = []; void updateQuery() }
function reset() { keyword.value = ''; category.value = ''; selectedTags.value = []; selectedYear.value = ''; resourceType.value = ''; void updateQuery() }
function scrollToTop() { window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) }

async function loadGames(force = false) {
  if (leaving || disposed) return
  listRequest?.abort()
  const request = new AbortController()
  listRequest = request
  const path = route.fullPath
  const query = normalizeCatalogQuery(route.query)
  const params = catalogRequest(query, pageSize.value)
  const revision = catalogRevision()
  const key = catalogKey(params)
  loadError.value = ''
  const cached = force ? null : readCatalogPage(key)
  if (cached) { games.value = cached.games; total.value = cached.pagination.total; currentPage.value = cached.pagination.page; loading.value = false; return }
  loading.value = true
  try {
    const result = await withRequestTimeout(signal => getGames(params, signal), 15000, request.signal)
    if (request.signal.aborted || request !== listRequest || route.fullPath !== path || leaving || disposed) return
    games.value = result.games
    total.value = result.pagination.total
    currentPage.value = result.pagination.page
    writeCatalogPage(catalogKey({ ...params, page: result.pagination.page }), result, revision)
    if (result.pagination.page !== query.page) {
      await router.replace({ name: 'games', query: catalogRouteQuery({ ...query, page: result.pagination.page }), state: { restoreCatalog: false } })
    }
  } catch {
    if (request.signal.aborted || request !== listRequest || leaving || disposed) return
    games.value = []
    total.value = 0
    loadError.value = '游戏列表加载失败，请稍后重试。'
  } finally { if (request === listRequest && !leaving && !disposed) loading.value = false }
}

function refresh() { invalidateCatalogCache(); void loadFilters(true); void loadGames(true) }
function cancelPendingWork() { window.clearTimeout(searchTimer); listRequest?.abort(); filterRequest?.abort() }
onBeforeRouteLeave(() => {
  rememberCatalogPosition(route.fullPath, window.scrollY)
  leaving = true
  cancelPendingWork()
})
function resumeAfterFailedNavigation() {
  if (!leaving || disposed || navigationPending.value || router.currentRoute.value.name !== 'games') return
  leaving = false
  beginCatalogRender(route.fullPath)
  void loadGames()
  void loadFilters()
}
const stopAfterEach = router.afterEach((_to, _from, failure) => { if (failure) resumeAfterFailedNavigation() })
const stopError = router.onError(resumeAfterFailedNavigation)
function updateViewport() {
  isMobile.value = viewport.matches
  if (leaving || disposed) return
  if (currentPage.value > 1) void updateQuery(1)
  else { beginCatalogRender(route.fullPath); void loadGames() }
}
onMounted(() => { void loadFilters(); viewport.addEventListener('change', updateViewport) })
onBeforeUnmount(() => { disposed = true; cancelPendingWork(); stopAfterEach(); stopError(); viewport.removeEventListener('change', updateViewport) })
</script>

<template>
  <section class="page-banner games-banner catalog-banner"><div class="container"><span class="eyebrow light">GAME LIBRARY</span><h1>全部游戏</h1><p>按年份、资源权限与游戏特色，找到下一段冒险。</p></div></section>
  <section class="section games-layout-section catalog-section">
    <div class="container games-layout catalog-layout">
      <section class="filter-panel catalog-filters" aria-label="游戏筛选">
        <div class="catalog-filter-heading"><span><SlidersHorizontal :size="18" />筛选游戏</span><form class="filter-search" role="search" @submit.prevent="updateQuery()"><Search :size="17" /><input v-model="keyword" aria-label="搜索游戏名称" placeholder="输入游戏名称" maxlength="80" @input="scheduleSearch" /><button v-if="keyword" type="button" aria-label="清空关键词" @click="keyword = ''; updateQuery()"><X :size="15" /></button><button type="submit">搜索</button></form><button class="reset-button" @click="reset"><RotateCcw :size="15" />重置</button></div>
        <div v-if="filterError" class="filter-load-error" role="alert">{{ filterError }}<button @click="loadFilters(true)">重新加载筛选项</button></div>
        <div class="catalog-filter-row"><strong id="filter-year-label">发布年份</strong><div class="catalog-filter-options" role="group" aria-labelledby="filter-year-label" @pointerdown="startFilterDrag" @pointermove="moveFilterDrag" @pointerup="endFilterDrag" @pointercancel="endFilterDrag" @lostpointercapture="endFilterDrag" @click.capture="filterClick"><button :aria-pressed="!selectedYear" @click="selectYear('')">全部</button><button v-for="year in yearsToShow" :key="year" :aria-pressed="selectedYear === String(year)" @click="selectYear(String(year))">{{ year }}</button><span v-if="filtersLoading" class="catalog-filter-placeholder">加载中…</span></div></div>
        <div class="catalog-filter-row"><strong id="filter-access-label">资源权限</strong><div class="catalog-filter-options" role="group" aria-labelledby="filter-access-label" @pointerdown="startFilterDrag" @pointermove="moveFilterDrag" @pointerup="endFilterDrag" @pointercancel="endFilterDrag" @lostpointercapture="endFilterDrag" @click.capture="filterClick"><button :aria-pressed="!resourceType" @click="selectAccess('')">全部</button><button :aria-pressed="resourceType === 'free'" @click="selectAccess('free')">免费资源</button><button :aria-pressed="resourceType === 'member'" @click="selectAccess('member')">会员资源</button></div></div>
        <div class="catalog-filter-row"><strong id="filter-category-label">分类</strong><div class="catalog-filter-options" role="group" aria-labelledby="filter-category-label" @pointerdown="startFilterDrag" @pointermove="moveFilterDrag" @pointerup="endFilterDrag" @pointercancel="endFilterDrag" @lostpointercapture="endFilterDrag" @click.capture="filterClick"><button :aria-pressed="!category" @click="selectCategory('')">全部</button><button v-for="item in categories" :key="item.slug" :aria-pressed="category === item.slug" @click="selectCategory(item.slug)">{{ item.name }}</button><span v-if="filtersLoading" class="catalog-filter-placeholder">加载中…</span></div></div>
        <div class="catalog-filter-row"><strong id="filter-tags-label">标签 <small>多选</small></strong><div class="catalog-filter-options" role="group" aria-labelledby="filter-tags-label" @pointerdown="startFilterDrag" @pointermove="moveFilterDrag" @pointerup="endFilterDrag" @pointercancel="endFilterDrag" @lostpointercapture="endFilterDrag" @click.capture="filterClick"><button :aria-pressed="!selectedTags.length" @click="clearTags">全部</button><button v-for="tag in tags" :key="tag.slug" :aria-pressed="selectedTags.includes(tag.slug)" :disabled="selectedTags.length >= 20 && !selectedTags.includes(tag.slug)" @click="toggleTag(tag.slug)"><Check v-if="selectedTags.includes(tag.slug)" :size="12" />{{ tag.name }}</button><span v-if="filtersLoading" class="catalog-filter-placeholder">加载中…</span><span v-else-if="!tags.length" class="catalog-filter-placeholder">暂无标签</span></div></div>
        <div v-if="activeCount" class="catalog-selected" aria-label="已选筛选条件"><span>已选</span><button v-if="selectedYear" @click="selectYear('')">{{ selectedYear }} 年<X :size="12" /></button><button v-if="resourceType" @click="selectAccess('')">{{ resourceType === 'free' ? '免费资源' : '会员资源' }}<X :size="12" /></button><button v-if="category" @click="selectCategory('')">{{ categories.find(item => item.slug === category)?.name ?? category }}<X :size="12" /></button><button v-for="tag in tagNames" :key="tag.slug" @click="toggleTag(tag.slug)">{{ tag.name }}<X :size="12" /></button><button v-if="keyword.trim()" @click="keyword = ''; updateQuery()">{{ keyword }}<X :size="12" /></button></div>
      </section>
      <section id="catalog-results" class="results-area catalog-results" aria-label="游戏列表" :aria-busy="loading">
        <div class="results-header"><div aria-live="polite"><strong>{{ total }}</strong> 个结果<span v-if="total" class="catalog-page-label">第 {{ currentPage }} / {{ Math.ceil(total / pageSize) }} 页</span></div><div class="catalog-results-actions"><span>按发布日期排序</span><button title="刷新列表" aria-label="刷新游戏列表" @click="refresh"><RotateCcw :size="15" /></button></div></div>
        <div v-if="loading && !games.length" class="game-grid catalog-skeleton" role="status" aria-label="正在加载游戏"><div v-for="index in pageSize" :key="index" class="catalog-skeleton-card" aria-hidden="true"><div class="skeleton catalog-skeleton-cover"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div></div>
        <div v-else-if="loadError" class="empty-state"><Search :size="32" /><h2>加载失败</h2><p>{{ loadError }}</p><button class="button button-secondary" @click="loadGames(true)">重新加载</button></div>
        <template v-else-if="games.length"><div :class="['game-grid catalog-game-grid', { 'is-loading': loading }]" :inert="loading"><GameCard v-for="game in games" :key="game.id" :game="game" :return-to="route.fullPath" /></div><el-pagination v-if="total > pageSize" class="results-pagination" background layout="prev, pager, next" :pager-count="5" :current-page="currentPage" :page-size="pageSize" :total="total" @current-change="changePage" /></template>
        <div v-else class="empty-state"><Gamepad2 :size="34" /><h2>没有找到相关游戏</h2><p>换一个关键词，或减少筛选条件后再试。</p><button class="button button-secondary" @click="reset">清除筛选</button></div>
      </section>
    </div>
  </section>
  <button class="scroll-top-button" title="回到顶部" aria-label="回到顶部" @click="scrollToTop"><ArrowUp :size="20" /></button>
</template>
