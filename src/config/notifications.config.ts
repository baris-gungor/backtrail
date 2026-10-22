import { registerAs } from '@nestjs/config';

export interface NotificationsConfig {
  telegramBotToken: string;
  telegramChatId: string;
  /** Both values are set. Without them notifications are dropped silently. */
  enabled: boolean;
  /** Language of the notification texts (`NOTIFY_LOCALE`). */
  locale: 'tr' | 'en';
}

export const notificationsConfig = registerAs('notifications', (): NotificationsConfig => {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const telegramChatId = process.env.TELEGRAM_CHAT_ID ?? '';
  return {
    telegramBotToken,
    telegramChatId,
    enabled: telegramBotToken !== '' && telegramChatId !== '',
    locale: process.env.NOTIFY_LOCALE === 'en' ? 'en' : 'tr',
  };
});
