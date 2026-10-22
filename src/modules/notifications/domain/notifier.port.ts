/** Delivers a plain-text message to the user (Telegram today). */
export interface Notifier {
  /** False when the channel is not configured; messages are then dropped. */
  readonly enabled: boolean;
  send(text: string): Promise<void>;
}

export const NOTIFIER = Symbol('NOTIFIER');
