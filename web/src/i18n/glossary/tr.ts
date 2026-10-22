import type { GlossaryEntry } from '../../glossary';

/** Turkish glossary: the source of truth for the term keys. */
const glossary = {
  totalReturn: {
    title: 'Toplam getiri',
    text: 'Dönem başından sonuna sermayedeki yüzde değişim (ücret ve slippage düşülmüş).',
  },
  cagr: {
    title: 'CAGR (yıllık bileşik getiri)',
    text: 'Toplam getirinin yıllık ortalamaya çevrilmiş hali. Farklı uzunluktaki dönemleri karşılaştırmayı sağlar.',
  },
  alpha: {
    title: 'Alpha',
    text: "Stratejinin CAGR'ı ile aynı dönemde al ve tut CAGR'ı arasındaki fark. Pozitifse strateji pasif yatırımı geçmiş demektir.",
    scale: ['> 0 iyi', '−%5–0 orta', '< −%5 zayıf'],
  },
  sharpe: {
    title: 'Sharpe oranı',
    text: 'Alınan risk başına getiri: yıllık getirinin oynaklığa oranı. Yüksek olması daha iyi.',
    scale: ['> 1 iyi', '0–1 orta', '< 0 zayıf'],
  },
  sortino: {
    title: 'Sortino oranı',
    text: "Sharpe'a benzer, ama yalnızca aşağı yönlü oynaklığı risk sayar. Yukarı sıçramalar cezalandırılmaz.",
    scale: ['> 1,5 iyi', '0–1,5 orta', '< 0 zayıf'],
  },
  calmar: {
    title: 'Calmar oranı',
    text: 'Yıllık getirinin (CAGR) en büyük düşüşe oranı. Getiri için ne kadar derin bir kayba katlanıldığını gösterir.',
    scale: ['> 1 iyi', '0,3–1 orta', '< 0,3 zayıf'],
  },
  maxDrawdown: {
    title: 'Max düşüş (drawdown)',
    text: 'Sermayenin bir zirveden sonraki en büyük yüzde kaybı. Küçük olması daha iyi.',
    scale: ['< %10 iyi', '%10–25 orta', '> %25 zayıf'],
  },
  volatility: {
    title: 'Volatilite',
    text: 'Getirilerin yıllık oynaklığı (standart sapma). Yüksekse sermaye eğrisi daha dalgalı.',
  },
  ulcer: {
    title: 'Ulcer index',
    text: 'Düşüşlerin hem derinliğini hem süresini ölçer. Küçük olması daha iyi.',
  },
  trades: {
    title: 'İşlem sayısı',
    text: "Kapanan işlem sayısı. 10'dan azsa sonuçlar şansa çok bağlı olabilir.",
  },
  winRate: {
    title: 'Kazanma oranı',
    text: 'Kârla kapanan işlemlerin oranı. Tek başına yeterli değil: az kazanıp çok kaybeden bir strateji yüksek oranla da zarar edebilir.',
  },
  profitFactor: {
    title: 'Profit factor',
    text: "Toplam kârın toplam zarara oranı. 1'in üstü kârlı demek.",
    scale: ['> 1,5 iyi', '1–1,5 orta', '< 1 zayıf'],
  },
  payoff: {
    title: 'Payoff',
    text: 'Ortalama kazancın ortalama kayba oranı.',
  },
  expectancy: {
    title: 'Expectancy (beklenen kazanç)',
    text: 'İşlem başına ortalama kâr/zarar, para birimi cinsinden.',
  },
  exposure: {
    title: 'Exposure (piyasada kalma)',
    text: 'Pozisyon açık geçen sürenin dönem içindeki oranı. Düşükse sermaye çoğunlukla nakitte durmuş.',
  },
  fees: {
    title: 'Ücretler',
    text: 'İşlemlerde ödenen toplam komisyon (ücret bps ayarından).',
  },
  benchmark: {
    title: 'Al ve tut (benchmark)',
    text: 'Aynı dönemde ilk barda alıp hiç satmamanın sonucu, ücretsiz. Stratejinin pasif yatırımı geçip geçmediğine bakılır.',
  },
  segment: {
    title: 'Dönem (tüm / eğitim / test)',
    text: 'Parametre taramasında veri ikiye bölünür: parametreler eğitim kısmında seçilir, test kısmı daha önce görülmemiş veride sonucu doğrular.',
  },
  sweep: {
    title: 'Parametre taraması',
    text: 'Bir stratejinin parametre kombinasyonlarını eğitim döneminde dener, en iyileri test döneminde tekrar çalıştırır.',
  },
  health: {
    title: 'Strateji sağlığı',
    text: "Aboneliğin kapanan işlemleri, aynı varlık ve parametre setinin son tam dönem backtest'iyle karşılaştırılır: düşüş backtest'inkinin 1,5 katını aşarsa, kayıp serisi backtest'in kazanma oranına göre çok olasılıksızsa (%5'ten az) veya 10+ işlemde kazanma oranı beklenen aralığın altındaysa uyarı verir. Uzun süre işlem olmaması yalnızca bilgidir. Karşılaştırılacak backtest yoksa sağlık bilinmiyor görünür.",
  },
  earnings: {
    title: 'Bilanço filtresi',
    text: 'Hisseler bilanço açıklamasından sonraki açılışta sık sık büyük boşluk (gap) yapar; stop bu boşlukta işe yaramaz. Açıkken pozisyon açıklamadan önceki son fırsatta kapatılır ve o aralıkta yeni giriş yapılmaz; istenirse giriş yasağı birkaç gün öne uzatılır. Tarihler SEC kayıtlarından (8-K madde 2.02) ve Yahoo takviminden gelir; ETF ve vadelilerde etkisi yoktur.',
  },
  short: {
    title: 'Short (açığa satış)',
    text: 'Fiyatın düşüşünden kazanmak için ödünç alınan varlığı satıp sonra geri almak. Stop girişin üstünde, hedef altındadır; fiyat yükselirse zarar büyür. Yalnızca short kuralı olan stratejiler (Trend, Kırılım) short açar. Açığa satış geliri yeni pozisyonları finanse etmez (kaldıraç yok). Borç maliyeti yıllık yüzde olarak giriş tutarına, tutulan süreyle orantılı eklenir. Kayıtlı sinyaller yalnızca long olduğu için short abonelikler strateji kurallarıyla çalışır.',
  },
  monteCarlo: {
    title: 'Monte Carlo (şans testi)',
    text: 'Koşunun işlemleri rastgele yeniden örneklenip (aynı işlem birden çok kez gelebilir) binlerce alternatif geçmiş üretilir. Geniş aralık ve yüksek zarar olasılığı, sonucun birkaç şanslı işleme bağlı olduğunu gösterir. Düşüşler işlem kapanışlarına göre ölçülür, bu yüzden bar bazlı max düşüşten küçüktür.',
  },
  proxy: {
    title: 'Emtia ETF proxy',
    text: "Vadeli kontrat (ör. GC=F altın) yerine onu izleyen ABD ETF'i (ör. GLD). Alpaca vadeli işlem yapmaz; ETF hem işlem görür hem de kontrat devrindeki (roll) fiyat sıçramalarını içermez. ETF ABD seansında işlem gördüğü için 4 saatlik barları vadeliden farklıdır.",
  },
  rollAdjust: {
    title: 'Roll düzeltmesi',
    text: "Sürekli vadeli serilerde kontrat devri günlerinde sahte fiyat sıçramaları olur (3 ATR'den büyük, hafta içi). Açıkken bu noktalardan önceki fiyatlar oranla ölçeklenir, sıçrama kalkar; getiriler korunur ama eski fiyat seviyeleri artık gerçek fiyat değildir. Hisse ve ETF'lerde gerek yoktur.",
  },
  walkForward: {
    title: 'Walk-forward analizi',
    text: 'Veri ardışık pencerelere bölünür. Her pencerede parametreler eğitim kısmında seçilir ve hemen sonraki, görülmemiş test kısmında denenir. Test kısımları uç uca eklenince stratejinin "parametreleri düzenli yeniden seçilseydi" gerçekçi sonucu çıkar.',
  },
  oos: {
    title: 'Out-of-sample (OOS)',
    text: 'Parametre seçiminde kullanılmamış veri üzerindeki sonuç. Eğitim sonucundan belirgin kötüyse strateji geçmişe aşırı uymuş (overfitting) olabilir.',
  },
  wfe: {
    title: 'Walk-forward verimliliği (WFE)',
    text: "Test dönemlerinin birleşik yıllık getirisinin (OOS CAGR) eğitim dönemlerinin ortalama yıllık getirisine oranı. 1'e yakınsa eğitimdeki başarı görülmemiş veride de sürmüş demektir.",
    scale: ['> 0,5 iyi', '0–0,5 orta', '< 0 zayıf'],
  },
  anchored: {
    title: 'Sabit başlangıçlı (anchored)',
    text: 'Açıksa her pencerenin eğitim kısmı verinin başından başlar ve giderek uzar. Kapalıysa (rolling) eğitim kısmı sabit uzunlukta kayar; piyasa değişimlerine daha hızlı uyar.',
  },
  profitableWindows: {
    title: 'Kârlı pencere oranı',
    text: 'Test kısımlarından kaçında getiri pozitif oldu. Sonucun tek bir şanslı döneme bağlı olup olmadığını gösterir.',
    scale: ['> %60 iyi', '%40–60 orta', '< %40 zayıf'],
  },
  bps: {
    title: 'bps (baz puan)',
    text: '1 bps = %0,01. 5 bps ücret, 10.000 $ işlemde 5 $ demek.',
  },
  slippage: {
    title: 'Slippage',
    text: 'Emrin beklenen fiyattan biraz kötü dolması. Backtest ve simülasyonda her dolumdan düşülür.',
  },
  stopLoss: {
    title: 'Stop-loss',
    text: 'Fiyat bu seviyeye düşerse pozisyon zararı sınırlamak için kapatılır.',
  },
  takeProfit: {
    title: 'Take-profit (hedef)',
    text: 'Fiyat bu seviyeye çıkarsa pozisyon kârla kapatılır.',
  },
  source: {
    title: 'Abonelik kaynağı',
    text: 'strategy: strateji kuralları her yeni barda çalıştırılır, sonuçlar backtest ile birebir aynı olur. signals: yalnızca kayıtlı sinyaller (aktif config) takip edilir.',
  },
  signalHit: {
    title: 'Sinyal isabeti',
    text: 'Sinyalden N bar sonra fiyat beklenen yönde mi (AL sonrası yukarı, SAT sonrası aşağı)?',
  },
  correlation: {
    title: 'Korelasyon',
    text: 'İki stratejinin getirilerinin birlikte hareket etme derecesi (−1 ile 1 arası). Düşük korelasyon çeşitlendirme sağlar.',
  },
  divergence: {
    title: 'Backtest vs paper',
    text: 'Aynı barlarda koşulan backtest ile portföyün gerçek sonucu arasındaki fark. strategy kaynaklı aboneliklerde 0 olmalı.',
  },
  paper: {
    title: 'Simülasyon (paper)',
    text: 'Emirler sanal parayla, sistemin kendi dolum kurallarıyla gerçekleşir. Gerçek para kullanılmaz.',
  },
  alpacaPaper: {
    title: 'Alpaca demo',
    text: "Emirler Alpaca'nın demo (paper) hesabına gider: gerçek broker, sahte para.",
  },
  killSwitch: {
    title: 'Kill switch',
    text: 'Tüm otomatik işlemi tek tuşla durdurur. Manuel alımlar reddedilir, satış ve pozisyon kapatma serbest kalır.',
  },
  reconciliation: {
    title: 'Reconciliation (mutabakat)',
    text: 'Broker hesabındaki pozisyon ve nakdin veritabanıyla karşılaştırılması. Fark çıkarsa portföy durur.',
  },
  equity: {
    title: 'Equity',
    text: 'Nakit + açık pozisyonların güncel değeri.',
  },
  realizedPnl: {
    title: 'Gerçekleşen kâr/zarar',
    text: 'Kapanmış işlemlerden gelen kâr/zarar. Açık pozisyonların kâğıt üzerindeki kârı dahil değil.',
  },
} satisfies Record<string, GlossaryEntry>;

export default glossary;
export type GlossaryKey = keyof typeof glossary;
