import { ref } from 'vue';
import { useMessage } from 'naive-ui';
import { errorMessage } from '../api/client';

/** Runs a user action with a shared busy flag: shows its error, then calls `onDone` (reload). */
export function useAction(onDone: () => Promise<unknown> | void) {
  const message = useMessage();
  const busy = ref(false);

  async function act(action: () => Promise<unknown>, done?: string): Promise<void> {
    busy.value = true;
    try {
      await action();
      if (done) message.success(done);
      await onDone();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      busy.value = false;
    }
  }
  return { busy, act };
}
