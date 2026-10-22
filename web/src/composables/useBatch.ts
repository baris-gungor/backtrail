import { onBeforeUnmount, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { api, call, errorMessage, type Batch } from '../api/client';
import { t } from '../i18n';

const POLL_MS = 1000;
/** Failed polls in a row before the batch is given up on. */
const MAX_FAILURES = 5;

/** Polls a backtest batch until no run is pending or running. */
export function useBatch(onDone: (batch: Batch) => void) {
  const message = useMessage();
  const batch = ref<Batch>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unmounted = false;
  let failures = 0;

  /** The first call rejects to the caller; later timer calls handle their own errors. */
  async function poll(batchId: string): Promise<void> {
    clearTimeout(timer);
    const next = await call(
      api.GET('/api/backtests/batches/{batchId}', { params: { path: { batchId } } }),
    );
    // The page was left while the request was in flight.
    if (unmounted) return;
    failures = 0;
    batch.value = next;
    if (next.pending + next.running > 0) schedule(batchId);
    else onDone(next);
  }

  function schedule(batchId: string): void {
    timer = setTimeout(() => {
      poll(batchId).catch((e: unknown) => {
        if (unmounted) return;
        if (++failures >= MAX_FAILURES) {
          message.error(t('backtests.batchFailed', { error: errorMessage(e) }));
          return;
        }
        // A short outage (backend restart) should not lose the batch.
        schedule(batchId);
      });
    }, POLL_MS);
  }

  onBeforeUnmount(() => {
    unmounted = true;
    clearTimeout(timer);
  });
  return { batch, poll };
}
