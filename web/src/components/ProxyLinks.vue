<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { NButton, NTag, useMessage } from 'naive-ui';
import { api, call, errorMessage, type Asset, type Schemas } from '../api/client';
import { useI18n } from 'vue-i18n';
import { useAssets } from '../composables/useAssets';
import Term from './Term.vue';

/** Futures ↔ ETF proxy links of one asset, and a one-click add for the known ETF. */
const props = defineProps<{ asset: Asset }>();
const message = useMessage();
const { t } = useI18n();
const { assets, refresh } = useAssets();

type Proxy = Schemas['CommodityProxyDto'];
// The list is static on the server; one request per page load is enough.
const known = ref<Proxy[]>([]);
onMounted(async () => {
  try {
    known.value = await call(api.GET('/api/assets/commodity-proxies'));
  } catch {
    known.value = [];
  }
});

const tracks = computed(() => assets.value.find((a) => a.id === props.asset.proxyForId));
const trackedBy = computed(() => assets.value.filter((a) => a.proxyForId === props.asset.id));
const entry = computed(
  () =>
    known.value.find((p) => p.futures === props.asset.symbol) ??
    known.value.find((p) => p.etf === props.asset.symbol),
);
/** The known ETF of this futures asset, when it is not registered yet. */
const missingEtf = computed(() =>
  entry.value?.futures === props.asset.symbol &&
  !assets.value.some((a) => a.symbol === entry.value!.etf)
    ? entry.value.etf
    : null,
);

const adding = ref(false);
async function addEtf(): Promise<void> {
  if (!missingEtf.value) return;
  adding.value = true;
  try {
    await call(api.POST('/api/assets', { body: { symbol: missingEtf.value } }));
    message.success(t('assets.added', { symbol: missingEtf.value }));
    await refresh();
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <div v-if="tracks || trackedBy.length || missingEtf" class="hstack" style="--gap: 6px 8px">
    <Term k="proxy">{{ entry?.name ?? t('proxy.commodity') }}</Term>
    <NTag v-if="tracks" size="small" :bordered="false" type="info">
      <RouterLink :to="`/assets/${encodeURIComponent(tracks.symbol)}`">
        {{ t('proxy.etfOf', { symbol: tracks.symbol }) }}
      </RouterLink>
    </NTag>
    <NTag v-for="etf in trackedBy" :key="etf.id" size="small" :bordered="false" type="info">
      ETF:
      <RouterLink :to="`/assets/${encodeURIComponent(etf.symbol)}`">{{ etf.symbol }}</RouterLink>
    </NTag>
    <NButton v-if="missingEtf" size="tiny" :loading="adding" @click="addEtf">
      {{ t('proxy.addEtf', { symbol: missingEtf }) }}
    </NButton>
  </div>
</template>
