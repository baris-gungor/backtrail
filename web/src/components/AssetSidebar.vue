<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { NList, NListItem, NSpin, NTag, useMessage } from 'naive-ui';
import { api, call, errorMessage } from '../api/client';
import { useAssets } from '../composables/useAssets';
import { assetClassLabel, fmtDate } from '../format';
import AssetSearch from './AssetSearch.vue';

const { assets, loading, refresh } = useAssets();
const router = useRouter();
const message = useMessage();
const { t } = useI18n();
const search = ref<InstanceType<typeof AssetSearch>>();
const adding = ref(false);

onMounted(() => {
  refresh().catch((e: unknown) => message.error(errorMessage(e)));
});

async function add(symbol: string): Promise<void> {
  adding.value = true;
  try {
    const asset = await call(api.POST('/api/assets', { body: { symbol } }));
    message.success(t('assets.added', { symbol: asset.symbol }));
    search.value?.clear();
    await refresh();
    await router.push(`/assets/${encodeURIComponent(asset.symbol)}`);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    adding.value = false;
  }
}

/** Futures symbol an ETF proxy stands in for. */
const proxyOf = (a: { proxyForId?: string | null }) =>
  a.proxyForId ? assets.value.find((x) => x.id === a.proxyForId)?.symbol : undefined;
</script>

<template>
  <AssetSearch
    ref="search"
    :adding="adding"
    @add="add"
    @open="(symbol) => router.push(`/assets/${encodeURIComponent(symbol)}`)"
  />
  <NSpin :show="loading">
    <NList hoverable clickable style="margin-top: 12px">
      <NListItem
        v-for="a in assets"
        :key="a.id"
        @click="router.push(`/assets/${encodeURIComponent(a.symbol)}`)"
      >
        <div class="row">
          <strong>{{ a.symbol }}</strong>
          <NTag size="tiny" :bordered="false">{{ assetClassLabel(a.assetClass) }}</NTag>
          <NTag v-if="!a.isActive" size="tiny" type="warning">{{ t('assets.inactive') }}</NTag>
          <span v-if="proxyOf(a)" class="sub" :title="t('proxy.etfOfFutures')">
            ≈ {{ proxyOf(a) }}
          </span>
        </div>
        <div class="sub">{{ a.name }}</div>
        <div class="sub">sync: {{ fmtDate(a.lastSyncedAt) }}</div>
      </NListItem>
    </NList>
  </NSpin>
</template>

<style scoped>
.row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.sub {
  font-size: 12px;
  opacity: 0.65;
}
</style>
