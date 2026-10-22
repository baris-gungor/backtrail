/**
 * Notification texts in Turkish or English (`NOTIFY_LOCALE`), plain text: no Telegram markup, so
 * nothing needs escaping. Callers pass plain data, so this module needs no other module's types.
 */

export type NotifyLocale = 'tr' | 'en';

/** Times are shown in the user's zone (the UI shows browser-local time; the user is in Turkey). */
const TIME_ZONE = 'Europe/Istanbul';

const TIME_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "09.10 23:30". Built from parts: separators of locale formats differ between ICU builds. */
export function fmtTime(at: Date): string {
  const p = Object.fromEntries(TIME_PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}

export type Side = 'BUY' | 'SELL';

export interface SignalNote {
  side: Side;
  /** Strategy code; shown as a short localized name. */
  strategy: string;
  config: string;
  price: number;
}

export interface FillNote {
  side: Side;
  quantity: string;
  price: number | string;
  source: string;
  at: Date;
}

export interface HaltNote {
  /** Null for the global kill switch. */
  portfolio: string | null;
  reason?: string | null;
  actor: 'user' | 'system';
}

export interface HealthNote {
  portfolio: string;
  symbol: string;
  /** Strategy code and config name. */
  strategy: string;
  config: string;
  level: 'ok' | 'info' | 'warning' | 'unknown';
  /** Messages of the checks that are not ok. */
  findings: string[];
}

/** At most this many fill lines per message; a catch-up run can fill more. */
export const MAX_FILL_LINES = 10;

interface Dictionary {
  numberLocale: string;
  side: Record<Side, string>;
  /** Short strategy names by code; unknown codes are shown as is. */
  strategies: Record<string, string>;
  source: Record<string, string>;
  newSignals: (n: number) => string;
  filled: (n: number) => string;
  earlier: (n: number) => string;
  haltAll: string;
  haltPortfolio: (name: string) => string;
  reason: string;
  bySystem: string;
  byUser: string;
  resumeAll: string;
  resumePortfolio: (name: string) => string;
  healthWarning: string;
  healthRecovered: string;
  test: string;
}

const DICTIONARIES: Record<NotifyLocale, Dictionary> = {
  tr: {
    numberLocale: 'tr-TR',
    side: { BUY: '🟢 AL', SELL: '🔴 SAT' },
    strategies: {
      trend_ema_adx: 'Trend',
      meanrev_bb_rsi: 'Ortalamaya dönüş',
      momentum_macd_rsi_vol: 'Momentum',
      breakout_donchian_atr: 'Kırılım',
      pullback_supertrend_rsi: 'Geri çekilme',
      buy_and_hold: 'Al ve tut',
    },
    source: { signal: 'strateji', manual: 'manuel', stop_loss: 'stop', take_profit: 'hedef' },
    newSignals: (n) => `${n} yeni sinyal`,
    filled: (n) => `${n} emir doldu`,
    earlier: (n) => `(+${n} önceki)`,
    haltAll: 'TÜM İŞLEMLER DURDURULDU',
    haltPortfolio: (name) => `Portföy durduruldu: ${name}`,
    reason: 'Sebep',
    bySystem: 'Sistem tarafından (otomatik)',
    byUser: 'Kullanıcı tarafından',
    resumeAll: 'İşlemler yeniden açıldı',
    resumePortfolio: (name) => `Portföy yeniden açıldı: ${name}`,
    healthWarning: 'Strateji sağlığı',
    healthRecovered: 'Strateji sağlığı düzeldi',
    test: 'backtrail bildirim testi: bağlantı çalışıyor.',
  },
  en: {
    numberLocale: 'en-US',
    side: { BUY: '🟢 BUY', SELL: '🔴 SELL' },
    strategies: {
      trend_ema_adx: 'Trend',
      meanrev_bb_rsi: 'Mean reversion',
      momentum_macd_rsi_vol: 'Momentum',
      breakout_donchian_atr: 'Breakout',
      pullback_supertrend_rsi: 'Pullback',
      buy_and_hold: 'Buy and hold',
    },
    source: { signal: 'strategy', manual: 'manual', stop_loss: 'stop', take_profit: 'target' },
    newSignals: (n) => `${n} new ${n === 1 ? 'signal' : 'signals'}`,
    filled: (n) => `${n} ${n === 1 ? 'order' : 'orders'} filled`,
    earlier: (n) => `(+${n} earlier)`,
    haltAll: 'ALL TRADING HALTED',
    haltPortfolio: (name) => `Portfolio halted: ${name}`,
    reason: 'Reason',
    bySystem: 'By the system (automatic)',
    byUser: 'By the user',
    resumeAll: 'Trading resumed',
    resumePortfolio: (name) => `Portfolio resumed: ${name}`,
    healthWarning: 'Strategy health',
    healthRecovered: 'Strategy health recovered',
    test: 'backtrail notification test: the connection works.',
  },
};

/** The notification texts of one locale. */
export function messagesFor(locale: NotifyLocale) {
  const d = DICTIONARIES[locale];
  const num = (value: number | string, digits = 2) =>
    Number(value).toLocaleString(d.numberLocale, { maximumFractionDigits: digits });
  const strategy = (code: string, config: string) =>
    `${d.strategies[code] ?? code}${config === 'default' ? '' : ` (${config})`}`;

  return {
    signalsMessage(symbol: string, barTime: Date, signals: SignalNote[]): string {
      const lines = signals.map(
        (s) => `${d.side[s.side]} · ${strategy(s.strategy, s.config)} @ ${num(s.price)}`,
      );
      return [
        `📈 ${symbol}: ${d.newSignals(signals.length)}`,
        ...lines,
        `4h bar: ${fmtTime(barTime)}`,
      ].join('\n');
    },

    fillsMessage(portfolio: string, symbol: string, fills: FillNote[]): string {
      const shown = fills.slice(-MAX_FILL_LINES);
      const lines = shown.map(
        (f) =>
          `${d.side[f.side]} ${num(f.quantity, 4)} @ ${num(f.price)} · ${d.source[f.source] ?? f.source} · ${fmtTime(f.at)}`,
      );
      const hidden = fills.length - shown.length;
      return [
        `💼 ${portfolio} · ${symbol}: ${d.filled(fills.length)}`,
        ...(hidden > 0 ? [d.earlier(hidden)] : []),
        ...lines,
      ].join('\n');
    },

    haltMessage(h: HaltNote): string {
      return [
        `⛔ ${h.portfolio ? d.haltPortfolio(h.portfolio) : d.haltAll}`,
        ...(h.reason ? [`${d.reason}: ${h.reason}`] : []),
        h.actor === 'system' ? d.bySystem : d.byUser,
      ].join('\n');
    },

    resumeMessage(portfolio: string | null): string {
      return `▶️ ${portfolio ? d.resumePortfolio(portfolio) : d.resumeAll}`;
    },

    /** Sent when a subscription turns to warning, or back to ok after a warning. */
    healthMessage(h: HealthNote): string {
      const head = `${h.level === 'warning' ? `⚠️ ${d.healthWarning}` : `✅ ${d.healthRecovered}`}: ${h.portfolio} · ${h.symbol} · ${strategy(h.strategy, h.config)}`;
      return [head, ...h.findings.map((f) => `• ${f}`)].join('\n');
    },

    testMessage(): string {
      return `✅ ${d.test}`;
    },
  };
}

export type NotificationTexts = ReturnType<typeof messagesFor>;
