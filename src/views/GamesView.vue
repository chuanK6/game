<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-vue-next'
import { ElCheckbox, ElCheckboxGroup } from 'element-plus'
import GameCard from '@/components/GameCard.vue'
import { categories, games, tags } from '@/data/games'

const route = useRoute()
const router = useRouter()
const keyword = ref(String(route.query.q ?? ''))
const category = ref(String(route.query.category ?? '全部'))
const selectedTags = ref<string[]>(route.query.tags ? String(route.query.tags).split(',') : [])

const results = computed(() => games.filter((game) => {
  const q = keyword.value.trim().toLowerCase()
  const keywordMatch = !q || [game.name, game.category, game.description, ...game.tags].some((item) => item.toLowerCase().includes(q))
  const categoryMatch = category.value === '全部' || game.category === category.value
  const tagsMatch = selectedTags.value.length === 0 || selectedTags.value.every((tag) => game.tags.includes(tag))
  return keywordMatch && categoryMatch && tagsMatch
}))

function syncQuery() {
  router.replace({
    query: {
      ...(keyword.value.trim() ? { q: keyword.value.trim() } : {}),
      ...(category.value !== '全部' ? { category: category.value } : {}),
      ...(selectedTags.value.length ? { tags: selectedTags.value.join(',') } : {}),
    },
  })
}

function reset() {
  keyword.value = ''
  category.value = '全部'
  selectedTags.value = []
}

watch([keyword, category, selectedTags], syncQuery, { deep: true })
watch(() => route.query, (query) => {
  keyword.value = String(query.q ?? '')
  category.value = String(query.category ?? '全部')
  selectedTags.value = query.tags ? String(query.tags).split(',') : []
})
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
          <div class="filter-search"><Search :size="17" /><input v-model="keyword" placeholder="游戏名称或关键词" /></div>
        </div>
        <div class="filter-group">
          <label>分类</label>
          <div class="option-list">
            <button v-for="item in categories" :key="item" :class="{ active: category === item }" @click="category = item">{{ item }}</button>
          </div>
        </div>
        <div class="filter-group">
          <label>标签</label>
          <el-checkbox-group v-model="selectedTags" class="tag-checks">
            <el-checkbox v-for="tag in tags" :key="tag" :value="tag">{{ tag }}</el-checkbox>
          </el-checkbox-group>
        </div>
        <button class="reset-button" @click="reset"><RotateCcw :size="16" />重置筛选</button>
      </aside>

      <div class="results-area">
        <div class="results-header">
          <div><strong>{{ results.length }}</strong> 个结果</div>
          <span>按最近更新排序</span>
        </div>
        <div v-if="results.length" class="game-grid three-cols">
          <GameCard v-for="game in results" :key="game.id" :game="game" />
        </div>
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
