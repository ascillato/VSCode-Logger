/* eslint-disable spellcheck/spell-checker */
import { createLocalizationBundle } from './factory';

export const fr = createLocalizationBundle(
  'fr',
  'fr',
  {
    vscode: 'Par défaut de VSCode',
    en: 'Anglais',
    es: 'Espagnol',
    it: 'Italien',
    'zh-cn': 'Chinois simplifié',
    'zh-tw': 'Chinois traditionnel',
    fr: 'Français',
    de: 'Allemand',
    ja: 'Japonais',
    ko: 'Coréen',
    ru: 'Russe',
    'pt-br': 'Portugais (Brésil)',
    tr: 'Turc',
    pl: 'Polonais',
    cs: 'Tchèque',
    hu: 'Hongrois',
  },
  {
    common: {
      add: 'Ajouter',
      cancel: 'Annuler',
      close: 'Fermer',
      command: 'Commande',
      copy: 'Copier',
      default: 'Par défaut',
      disabled: 'Désactivé',
      enabled: 'Activé',
      exportSettings: 'Exporter les paramètres',
      importSettings: 'Importer les paramètres',
      name: 'Nom',
      none: 'Aucun',
      remove: 'Supprimer',
      save: 'Enregistrer',
      select: 'Sélectionner',
    },
    deviceManager: {
      panelTitle: 'Gestionnaire des appareils embarqués',
      intro: 'Gérez les appareils et la configuration par défaut.',
      language: "Langue de l'extension",
      reloadToPersistNewDefaultSettings:
        "Paramètres enregistrés. Rechargez la fenêtre ou l'hôte d'extension, puis enregistrez à nouveau pour conserver les nouveaux paramètres par défaut.",
    },
  }
);
