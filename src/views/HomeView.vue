<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Search, ShieldCheck, Sparkles } from 'lucide-vue-next'
import GameCard from '@/components/GameCard.vue'
import { categories, games } from '@/data/games'

const router = useRouter()
const keyword = ref('')
const activeHero = ref(0)
const heroImages = ['/assets/hero/hero-1.webp', '/assets/hero/hero-2.webp', '/assets/hero/hero-3.webp', '/assets/hero/hero-4.webp']
const latestGames = computed(() => games.slice(0, 4))
let timer: number | undefined

function submitSearch() {
  const q = keyword.value.trim()
  router.push({ name: 'games', query: q ? { q } : {} })
}

function browseCategory(category: string) {
  router.push({ name: 'games', query: category === '全部' ? {} : { category } })
}

onMounted(() => {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    timer = window.setInterval(() => { activeHero.value = (activeHero.value + 1) % heroImages.length }, 6500)
  }
})

onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <section class="home-hero" :style="{ backgroundImage: `url(${heroImages[activeHero]})` }">
    <div class="hero-shade" aria-hidden="true"></div>
    <div class="container hero-content">
      <div class="hero-kicker"><Sparkles :size="16" /> 每周更新 PC 游戏资源</div>
      <h1>下一段冒险，从这里启程</h1>
      <p>按名称、分类或标签，快速找到适合你的游戏。</p>
      <form class="hero-search" role="search" @submit.prevent="submitSearch">
        <Search :size="22" aria-hidden="true" />
        <input v-model="keyword" aria-label="搜索游戏名称或关键词" placeholder="搜索游戏名称或关键词" autofocus />
        <button type="submit" class="button button-accent">搜索</button>
      </form>
      <div class="hero-trust">
        <span><ShieldCheck :size="17" /> 权限清晰</span>
        <span>资源状态持续维护</span>
      </div>
    </div>
    <div class="hero-dots" aria-label="背景图切换">
      <button v-for="(_, index) in heroImages" :key="index" :class="{ active: activeHero === index }" :aria-label="`显示第 ${index + 1} 张背景图`" @click="activeHero = index"></button>
    </div>
  </section>

  <section class="category-strip">
    <div class="container category-strip-inner">
      <span class="strip-label">快速发现</span>
      <button v-for="category in categories" :key="category" @click="browseCategory(category)">{{ category }}</button>
    </div>
  </section>

  <section class="section recent-section">
    <div class="container">
      <div class="section-heading">
        <div>
          <span class="eyebrow">NEW THIS WEEK</span>
          <h2>最近更新</h2>
        </div>
        <RouterLink to="/games" class="text-link">查看全部 <ArrowRight :size="17" /></RouterLink>
      </div>
      <div class="game-grid">
        <GameCard v-for="game in latestGames" :key="game.id" :game="game" />
      </div>
    </div>
  </section>

  <section class="membership-band">
    <div class="container membership-band-inner">
      <img src="/assets/brand/site-mark.png" alt="" aria-hidden="true" />
      <div>
        <span class="eyebrow light">YOULUN MEMBER</span>
        <h2>把选择留给游戏，把查找交给游浪</h2>
        <p>会员可访问完整会员资源库，终身方案一次开通，长期有效。</p>
      </div>
      <RouterLink to="/profile?tab=membership" class="button button-accent">了解会员 <ArrowRight :size="18" /></RouterLink>
    </div>
  </section>
</template>
