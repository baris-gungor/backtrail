<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api, call, errorMessage, type PortfolioDetail } from '../../api/client';
import PriceInput from './PriceInput.vue';
import { useAction } from '../../composables/useAction';
import { fmtDate, fmtDec, fmtNum, rejectReasonLabel, sideLabel } from '../../format';
import { estimateBuy } from '../../orderEstimate';

const props = defineProps<{
  portfolio: PortfolioDetail;
  symbolOptions: { label: string; value: string }[];
}>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const { busy, act } = useAction(() => emit('changed'));

const order = reactive({
  symbol: null as string | null,
  side: 'BUY' as 'BUY' | 'SELL',
  type: 'market' as 'market' | 'limit',
  amountMode: 'notional' as 'notional' | 'quantity',
  amount: null as number | null,
  limitPrice: null as number | null,
  stopLoss: null as number | null,
  takeProfit: null as number | null,
});

/** Outcome of the last submit, kept on screen (a toast disappears before it can be read). */
const result = ref<{ type: 'success' | 'warning' | 'error'; text: string }>();

// --- Market price of the selected symbol -------------------------------------------------------
const last = ref<{ price: number; time: string }>();
const priceLoading = ref(false);
let priceSeq = 0;

async function loadPrice(symbol: string): Promise<void> {
  const mine = ++priceSeq;
  priceLoading.value = true;
  last.value = undefined;
  try {
    const res = await call(
      api.GET('/api/market-data/bars', {
        params: { query: { symbol, timeframe: '1h', limit: 1 } },
      }),
    );
    if (mine !== priceSeq) return;
    const bar = res.bars[res.bars.length - 1];
    last.value = bar ? { price: bar.close, time: bar.openTime } : undefined;
  } catch {
    if (mine === priceSeq) last.value = undefined;
  } finally {
    if (mine === priceSeq) priceLoading.value = false;
  }
}

watch(
  () => order.symbol,
  (symbol) => {
    result.value = undefined;
    order.limitPrice = null;
    order.stopLoss = null;
    order.takeProfit = null;
    if (symbol) void loadPrice(symbol);
    else last.value = undefined;
  },
);

// --- Derived state ----------------------------------------------------------------------------
const rules = computed(() => props.portfolio.riskRules);
const isAlpaca = computed(() => props.portfolio.mode === 'alpaca_paper');
const position = computed(() => props.portfolio.positions.find((p) => p.symbol === order.symbol));
const isBuy = computed(() => order.side === 'BUY');

/** Price the order is sized with: the limit price for limit orders, otherwise the last close. */
const refPrice = computed(() =>
  order.type === 'limit' && order.limitPrice ? order.limitPrice : (last.value?.price ?? null),
);

/**
 * Alpaca takes fractional shares only as a plain market order by amount. Stop / take-profit legs and
 * limit orders need whole shares, so the amount is converted to a whole quantity.
 */
const wholeShares = computed(
  () => isAlpaca.value && (!!order.stopLoss || !!order.takeProfit || order.type === 'limit'),
);

const estimate = computed(() =>
  estimateBuy({
    amountMode: order.amountMode,
    amount: order.amount,
    price: refPrice.value,
    wholeShares: wholeShares.value,
    equity: Number(props.portfolio.equity),
    cash: Number(props.portfolio.cash),
    maxPositionPct: rules.value.maxPositionPct,
    cashBufferPct: rules.value.cashBufferPct,
  }),
);

const levelIssues = computed(() => {
  const issues: string[] = [];
  const price = refPrice.value;
  if (!isBuy.value || !price) return issues;
  if (rules.value.requireStopLoss && !order.stopLoss) {
    issues.push(t('order.issues.stopRequired'));
  }
  if (order.stopLoss && order.stopLoss >= price) issues.push(t('order.issues.stopBelow'));
  if (order.takeProfit && order.takeProfit <= price) issues.push(t('order.issues.tpAbove'));
  return issues;
});

const issues = computed(() => [
  ...(isBuy.value ? estimate.value.issues : []),
  ...levelIssues.value,
  ...(isBuy.value && position.value ? [t('order.issues.positionExists')] : []),
]);

const canSubmit = computed(() => {
  if (!order.symbol) return false;
  if (!isBuy.value) return !!position.value;
  if (order.type === 'limit' && !order.limitPrice) return false;
  return !!order.amount && order.amount > 0 && estimate.value.quantity > 0;
});

const submitLabel = computed(() => {
  if (!isBuy.value) return position.value ? t('order.close') : t('order.nothingToClose');
  const q = estimate.value.quantity;
  return q > 0 ? t('order.buyQuantity', { n: fmtNum(q, q < 10 ? 4 : 2) }) : t('order.buy');
});

function pct(base: number | null, percent: number): number | null {
  return base ? Number((base * (1 + percent / 100)).toFixed(2)) : null;
}
function suggestLevels(): void {
  order.stopLoss = pct(refPrice.value, -5);
  order.takeProfit = pct(refPrice.value, 10);
}
function useLastAsLimit(): void {
  if (last.value) order.limitPrice = last.value.price;
}

// --- Submit -----------------------------------------------------------------------------------
const place = () =>
  act(async () => {
    result.value = undefined;
    try {
      // Whole-share brokers get a computed quantity; otherwise the typed amount goes as typed.
      const amount = wholeShares.value
        ? { quantity: String(estimate.value.quantity) }
        : { [order.amountMode]: String(order.amount) };
      const placed = await call(
        api.POST('/api/portfolios/{id}/orders', {
          params: { path: { id: props.portfolio.id } },
          body: {
            symbol: order.symbol!,
            side: order.side,
            type: order.type,
            ...(isBuy.value && order.amount ? amount : {}),
            ...(order.type === 'limit' && order.limitPrice ? { limitPrice: order.limitPrice } : {}),
            ...(isBuy.value && order.stopLoss ? { stopLoss: order.stopLoss } : {}),
            ...(isBuy.value && order.takeProfit ? { takeProfit: order.takeProfit } : {}),
          },
        }),
      );
      result.value =
        placed.status === 'rejected'
          ? {
              type: 'warning',
              text: t('order.rejected', { reason: rejectReasonLabel(placed.rejectReason) }),
            }
          : {
              type: 'success',
              text: placed.status === 'filled' ? t('order.filled') : t('order.sent'),
            };
    } catch (e) {
      result.value = { type: 'error', text: errorMessage(e) };
    }
  });
</script>

<template>
  <NForm label-placement="left" label-width="120" size="small" style="max-width: 560px">
    <NFormItem :label="t('trades.symbol')">
      <NSelect v-model:value="order.symbol" :options="symbolOptions" filterable />
    </NFormItem>

    <div v-if="order.symbol" class="info">
      <div>
        <span class="k">{{ t('portfolioReport.lastPrice') }}</span>
        <template v-if="last">
          <strong>{{ fmtNum(last.price) }} $</strong>
          <span class="hint"> · {{ t('order.lastClose', { time: fmtDate(last.time) }) }}</span>
        </template>
        <span v-else-if="priceLoading" class="hint">{{ t('order.loading') }}</span>
        <span v-else class="hint">{{ t('order.noData') }}</span>
      </div>
      <div>
        <span class="k">{{ t('broker.cash') }}</span>
        <strong>{{ fmtDec(portfolio.cash) }} $</strong>
        <span class="hint"> · equity {{ fmtDec(portfolio.equity) }} $</span>
      </div>
      <div v-if="position">
        <span class="k">{{ t('order.position') }}</span>
        <strong>{{ t('order.shares', { n: fmtDec(position.quantity, 4) }) }}</strong>
        <span class="hint">
          · {{ fmtDec(position.marketValue) }} $ · PnL {{ fmtDec(position.unrealizedPnl) }} $</span
        >
      </div>
    </div>

    <NFormItem :label="t('order.sideType')">
      <div class="hstack">
        <NRadioGroup v-model:value="order.side" size="small">
          <NRadioButton value="BUY">{{ sideLabel('BUY') }}</NRadioButton>
          <NRadioButton value="SELL">{{ sideLabel('SELL') }}</NRadioButton>
        </NRadioGroup>
        <NRadioGroup v-if="isBuy" v-model:value="order.type" size="small">
          <NRadioButton value="market">{{ t('order.market') }}</NRadioButton>
          <NRadioButton value="limit">limit</NRadioButton>
        </NRadioGroup>
      </div>
    </NFormItem>

    <template v-if="isBuy">
      <NFormItem :label="t('trades.quantity')">
        <div class="stack" style="--gap: 4px">
          <div class="hstack">
            <NRadioGroup v-model:value="order.amountMode" size="small">
              <NRadioButton value="notional">{{ t('order.notional') }}</NRadioButton>
              <NRadioButton value="quantity">{{ t('order.quantity') }}</NRadioButton>
            </NRadioGroup>
            <NInputNumber
              v-model:value="order.amount"
              :min="0"
              :placeholder="
                order.amountMode === 'notional'
                  ? t('order.eg', { v: 500 })
                  : t('order.eg', { v: 2 })
              "
              style="width: 150px"
            />
          </div>
          <span v-if="estimate.quantity > 0" class="hint">
            {{
              t('order.estimate', {
                n: fmtNum(estimate.quantity, 4),
                cost: fmtNum(estimate.cost),
                pct: fmtNum(estimate.pctOfEquity),
              })
            }}
            <template v-if="wholeShares"> {{ t('order.wholeSharesTag') }}</template>
          </span>
          <span v-else-if="wholeShares && order.amount" class="hint">{{
            t('order.wholeShares')
          }}</span>
        </div>
      </NFormItem>

      <NFormItem v-if="order.type === 'limit'" :label="t('order.limitPrice')">
        <div class="hstack">
          <PriceInput v-model="order.limitPrice" :base="last?.price ?? null" />
          <NButton size="tiny" quaternary :disabled="!last" @click="useLastAsLimit">
            {{ t('order.useLast') }}
          </NButton>
        </div>
      </NFormItem>

      <NFormItem label="Stop / TP">
        <div class="stack" style="--gap: 4px">
          <div class="hstack">
            <PriceInput
              v-model="order.stopLoss"
              :base="refPrice"
              :placeholder="rules.requireStopLoss ? t('order.stopRequired') : 'stop'"
            />
            <PriceInput v-model="order.takeProfit" :base="refPrice" placeholder="TP" />
            <NButton size="tiny" quaternary :disabled="!refPrice" @click="suggestLevels">
              {{ t('order.suggest') }}
            </NButton>
          </div>
          <span v-if="isAlpaca && (order.stopLoss || order.takeProfit)" class="hint">
            {{ t('order.alpacaWhole') }}
          </span>
        </div>
      </NFormItem>
    </template>

    <NFormItem v-if="issues.length" label=" ">
      <NAlert type="warning" :show-icon="false" style="width: 100%">
        <div v-for="text in issues" :key="text">{{ text }}</div>
      </NAlert>
    </NFormItem>

    <NFormItem label=" ">
      <div class="stack" style="--gap: 6px">
        <NButton
          :type="isBuy ? 'primary' : 'error'"
          :disabled="!canSubmit"
          :loading="busy"
          @click="place"
        >
          {{ submitLabel }}
        </NButton>
        <NAlert v-if="result" :type="result.type" closable @close="result = undefined">
          {{ result.text }}
        </NAlert>
        <span class="hint">
          {{ t('order.help') }}
          <template v-if="isAlpaca">{{ t('order.helpAlpaca') }}</template>
        </span>
      </div>
    </NFormItem>
  </NForm>
</template>

<style scoped>
.info {
  margin: 0 0 12px 120px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.k {
  display: inline-block;
  min-width: 70px;
  color: var(--muted);
}
.hint {
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 768px) {
  .info {
    margin-left: 0;
  }
}
</style>
