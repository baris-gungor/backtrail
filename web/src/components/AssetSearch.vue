<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NButton, NInput, NSpin, NTag } from 'naive-ui';
import { api, call, errorMessage, type AssetSuggestion } from '../api/client';
import { useI18n } from 'vue-i18n';
import { assetClassLabel } from '../format';

/**
 * Add-asset box: searches the data provider by name or ticker and offers the matches.
 * Enter adds the top untracked match, or the typed text as a symbol when nothing matches
 * (the backend then validates it).
 */
defineProps<{ adding: boolean }>();
const emit = defineEmits<{ add: [symbol: string]; open: [symbol: string] }>();

const { t } = useI18n();
const DEBOUNCE_MS = 300;

const query = ref('');
const hits = ref<AssetSuggestion[]>([]);
const searching = ref(false);
const failure = ref<string>();
/** The text the current `hits` belong to. */
const searchedFor = ref('');

let timer: ReturnType<typeof setTimeout> | undefined;
// Only the newest request may write results; a slow older one is dropped.
let requestSeq = 0;

async function search(text: string): Promise<void> {
  const mine = ++requestSeq;
  searching.value = true;
  failure.value = undefined;
  try {
    const result = await call(api.GET('/api/assets/search', { params: { query: { q: text } } }));
    if (mine !== requestSeq) return;
    hits.value = result;
    searchedFor.value = text;
  } catch (e) {
    if (mine !== requestSeq) return;
    hits.value = [];
    failure.value = errorMessage(e);
  } finally {
    if (mine === requestSeq) searching.value = false;
  }
}

watch(query, (value) => {
  clearTimeout(timer);
  const text = value.trim();
  if (!text) {
    requestSeq++;
    hits.value = [];
    searching.value = false;
    failure.value = undefined;
    return;
  }
  searching.value = true;
  timer = setTimeout(() => void search(text), DEBOUNCE_MS);
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  requestSeq++;
});

const typed = computed(() => query.value.trim().toUpperCase());
const showEmpty = computed(
  () => !!typed.value && !searching.value && !failure.value && hits.value.length === 0,
);

function addHit(hit: AssetSuggestion): void {
  if (hit.tracked) emit('open', hit.symbol);
  else emit('add', hit.symbol);
}

function onEnter(): void {
  if (!typed.value) return;
  // Results for older text must not decide: the user typed past them.
  const fresh = searchedFor.value === query.value.trim();
  const top = fresh ? hits.value.find((h) => !h.tracked) : undefined;
  emit('add', top ? top.symbol : typed.value);
}

/** Called by the parent after a successful add. */
function clear(): void {
  query.value = '';
}
defineExpose({ clear });
</script>

<template>
  <div class="search">
    <NInput
      v-model:value="query"
      clearable
      :placeholder="t('search.placeholder')"
      :disabled="adding"
      :aria-label="t('search.label')"
      @keyup.enter="onEnter"
    />
    <NSpin v-if="query.trim()" :show="searching" size="small">
      <ul v-if="hits.length" class="results">
        <li v-for="h in hits" :key="h.symbol">
          <div class="info">
            <div class="top">
              <strong>{{ h.symbol }}</strong>
              <NTag size="tiny" :bordered="false">{{ assetClassLabel(h.assetClass) }}</NTag>
            </div>
            <div class="sub">{{ h.name }}</div>
            <div v-if="h.exchange" class="sub">{{ h.exchange }}</div>
          </div>
          <NButton v-if="h.tracked" size="tiny" quaternary @click="addHit(h)">{{
            t('search.open')
          }}</NButton>
          <NButton v-else size="tiny" type="primary" :loading="adding" @click="addHit(h)">
            {{ t('search.add') }}
          </NButton>
        </li>
      </ul>
      <div v-else-if="failure" class="note error">
        {{ t('search.failed', { error: failure }) }}
      </div>
      <div v-else-if="showEmpty" class="note">{{ t('search.empty', { symbol: typed }) }}</div>
      <div v-else class="note">&nbsp;</div>
    </NSpin>
    <div v-else class="note">{{ t('search.scope') }}</div>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.results {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.results li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
}
.results li + li {
  border-top: 1px solid var(--border);
}
.info {
  min-width: 0;
}
.top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sub {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note {
  font-size: 12px;
  color: var(--muted);
}
.note.error {
  color: var(--down);
}
</style>
