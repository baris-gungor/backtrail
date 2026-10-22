import { onBeforeUnmount, onMounted } from 'vue';

/**
 * Runs `task` every `intervalMs` while the component is mounted and the tab is visible.
 * A tick is skipped while the previous run is still in flight, and a hidden tab pauses polling
 * (it refreshes once when the tab is shown again). The first run is up to the caller.
 */
export function usePolling(task: () => Promise<unknown>, intervalMs: number): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  async function tick(): Promise<void> {
    if (running || document.hidden) return;
    running = true;
    try {
      await task();
    } catch {
      // The task reports its own errors; a failing tick must not stop the timer.
    } finally {
      running = false;
    }
  }

  const onVisible = () => void tick();
  onMounted(() => {
    timer = setInterval(() => void tick(), intervalMs);
    document.addEventListener('visibilitychange', onVisible);
  });
  onBeforeUnmount(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });
}
