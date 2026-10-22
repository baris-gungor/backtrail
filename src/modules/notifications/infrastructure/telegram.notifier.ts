import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UpstreamError } from '../../../common/errors/domain.error';
import { notificationsConfig } from '../../../config';
import type { Notifier } from '../domain/notifier.port';

const TIMEOUT_MS = 10_000;

/** Telegram Bot API `sendMessage` (plain text). */
@Injectable()
export class TelegramNotifier implements Notifier {
  readonly enabled: boolean;

  constructor(
    @Inject(notificationsConfig.KEY)
    private readonly cfg: ConfigType<typeof notificationsConfig>,
  ) {
    this.enabled = cfg.enabled;
  }

  async send(text: string): Promise<void> {
    const res = await fetch(
      `https://api.telegram.org/bot${this.cfg.telegramBotToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.cfg.telegramChatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      // The body is Telegram's JSON error ({ description }); the URL holds the token, so it is not logged.
      const body = (await res.json().catch(() => ({}))) as { description?: string };
      throw new UpstreamError(`Telegram ${res.status}: ${body.description ?? res.statusText}`);
    }
  }
}
