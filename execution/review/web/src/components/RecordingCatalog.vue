<script setup lang="ts">
import type {
  RecordingCard,
  RecordingCardPage,
} from '../../../shared/recording-cards';
import homeRecordIcon from '../assets/ucd/home-record-black.svg';
import WorkbenchIcon from './WorkbenchIcon.vue';
import { useI18n } from '../i18n';
const { t, formatDateTime } = useI18n();
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
  return formatDateTime(value);
}
</script>
<template>
  <section class="recording-home" :aria-label="t('card.homeTitle')">
    <header class="catalog-heading">
      <h1><img :src="homeRecordIcon" alt="" />{{ t('card.homeTitle') }}</h1>
      <div class="catalog-tools">
        <label class="card-search"
          ><span class="sr-only">{{ t('card.homeTitle') }}</span
          ><input
            type="search"
            :value="query"
            :placeholder="t('card.searchPlaceholder')"
            maxlength="200"
            @input="
              emit('search', ($event.target as HTMLInputElement).value)
            " /><WorkbenchIcon name="search" /></label
        ><button class="primary" @click="emit('create')">{{ t('card.create') }}</button>
      </div>
    </header>
    <div class="home-scroll">
      <div v-if="error" class="console-error" role="alert">
        {{ error }}
        <button class="text-button" @click="emit('retry')">{{ t('card.retry') }}</button>
      </div>
      <p v-if="busy" class="catalog-feedback" role="status">{{ t('card.loading') }}</p>
      <p v-else-if="!result.cards.length && !error" class="catalog-feedback">
        {{ query ? t('card.noMatch') : t('card.empty') }}
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
          </button>
          <span v-if="!card.recordingId" class="card-pending">{{ t('card.pending') }}</span>
          <div class="card-bottom">
            <button class="card-time" :aria-label="`${t('card.nav')} ${card.name}`" @click="emit('open', card)"><time :datetime="card.updatedAt">{{ date(card.updatedAt) }}</time></button>
            <div class="card-actions">
              <button
                :aria-label="`${t('card.edit')} ${card.name}`"
                :title="t('card.editTitle')"
                @click="emit('edit', card)"
              >
                {{ t('card.edit') }}</button
              ><button
                :aria-label="`${t('card.delete')} ${card.name}`"
                :title="t('card.deleteTitle')"
                @click="emit('remove', card)"
              >
                <WorkbenchIcon name="trash" />
              </button>
            </div>
          </div>
        </article>
      </div>
      <nav v-if="result.total" class="card-pagination" :aria-label="t('card.pagination', { total: result.total })">
        <span>{{ t('card.pagination', { total: result.total }) }}</span
        ><button
          :disabled="busy || result.page <= 1"
          :aria-label="t('card.prevPage')"
          @click="emit('page', result.page - 1)"
        >
          ‹</button
        ><span
          >{{ result.page }} /
          {{ Math.max(1, Math.ceil(result.total / result.pageSize)) }}</span
        ><button
          :disabled="busy || result.page * result.pageSize >= result.total"
          :aria-label="t('card.nextPage')"
          @click="emit('page', result.page + 1)"
        >
          ›
        </button>
      </nav>
    </div>
  </section>
</template>
