/* eslint-disable spellcheck/spell-checker */
import { createLocalizationBundle } from './factory';

export const cs = createLocalizationBundle(
  'cs',
  'cs',
  {
    vscode: 'Výchozí VSCode',
    en: 'Angličtina',
    es: 'Španělština',
    it: 'Italština',
    'zh-cn': 'Zjednodušená čínština',
    'zh-tw': 'Tradiční čínština',
    fr: 'Francouzština',
    de: 'Němčina',
    ja: 'Japonština',
    ko: 'Korejština',
    ru: 'Ruština',
    'pt-br': 'Portugalština (Brazílie)',
    tr: 'Turečtina',
    pl: 'Polština',
    cs: 'Čeština',
    hu: 'Maďarština',
  },
  {
    common: {
      add: 'Přidat',
      cancel: 'Zrušit',
      close: 'Zavřít',
      command: 'Příkaz',
      copy: 'Kopírovat',
      default: 'Výchozí',
      disabled: 'Zakázáno',
      enabled: 'Povoleno',
      exportSettings: 'Exportovat nastavení',
      importSettings: 'Importovat nastavení',
      name: 'Název',
      none: 'Žádné',
      remove: 'Odebrat',
      save: 'Uložit',
      select: 'Vybrat',
    },
    deviceManager: {
      panelTitle: 'Správce embedded zařízení',
      intro: 'Spravujte zařízení a výchozí konfiguraci.',
      language: 'Jazyk rozšíření',
      reloadToPersistNewDefaultSettings:
        'Nastavení uloženo. Znovu načtěte okno nebo hostitele rozšíření a poté uložte znovu, aby se nově přidaná výchozí nastavení zachovala.',
    },
  }
);
