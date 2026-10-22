<script setup lang="ts">
import { NCard, NTabPane, NTabs } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import PageHead from '../components/PageHead.vue';
import AssetReport from '../components/reports/AssetReport.vue';
import MatrixReport from '../components/reports/MatrixReport.vue';
import PortfolioReport from '../components/reports/PortfolioReport.vue';
import SignalQualityReport from '../components/reports/SignalQualityReport.vue';
import StrategyReport from '../components/reports/StrategyReport.vue';
import TradeJournal from '../components/reports/TradeJournal.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
// The tab lives in the query so links and back navigation keep it.
const tab = (route.query.tab as string | undefined) ?? 'matrix';
const select = (name: string) => void router.replace({ query: { tab: name } });
</script>

<template>
  <div class="stack">
    <PageHead :title="t('nav.reports')" :text="t('reports.intro')" />
    <NCard size="small">
      <NTabs type="line" :default-value="tab" @update:value="select">
        <NTabPane name="matrix" :tab="t('reports.tabs.matrix')">
          <MatrixReport />
        </NTabPane>
        <NTabPane name="strategy" :tab="t('reports.tabs.strategy')">
          <StrategyReport />
        </NTabPane>
        <NTabPane name="asset" :tab="t('reports.tabs.asset')">
          <AssetReport />
        </NTabPane>
        <NTabPane name="portfolio" :tab="t('reports.tabs.portfolio')">
          <PortfolioReport />
        </NTabPane>
        <NTabPane name="signals" :tab="t('reports.tabs.signals')">
          <SignalQualityReport />
        </NTabPane>
        <NTabPane name="trades" :tab="t('reports.tabs.trades')">
          <TradeJournal />
        </NTabPane>
      </NTabs>
    </NCard>
  </div>
</template>
