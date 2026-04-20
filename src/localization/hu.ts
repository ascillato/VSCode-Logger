/* eslint-disable spellcheck/spell-checker */
import { createLocalizationBundle } from './factory';

export const hu = createLocalizationBundle(
  'hu',
  'hu',
  {
    vscode: 'VSCode alapértelmezett',
    en: 'Angol',
    es: 'Spanyol',
    it: 'Olasz',
    'zh-cn': 'Egyszerűsített kínai',
    'zh-tw': 'Hagyományos kínai',
    fr: 'Francia',
    de: 'Német',
    ja: 'Japán',
    ko: 'Koreai',
    ru: 'Orosz',
    'pt-br': 'Portugál (Brazília)',
    tr: 'Török',
    pl: 'Lengyel',
    cs: 'Cseh',
    hu: 'Magyar',
  },
  {
    common: {
      add: 'Hozzáadás',
      cancel: 'Mégse',
      close: 'Bezárás',
      command: 'Parancs',
      copy: 'Másolás',
      default: 'Alapértelmezett',
      disabled: 'Letiltva',
      enabled: 'Engedélyezve',
      exportSettings: 'Beállítások exportálása',
      importSettings: 'Beállítások importálása',
      name: 'Név',
      none: 'Nincs',
      remove: 'Eltávolítás',
      save: 'Mentés',
      select: 'Kiválasztás',
    },
    deviceManager: {
      panelTitle: 'Beágyazott eszközök kezelője',
      intro: 'Eszközök és alapértelmezett konfiguráció kezelése.',
      language: 'Bővítmény nyelve',
    },
  }
);
