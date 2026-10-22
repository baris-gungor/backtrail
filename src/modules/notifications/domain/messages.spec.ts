import { MAX_FILL_LINES, messagesFor, type FillNote } from './messages';

const at = new Date('2026-10-09T20:30:00Z'); // 23:30 in Istanbul
const tr = messagesFor('tr');
const en = messagesFor('en');

describe('notification messages', () => {
  it('lists signals with side, strategy and price in Istanbul time', () => {
    const signals = [
      { side: 'BUY' as const, strategy: 'trend_ema_adx', config: 'default', price: 228.4 },
      { side: 'SELL' as const, strategy: 'breakout_donchian_atr', config: 'fast', price: 1234.5 },
    ];
    expect(tr.signalsMessage('AAPL', at, signals)).toBe(
      [
        '📈 AAPL: 2 yeni sinyal',
        '🟢 AL · Trend @ 228,4',
        '🔴 SAT · Kırılım (fast) @ 1.234,5',
        '4h bar: 09.10 23:30',
      ].join('\n'),
    );
    expect(en.signalsMessage('AAPL', at, signals)).toBe(
      [
        '📈 AAPL: 2 new signals',
        '🟢 BUY · Trend @ 228.4',
        '🔴 SELL · Breakout (fast) @ 1,234.5',
        '4h bar: 09.10 23:30',
      ].join('\n'),
    );
  });

  it('shows unknown strategy codes as they are', () => {
    const text = en.signalsMessage('AAPL', at, [
      { side: 'BUY', strategy: 'new_one', config: 'default', price: 1 },
    ]);
    expect(text.split('\n')[1]).toBe('🟢 BUY · new_one @ 1');
  });

  it('keeps only the latest fills and says how many were left out', () => {
    const fill: FillNote = { side: 'BUY', quantity: '1.5', price: '10', source: 'signal', at };
    const fills = Array.from({ length: MAX_FILL_LINES + 2 }, () => fill);
    const lines = tr.fillsMessage('Deneme', 'GC=F', fills).split('\n');
    expect(lines[0]).toBe(`💼 Deneme · GC=F: ${MAX_FILL_LINES + 2} emir doldu`);
    expect(lines[1]).toBe('(+2 önceki)');
    expect(lines).toHaveLength(MAX_FILL_LINES + 2);
    expect(lines[2]).toBe('🟢 AL 1,5 @ 10 · strateji · 09.10 23:30');

    const english = en.fillsMessage('Demo', 'GC=F', fills).split('\n');
    expect(english[0]).toBe(`💼 Demo · GC=F: ${MAX_FILL_LINES + 2} orders filled`);
    expect(english[1]).toBe('(+2 earlier)');
    expect(english[2]).toBe('🟢 BUY 1.5 @ 10 · strategy · 09.10 23:30');
  });

  it('describes global and portfolio halts', () => {
    expect(tr.haltMessage({ portfolio: null, reason: 'test', actor: 'user' })).toBe(
      '⛔ TÜM İŞLEMLER DURDURULDU\nSebep: test\nKullanıcı tarafından',
    );
    expect(tr.haltMessage({ portfolio: 'Demo', actor: 'system' })).toBe(
      '⛔ Portföy durduruldu: Demo\nSistem tarafından (otomatik)',
    );
    expect(tr.resumeMessage(null)).toBe('▶️ İşlemler yeniden açıldı');
    expect(en.haltMessage({ portfolio: null, reason: 'news', actor: 'user' })).toBe(
      '⛔ ALL TRADING HALTED\nReason: news\nBy the user',
    );
    expect(en.resumeMessage('Demo')).toBe('▶️ Portfolio resumed: Demo');
  });

  it('names the subscription in health messages', () => {
    const note = {
      portfolio: 'Demo',
      symbol: 'AAPL',
      strategy: 'meanrev_bb_rsi',
      config: 'tight',
      level: 'warning' as const,
      findings: ['5 losses in a row'],
    };
    expect(tr.healthMessage(note)).toBe(
      '⚠️ Strateji sağlığı: Demo · AAPL · Ortalamaya dönüş (tight)\n• 5 losses in a row',
    );
    expect(en.healthMessage({ ...note, level: 'ok', findings: [] })).toBe(
      '✅ Strategy health recovered: Demo · AAPL · Mean reversion (tight)',
    );
  });
});
