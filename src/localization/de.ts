/* eslint-disable spellcheck/spell-checker */
import { createLocalizationBundle } from './factory';

export const de = createLocalizationBundle(
  'de',
  'de',
  {
    vscode: 'VSCode-Standard',
    en: 'Englisch',
    es: 'Spanisch',
    it: 'Italienisch',
    'zh-cn': 'Vereinfachtes Chinesisch',
    'zh-tw': 'Traditionelles Chinesisch',
    fr: 'Französisch',
    de: 'Deutsch',
    ja: 'Japanisch',
    ko: 'Koreanisch',
    ru: 'Russisch',
    'pt-br': 'Portugiesisch (Brasilien)',
    tr: 'Türkisch',
    pl: 'Polnisch',
    cs: 'Tschechisch',
    hu: 'Ungarisch',
  },
  {
    common: {
      add: 'Hinzufügen',
      cancel: 'Abbrechen',
      close: 'Schließen',
      command: 'Befehl',
      copy: 'Kopieren',
      default: 'Standard',
      disabled: 'Deaktiviert',
      enabled: 'Aktiviert',
      exportSettings: 'Einstellungen exportieren',
      importSettings: 'Einstellungen importieren',
      name: 'Name',
      none: 'Keine',
      remove: 'Entfernen',
      save: 'Speichern',
      select: 'Auswählen',
    },
    deviceManager: {
      panelTitle: 'Manager für eingebettete Geräte',
      intro: 'Geräte und Standardkonfiguration verwalten.',
      language: 'Erweiterungssprache',
      reloadToPersistNewDefaultSettings:
        'Einstellungen gespeichert. Laden Sie das Fenster oder den Erweiterungshost neu und speichern Sie dann erneut, um neu hinzugefügte Standardeinstellungen beizubehalten.',
    },
  }
);
