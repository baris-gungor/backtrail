import { useDialog, useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api, call, errorMessage } from '../api/client';

/** Asks for confirmation, then deletes a portfolio with its history and calls `onDeleted`. */
export function useDeletePortfolio(onDeleted: () => Promise<unknown> | void) {
  const dialog = useDialog();
  const message = useMessage();
  const { t } = useI18n();

  return function confirmDelete(portfolio: { id: string; name: string; mode: string }): void {
    const alpaca = portfolio.mode === 'alpaca_paper';
    dialog.warning({
      title: t('portfolios.delete.title', { name: portfolio.name }),
      content: alpaca ? t('portfolios.delete.textAlpaca') : t('portfolios.delete.text'),
      positiveText: t('common.delete'),
      negativeText: t('common.cancel'),
      onPositiveClick: async () => {
        try {
          await call(
            api.DELETE('/api/portfolios/{id}', { params: { path: { id: portfolio.id } } }),
          );
          message.success(t('portfolios.delete.done', { name: portfolio.name }));
          await onDeleted();
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });
  };
}
