<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarDays, Gamepad2, Pin } from 'lucide-vue-next'
import type { GameSummary } from '@/types/game'

const props = defineProps<{ game: GameSummary; returnTo?: string }>()
const coverFailed = ref(false)
watch(() => props.game.cover, () => { coverFailed.value = false })
const publishedDate = computed(() => props.game.publishAt?.slice(0, 10) || '日期待补充')
</script>

<template>
  <RouterLink :to="{ path: `/games/${game.slug}`, state: { catalogReturnTo: returnTo ?? null } }" class="game-card">
    <div class="game-cover-wrap">
      <span v-if="game.isPinned" class="pinned-badge"><Pin :size="12" aria-hidden="true" />置顶</span>
      <img v-if="!coverFailed" :src="game.cover" :alt="`${game.name} 游戏封面`" class="game-cover" loading="lazy" decoding="async" @error="coverFailed = true" />
      <div v-else class="game-cover-fallback"><Gamepad2 :size="28" /><span>封面暂不可用</span></div>
      <span :class="['resource-badge', game.resourceType]">{{ game.resourceType === 'free' ? '免费' : '会员' }}</span>
    </div>
    <div class="game-card-body">
      <div class="game-meta-top">
        <span class="category-label">{{ game.category.name }}</span>
        <span v-for="tag in game.tags.slice(0, 2)" :key="tag.slug" class="tag-label">{{ tag.name }}</span>
      </div>
      <h3>{{ game.name }}</h3>
      <div class="game-date"><CalendarDays :size="15" /><time v-if="game.publishAt" :datetime="game.publishAt">{{ publishedDate }}</time><span v-else>{{ publishedDate }}</span></div>
    </div>
  </RouterLink>
</template>
