/* eslint-disable spellcheck/spell-checker */
import { createLocalizationBundle } from './factory';

export const pl = createLocalizationBundle(
  'pl',
  'pl',
  {
    vscode: 'Domyślny VSCode',
    en: 'Angielski',
    es: 'Hiszpański',
    it: 'Włoski',
    'zh-cn': 'Chiński uproszczony',
    'zh-tw': 'Chiński tradycyjny',
    fr: 'Francuski',
    de: 'Niemiecki',
    ja: 'Japoński',
    ko: 'Koreański',
    ru: 'Rosyjski',
    'pt-br': 'Portugalski (Brazylia)',
    tr: 'Turecki',
    pl: 'Polski',
    cs: 'Czeski',
    hu: 'Węgierski',
  },
  {
    common: {
      add: 'Dodaj',
      cancel: 'Anuluj',
      close: 'Zamknij',
      command: 'Polecenie',
      copy: 'Kopiuj',
      default: 'Domyślne',
      disabled: 'Wyłączone',
      enabled: 'Włączone',
      exportSettings: 'Eksportuj ustawienia',
      importSettings: 'Importuj ustawienia',
      name: 'Nazwa',
      none: 'Brak',
      remove: 'Usuń',
      save: 'Zapisz',
      select: 'Wybierz',
    },
    deviceManager: {
      panelTitle: 'Menedżer urządzeń wbudowanych',
      intro: 'Zarządzaj urządzeniami i konfiguracją domyślną.',
      language: 'Język rozszerzenia',
    },
  }
);
