<script setup lang="ts">
import { CalendarDays } from 'lucide-vue-next'
import type { Game } from '@/types/game'

defineProps<{ game: Game }>()
</script>

<template>
  <RouterLink :to="`/games/${game.slug}`" class="game-card">
    <div class="game-cover-wrap">
      <img :src="game.cover" :alt="`${game.name} 游戏封面`" class="game-cover" loading="lazy" />
      <span :class="['resource-badge', game.resourceType]">{{ game.resourceType === 'free' ? '免费' : '会员' }}</span>
    </div>
    <div class="game-card-body">
      <div class="game-meta-top">
        <span class="category-label">{{ game.category }}</span>
        <span v-for="tag in game.tags.slice(0, 2)" :key="tag" class="tag-label">{{ tag }}</span>
      </div>
      <h3>{{ game.name }}</h3>
      <div class="game-date"><CalendarDays :size="15" />{{ game.publishAt }}</div>
    </div>
  </RouterLink>
</template>
