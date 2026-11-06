<script setup lang="ts">
import type {
  RecordingCard,
  RecordingCardPage,
} from '../../../shared/recording-cards';
import homeRecordIcon from '../assets/ucd/home-record-black.svg';
import WorkbenchIcon from './WorkbenchIcon.vue';
defineProps<{
  result: RecordingCardPage;
  busy: boolean;
  query: string;
  error: string;
}>();
const emit = defineEmits<{
  open: [card: RecordingCard];
  create: [];
  edit: [card: RecordingCard];
  remove: [card: RecordingCard];
  search: [query: string];
  page: [page: number];
  retry: [];
}>();
const colors = ['blue', 'purple', 'orange', 'pink', 'green'];
function color(id: string): string {
  return colors[
    Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
      colors.length
  ];
}
function date(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
</script>
<template>
  <section class="recording-home" aria-label="录制记录">
    <header class="catalog-heading">
      <h1><img :src="homeRecordIcon" alt="" />录制流程</h1>
      <div class="catalog-tools">
        <label class="card-search"
          ><span class="sr-only">搜索流程</span
          ><input
            type="search"
            :value="query"
            placeholder="请输入名称搜索"
            maxlength="200"
            @input="
              emit('search', ($event.target as HTMLInputElement).value)
            " /><WorkbenchIcon name="search" /></label
        ><button class="primary" @click="emit('create')">创建任务</button>
      </div>
    </header>
    <div v-if="error" class="console-error" role="alert">
      {{ error }}
      <button class="text-button" @click="emit('retry')">重新加载</button>
    </div>
    <p v-if="busy" class="catalog-feedback" role="status">正在加载…</p>
    <p v-else-if="!result.cards.length && !error" class="catalog-feedback">
      {{ query ? '没有匹配的流程' : '暂无录制流程，点击“创建任务”开始' }}
    </p>
    <div class="recording-card-grid" :aria-busy="busy">
      <article
        v-for="card in result.cards"
        :key="card.id"
        class="recording-card"
      >
        <button class="card-open" @click="emit('open', card)">
          <div class="card-title">
            <span class="card-avatar" :class="color(card.id)">{{
              Array.from(card.name)[0]?.toUpperCase()
            }}</span>
            <h2 :title="card.name">{{ card.name }}</h2>
          </div>
          <p class="card-description">{{ card.description }}</p>
          <div class="card-bottom">
            <time :datetime="card.updatedAt">{{ date(card.updatedAt) }}</time
            ><span v-if="!card.recordingId" class="card-pending">待录制</span>
          </div>
        </button>
        <div class="card-actions">
          <button
            :aria-label="`编辑 ${card.name}`"
            title="修改名称和描述"
            @click="emit('edit', card)"
          >
            编辑</button
          ><button
            :aria-label="`删除 ${card.name}`"
            title="删除卡片"
            @click="emit('remove', card)"
          >
            <WorkbenchIcon name="trash" />
          </button>
        </div>
      </article>
    </div>
    <nav v-if="result.total" class="card-pagination" aria-label="分页">
      <span>共 {{ result.total }} 条</span
      ><button
        :disabled="busy || result.page <= 1"
        aria-label="上一页"
        @click="emit('page', result.page - 1)"
      >
        ‹</button
      ><span
        >{{ result.page }} /
        {{ Math.max(1, Math.ceil(result.total / result.pageSize)) }}</span
      ><button
        :disabled="busy || result.page * result.pageSize >= result.total"
        aria-label="下一页"
        @click="emit('page', result.page + 1)"
      >
        ›
      </button>
    </nav>
  </section>
</template>
