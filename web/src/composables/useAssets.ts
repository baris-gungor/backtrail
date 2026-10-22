import { ref } from 'vue';
import { api, call, errorMessage, type Asset } from '../api/client';

// Shared across views: the sidebar and pages read the same list.
const assets = ref<Asset[]>([]);
const loading = ref(false);
/** Message of the last failed load; cleared by the next successful one. */
const error = ref<string>();
let loaded = false;

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    assets.value = await call(api.GET('/api/assets'));
    loaded = true;
    error.value = undefined;
  } catch (e) {
    error.value = errorMessage(e);
    throw e;
  } finally {
    loading.value = false;
  }
}

export function useAssets() {
  // The sidebar is only shown on asset pages, so the first user of the list loads it.
  if (!loaded && !loading.value) refresh().catch(() => undefined);
  return { assets, loading, error, refresh };
}
