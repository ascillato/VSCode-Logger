/* eslint-disable spellcheck/spell-checker */
import { createLocalizationBundle } from './factory';

export const tr = createLocalizationBundle(
  'tr',
  'tr',
  {
    vscode: 'VSCode varsayılanı',
    en: 'İngilizce',
    es: 'İspanyolca',
    it: 'İtalyanca',
    'zh-cn': 'Basitleştirilmiş Çince',
    'zh-tw': 'Geleneksel Çince',
    fr: 'Fransızca',
    de: 'Almanca',
    ja: 'Japonca',
    ko: 'Korece',
    ru: 'Rusça',
    'pt-br': 'Portekizce (Brezilya)',
    tr: 'Türkçe',
    pl: 'Lehçe',
    cs: 'Çekçe',
    hu: 'Macarca',
  },
  {
    common: {
      add: 'Ekle',
      cancel: 'İptal',
      close: 'Kapat',
      command: 'Komut',
      copy: 'Kopyala',
      default: 'Varsayılan',
      disabled: 'Devre dışı',
      enabled: 'Etkin',
      exportSettings: 'Ayarları dışa aktar',
      importSettings: 'Ayarları içe aktar',
      name: 'Ad',
      none: 'Yok',
      remove: 'Kaldır',
      save: 'Kaydet',
      select: 'Seç',
    },
    deviceManager: {
      panelTitle: 'Gömülü Cihazlar Yöneticisi',
      intro: 'Cihazları ve varsayılan yapılandırmayı yönetin.',
      language: 'Eklenti dili',
    },
  }
);
