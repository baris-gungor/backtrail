<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import {
  darkTheme,
  NButton,
  NConfigProvider,
  NDialogProvider,
  NDrawer,
  NDrawerContent,
  NLayout,
  NLayoutHeader,
  NLayoutSider,
  NMenu,
  NMessageProvider,
  NTag,
  NTooltip,
  type GlobalThemeOverrides,
  type MenuOption,
} from 'naive-ui';
import AssetSidebar from './components/AssetSidebar.vue';
import KillSwitch from './components/KillSwitch.vue';
import { useIsMobile } from './composables/useIsMobile';
import { usePolling } from './composables/usePolling';
import { useI18n } from 'vue-i18n';
import { useLocale } from './composables/useLocale';
import { useTheme } from './composables/useTheme';

const route = useRoute();
// Dropdown items have a description line; the default 42px item height clips it.
const themeOverrides: GlobalThemeOverrides = { Menu: { itemHeight: '54px' } };
const { isDark, toggle } = useTheme();
const { t } = useI18n();
const { locale, naiveLocale, naiveDateLocale, setLocale } = useLocale();
const toggleLocale = () => setLocale(locale.value === 'tr' ? 'en' : 'tr');

const link = (to: string, label: string, description?: string) => () =>
  h(RouterLink, { to }, () =>
    description
      ? h('div', { class: 'menu-item' }, [
          h('div', label),
          h('div', { class: 'menu-desc' }, description),
        ])
      : label,
  );

// Computed so the labels follow the language switch.
const menu = computed<MenuOption[]>(() => [
  { key: 'overview', label: link('/overview', t('nav.overview')) },
  {
    key: 'market',
    label: t('nav.market'),
    children: [
      { key: 'asset', label: link('/assets', t('nav.assets'), t('nav.assetsDesc')) },
      { key: 'signals', label: link('/signals', t('nav.signals'), t('nav.signalsDesc')) },
    ],
  },
  {
    key: 'strategy',
    label: t('nav.strategy'),
    children: [
      {
        key: 'strategies',
        label: link('/strategies', t('nav.strategies'), t('nav.strategiesDesc')),
      },
      { key: 'backtests', label: link('/backtests', t('nav.backtests'), t('nav.backtestsDesc')) },
    ],
  },
  {
    key: 'trading',
    label: t('nav.trading'),
    children: [
      {
        key: 'portfolios',
        label: link('/portfolios', t('nav.portfolios'), t('nav.portfoliosDesc')),
      },
      { key: 'audit', label: link('/audit', t('nav.audit'), t('nav.auditDesc')) },
    ],
  },
  { key: 'reports', label: link('/reports', t('nav.reports')) },
]);
// Detail pages belong to their list's menu item.
const DETAIL_PARENTS: Record<string, string> = { backtest: 'backtests', portfolio: 'portfolios' };
const activeKey = computed(() => {
  const name = String(route.name ?? '');
  return DETAIL_PARENTS[name] ?? name;
});
// The asset list is only useful next to asset pages; other pages get the full width.
const showSider = computed(() => route.name === 'asset');

// Phones get a hamburger drawer instead of the horizontal menu, and the asset list moves into a drawer too.
const isMobile = useIsMobile();
const navOpen = ref(false);
const assetsOpen = ref(false);
const groupKeys = menu.value.filter((o) => o.children).map((o) => String(o.key));
watch(
  () => route.fullPath,
  () => {
    navOpen.value = false;
    assetsOpen.value = false;
  },
);

const health = ref<'up' | 'down' | 'unknown'>('unknown');
async function checkHealth(): Promise<void> {
  try {
    const res = await fetch('/api/health');
    health.value = res.ok ? 'up' : 'down';
  } catch {
    health.value = 'down';
  }
}
onMounted(checkHealth);
usePolling(checkHealth, 30_000);
const healthText = computed(() => t(`app.health.${health.value}`));
</script>

<template>
  <NConfigProvider
    :theme="isDark ? darkTheme : null"
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    abstract
  >
    <NMessageProvider>
      <NDialogProvider>
        <NLayout style="height: 100%">
          <NLayoutHeader bordered class="header">
            <NButton
              v-if="isMobile"
              quaternary
              size="small"
              :aria-label="t('app.menu')"
              class="burger"
              @click="navOpen = true"
            >
              ☰
            </NButton>
            <RouterLink to="/overview" class="logo">backtrail</RouterLink>
            <NMenu
              v-if="!isMobile"
              mode="horizontal"
              :options="menu"
              :value="activeKey"
              responsive
              class="menu"
            />
            <div v-else class="menu" />
            <KillSwitch />
            <template v-if="!isMobile">
              <NTooltip>
                <template #trigger>
                  <NTag
                    :type="health === 'up' ? 'success' : health === 'down' ? 'error' : 'default'"
                    size="small"
                    :bordered="false"
                  >
                    API
                  </NTag>
                </template>
                Backend {{ healthText }}
              </NTooltip>
              <a href="/api/docs" target="_blank" class="small">Swagger</a>
            </template>
            <NTooltip>
              <template #trigger>
                <NButton
                  quaternary
                  size="small"
                  :aria-label="t('app.language')"
                  class="lang"
                  @click="toggleLocale"
                >
                  {{ locale === 'tr' ? 'EN' : 'TR' }}
                </NButton>
              </template>
              {{ t('app.switchLanguage') }}
            </NTooltip>
            <NTooltip>
              <template #trigger>
                <NButton
                  quaternary
                  circle
                  size="small"
                  :aria-label="t('app.theme')"
                  @click="toggle"
                >
                  {{ isDark ? '☀' : '☾' }}
                </NButton>
              </template>
              {{ isDark ? t('app.lightTheme') : t('app.darkTheme') }}
            </NTooltip>
          </NLayoutHeader>
          <NLayout has-sider style="height: calc(100% - 56px)">
            <NLayoutSider
              v-if="showSider && !isMobile"
              bordered
              :width="260"
              content-style="padding: 12px"
            >
              <AssetSidebar />
            </NLayoutSider>
            <NLayout
              :content-style="isMobile ? 'padding: 12px 12px 32px' : 'padding: 20px 24px 40px'"
            >
              <div class="content">
                <NButton
                  v-if="showSider && isMobile"
                  size="small"
                  class="assets-btn"
                  @click="assetsOpen = true"
                >
                  ☰ {{ t('app.assetList') }}
                </NButton>
                <RouterView />
              </div>
            </NLayout>
          </NLayout>
        </NLayout>

        <NDrawer v-if="isMobile" v-model:show="navOpen" placement="left" :width="290">
          <NDrawerContent title="backtrail" closable :body-content-style="{ padding: '4px 0' }">
            <NMenu
              class="drawer-menu"
              :options="menu"
              :value="activeKey"
              :default-expanded-keys="groupKeys"
            />
            <template #footer>
              <div class="hstack between" style="width: 100%">
                <NTag
                  :type="health === 'up' ? 'success' : health === 'down' ? 'error' : 'default'"
                  size="small"
                  :bordered="false"
                >
                  API {{ health === 'unknown' ? '…' : healthText }}
                </NTag>
                <a href="/api/docs" target="_blank" class="small">Swagger</a>
              </div>
            </template>
          </NDrawerContent>
        </NDrawer>
        <NDrawer v-if="isMobile" v-model:show="assetsOpen" placement="left" width="85%">
          <NDrawerContent :title="t('nav.assets')" closable>
            <AssetSidebar />
          </NDrawerContent>
        </NDrawer>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.header {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}
.logo {
  font-weight: 700;
  white-space: nowrap;
  color: inherit;
  text-decoration: none;
}
.menu {
  flex: 1;
  min-width: 0;
}
.small {
  font-size: 13px;
  white-space: nowrap;
}
.content {
  max-width: 1440px;
  margin: 0 auto;
}
.lang {
  font-size: 12px;
  font-weight: 600;
  padding: 0 6px;
}
.burger {
  font-size: 18px;
  margin-left: -6px;
}
.assets-btn {
  margin-bottom: 12px;
}
@media (max-width: 768px) {
  .header {
    gap: 8px;
    padding: 0 10px;
  }
}
</style>
