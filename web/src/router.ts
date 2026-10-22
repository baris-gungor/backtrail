import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/overview' },
    { path: '/overview', name: 'overview', component: () => import('./views/OverviewView.vue') },
    {
      path: '/assets/:symbol?',
      name: 'asset',
      component: () => import('./views/AssetView.vue'),
      props: true,
    },
    { path: '/signals', name: 'signals', component: () => import('./views/SignalsView.vue') },
    {
      path: '/strategies',
      name: 'strategies',
      component: () => import('./views/StrategiesView.vue'),
    },
    { path: '/backtests', name: 'backtests', component: () => import('./views/BacktestsView.vue') },
    {
      path: '/backtests/:id',
      name: 'backtest',
      component: () => import('./views/BacktestDetailView.vue'),
      props: true,
    },
    {
      path: '/portfolios',
      name: 'portfolios',
      component: () => import('./views/PortfoliosView.vue'),
    },
    {
      path: '/portfolios/:id',
      name: 'portfolio',
      component: () => import('./views/PortfolioDetailView.vue'),
      props: true,
    },
    { path: '/reports', name: 'reports', component: () => import('./views/ReportsView.vue') },
    { path: '/audit', name: 'audit', component: () => import('./views/AuditView.vue') },
  ],
});
