/**
 * Türkçe sözlük — ana kaynak.
 *
 * Yeni bir anahtar buraya eklenir; `en.ts` aynı anahtarları içermek zorundadır
 * (tip denetimi eksik çeviriyi derleme hatası yapar).
 *
 * Yer tutucular `{ad}` biçimindedir: t('key', { ad: 'Dünya' }).
 */
export const tr = {
  // ---------- ortak ----------
  'common.save': 'Kaydet',
  'common.cancel': 'Vazgeç',
  'common.close': 'Kapat',
  'common.delete': 'Sil',
  'common.remove': 'Kaldır',
  'common.add': 'Ekle',
  'common.edit': 'Düzenle',
  'common.retry': 'Yeniden dene',
  'common.refresh': 'Yenile',
  'common.copy': 'Kopyala',
  'common.copied': 'Kopyalandı',
  'common.reset': 'Varsayılana dön',
  'common.loading': 'Yükleniyor...',
  'common.error': 'Hata',
  'common.warning': 'Uyarı',
  'common.yes': 'Evet',
  'common.no': 'Hayır',
  'common.all': 'Tümü',
  'common.none': 'Hiçbiri',
  'common.open': 'Aç',
  'common.search': 'Ara',
  'common.back': 'Geri',
  'common.next': 'İleri',
  'common.done': 'Tamam',

  // ---------- pencere ----------
  'window.minimize': 'Küçült',
  'window.maximize': 'Büyüt',
  'window.restore': 'Geri yükle',
  'window.close': 'Kapat',

  // ---------- besteci ----------
  'composer.placeholder': 'Mesajınızı yazın...',
  'composer.placeholder.plan': 'Plan modu: incele, analiz et, plan çıkar...',
  'composer.placeholder.multiverse': 'Çoklu Evren için mesajınızı yazın...',
  'composer.placeholder.approval': 'Ajan onay bekliyor...',
  'composer.placeholder.steer': 'Araya girin: ajanın sıradaki adımında iletilir...',
  'composer.placeholder.queue': 'Yanıt sürerken yazabilirsiniz; mesaj sıraya alınır...',
  'composer.send': 'Gönder',
  'composer.stop': 'Durdur',
  'composer.steer': 'Araya gir',
  'composer.queue': 'Sıraya al',
  'composer.previousPrompt': 'Önceki istem (Alt+↑)',
  'composer.nextPrompt': 'Sonraki istem (Alt+↓)',
  'composer.steeringNotice': 'Mesajınız ajanın sıradaki adımında iletilecek.',
  'composer.queuedNotice': 'Yanıt sürüyor; mesaj sıraya alındı.',
  'composer.queueDropped': '{count} sıradaki istem iptal edildi.',
  'composer.commandWhileStreaming': 'Yanıt sürerken komut çalıştırılamaz.',
  'composer.steeringPending': '{count} mesaj ajanın sıradaki adımında iletilecek',
  'composer.removeFromQueue': 'Sıradan çıkar',
  'composer.attachRemove': 'Eki kaldır',
  'composer.contextMeter': 'bağlam: {percent}%',
  'composer.compacting': 'sıkıştırılıyor...',
  'composer.usage': '{input} girdi · {output} çıktı',
  'composer.finish': ' · bitiş: {reason}',

  // ---------- karşılama ----------
  'onboarding.title': 'EVREN Desktop',
  'brand.tagline': 'Savunma Sanayii Yapay Zeka Platformu',
  'onboarding.subtitle': 'Başlamak için API anahtarınızı girin',
  'onboarding.connect': "EVREN'e bağlan",
  'onboarding.description':
    'Resmi panelden aldığınız API anahtarını girin. Anahtar cihazınızda Windows DPAPI ile şifrelenerek saklanır ve yalnızca ana süreçte tutulur.',
  'onboarding.openPanel': 'API anahtarı almak için paneli aç ↗',
  'onboarding.show': 'Göster',
  'onboarding.hide': 'Gizle',
  'onboarding.encryptionUnavailable':
    'Bu sistemde güvenli saklama (DPAPI) kullanılamıyor; anahtar kalıcı olarak kaydedilemez.',
  'onboarding.validated': 'Doğrulandı — {count} model bulundu.',
  'onboarding.fineprint':
    'Anahtarınız bu uygulama dışında hiçbir yere gönderilmez; yalnızca evren-llmapi.ssyz.org.tr ile konuşur.',
  'onboarding.keyLabel': 'API anahtarı',
  'onboarding.keyPlaceholder': 'evren_...',
  'onboarding.submit': 'Doğrula ve devam et',
  'onboarding.validateAndSave': 'Doğrula ve kaydet',
  'onboarding.validating': 'Anahtar doğrulanıyor...',
  'onboarding.keyHint': 'Anahtarınızı evren.ssyz.org.tr/api-keys sayfasından alabilirsiniz.',
  'onboarding.securityNote':
    'Anahtar cihazınızda şifrelenerek saklanır ve yalnızca EVREN API çağrılarında kullanılır.',

  // ---------- güncelleme ----------
  'update.title': 'Güncellemeler',
  'update.checking': 'Denetleniyor...',
  'update.current': 'Sürüm {version} — güncel.',
  'update.available': 'Yeni sürüm: {version}',
  'update.downloading': 'İndiriliyor... {percent}%',
  'update.ready': 'Güncelleme hazır. Yeniden başlatınca kurulacak.',
  'update.check': 'Güncellemeleri denetle',
  'update.download': 'İndir',
  'update.install': 'Yeniden başlat ve kur',
  'update.note':
    'Güncellemeler GitHub Releases üzerinden alınır. Beta sürümler imzasızdır; Windows SmartScreen uyarısı gösterebilir.',
  'update.phase.disabled': 'Devre dışı',
  'update.phase.idle': 'Hazır',
  'update.phase.checking': 'Kontrol ediliyor...',
  'update.phase.available': 'Yeni sürüm var',
  'update.phase.notAvailable': 'Güncel',
  'update.phase.downloading': 'İndiriliyor...',
  'update.phase.downloaded': 'İndirildi',
  'update.phase.error': 'Hata',
  'update.statusLoading': 'Güncelleme durumu yükleniyor...',
  'update.checkShort': 'Güncelleme kontrol et',
  'update.downloadShort': 'Güncellemeyi indir',
  'update.downloaded': '{version} indirildi.',

  // ---------- terminal ----------
  'terminal.title': 'Terminal',
  'terminal.placeholder': 'Komut yazın ve Enter’a basın',
  'terminal.clear': 'Temizle',
  'terminal.running': 'Çalışıyor...',
  'terminal.exited': 'Süreç sona erdi (kod {code})',
  'terminal.notRunning': 'Terminal kapalı',
  'terminal.start': 'Başlat',
  'terminal.stop': 'Durdur',
  'terminal.cwd': 'Klasör: {path}',
  'terminal.restart': 'Yeniden başlat',
  'terminal.interrupt': 'Ctrl+C',
  'terminal.ready': 'Terminal hazır.',
  'terminal.inputPlaceholder': 'Komut yazıp Enter’a basın...',

  // ---------- ayarlar ----------
  'settings.title': 'Ayarlar',
  'settings.tab.general': 'Genel',
  'settings.tab.extensions': 'Uzantılar',
  'settings.tab.memory': 'Hafıza',
  'settings.tab.references': 'Referanslar',
  'settings.tab.github': 'GitHub',
  'settings.tab.scheduled': 'Görevler',
  'settings.tab.mcp': 'MCP',
  'settings.tab.api': 'API',
  'settings.connection': 'Bağlantı',
  'settings.serverUrl': 'Sunucu adresi',
  'settings.resetDefaultUrl': 'Varsayılana dön',
  'settings.appearance': 'Görünüm',
  'settings.theme.dark': 'Koyu',
  'settings.theme.light': 'Açık',
  'settings.theme.system': 'Sistem',
  'settings.theme.note': 'Sistem seçeneği Windows açık/koyu tema tercihini izler.',
  'settings.language': 'Dil',
  'settings.language.note': 'Arayüz dili. Değişiklik hemen uygulanır.',
  'settings.apiKey': 'API anahtarı',
  'settings.storedKey': 'Saklanan anahtar:',
  'settings.fromEnv': '(ortam değişkeninden)',
  'settings.newKey': 'Yeni anahtar (değiştirmek için)',
  'settings.deleteKey': 'Anahtarı sil',
  'settings.validateAndSave': 'Doğrula ve kaydet',
  'settings.logs': 'Günlükler',
  'settings.logs.note':
    'Hata ve başlatma kayıtları kullanıcı verisi klasöründeki logs dizininde tutulur. Dosya 5 MB’a ulaşınca döner; API anahtarı ve token gibi değerler yazılmadan önce maskelenir.',
  'settings.openLogFolder': 'Günlük klasörünü aç',

  // ---------- parametreler ----------
  'params.title': 'Parametreler',
  'params.temperature': 'Sıcaklık',
  'params.topP': 'Top-p',
  'params.maxTokens': 'En fazla token',
  'params.reasoningEffort': 'Akıl yürütme eforu',
  'params.thinking': 'Düşünme',
  'params.note': 'Boş bırakılan alanlar sunucu varsayılanını kullanır.'
} as const

export type TranslationKey = keyof typeof tr
