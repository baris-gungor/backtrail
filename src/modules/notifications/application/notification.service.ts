import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ConflictError } from '../../../common/errors/domain.error';
import { notificationsConfig } from '../../../config';
import { messagesFor, type NotificationTexts } from '../domain/messages';
import { NOTIFIER, type Notifier } from '../domain/notifier.port';

/**
 * Sends user notifications. `notify` never waits for delivery and never throws:
 * a failed message is logged and dropped, the action that caused it is not affected.
 */
@Injectable()
export class NotificationService implements OnApplicationShutdown {
  private readonly logger = new Logger(NotificationService.name);
  private readonly pending = new Set<Promise<void>>();

  /** Message texts in the configured `NOTIFY_LOCALE`. */
  readonly texts: NotificationTexts;

  constructor(
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(notificationsConfig.KEY) cfg: ConfigType<typeof notificationsConfig>,
  ) {
    this.texts = messagesFor(cfg.locale);
  }

  get enabled(): boolean {
    return this.notifier.enabled;
  }

  notify(text: string): void {
    if (!this.notifier.enabled) return;
    const task = this.notifier
      .send(text)
      .catch((error: unknown) => this.logger.warn({ msg: 'Notification failed', err: error }))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** Sends a message and waits for it; for checking the setup. */
  async sendTest(): Promise<void> {
    if (!this.notifier.enabled) {
      throw new ConflictError(
        'Notifications are not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)',
      );
    }
    await this.notifier.send(this.texts.testMessage());
  }

  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  onApplicationShutdown(): Promise<void> {
    return this.whenIdle();
  }
}
