<script setup lang="ts">
import { computed } from 'vue';
import type { PeriodReturn } from '../api/client';
import { useI18n } from 'vue-i18n';
import { fmtPct, heatColor } from '../format';
import { intlLocale } from '../i18n';

/** Year × month table of returns, with the year's total. */
const props = defineProps<{ monthly: PeriodReturn[]; yearly: PeriodReturn[] }>();

const { t } = useI18n();
// Short month names in the current language ("Oca" / "Jan").
const MONTHS = computed(() => {
  const format = new Intl.DateTimeFormat(intlLocale(), { month: 'short' });
  return Array.from({ length: 12 }, (_, i) => format.format(new Date(2020, i, 1)));
});

const years = computed(() => {
  const byYear = new Map<string, (number | null)[]>();
  for (const m of props.monthly) {
    const [year, month] = m.period.split('-');
    if (!byYear.has(year)) byYear.set(year, Array<number | null>(12).fill(null));
    byYear.get(year)![Number(month) - 1] = m.return;
  }
  const totals = new Map(props.yearly.map((y) => [y.period, y.return]));
  return [...byYear.entries()].map(([year, months]) => ({
    year,
    months,
    total: totals.get(year) ?? null,
  }));
});
</script>

<template>
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th>{{ t('reports.year') }}</th>
          <th v-for="m in MONTHS" :key="m">{{ m }}</th>
          <th>{{ t('reports.year') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="y in years" :key="y.year">
          <td class="year">{{ y.year }}</td>
          <td
            v-for="(value, i) in y.months"
            :key="i"
            :style="{ background: heatColor(value, 0.1) }"
          >
            {{ value === null ? '' : fmtPct(value, 1) }}
          </td>
          <td class="total" :style="{ background: heatColor(y.total, 0.3) }">
            {{ fmtPct(y.total, 1) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.wrap {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
}
th,
td {
  padding: 4px 6px;
  text-align: right;
  border: 1px solid var(--border);
  white-space: nowrap;
}
th {
  opacity: 0.7;
  font-weight: 500;
}
.year {
  text-align: left;
  font-weight: 600;
}
.total {
  font-weight: 600;
}
</style>
