/* eslint-disable spellcheck/spell-checker */
import { createLocalizationBundle } from './factory';

export const ptBr = createLocalizationBundle(
  'pt-br',
  'pt-BR',
  {
    vscode: 'Padrão do VSCode',
    en: 'Inglês',
    es: 'Espanhol',
    it: 'Italiano',
    'zh-cn': 'Chinês simplificado',
    'zh-tw': 'Chinês tradicional',
    fr: 'Francês',
    de: 'Alemão',
    ja: 'Japonês',
    ko: 'Coreano',
    ru: 'Russo',
    'pt-br': 'Português (Brasil)',
    tr: 'Turco',
    pl: 'Polonês',
    cs: 'Tcheco',
    hu: 'Húngaro',
  },
  {
    common: {
      add: 'Adicionar',
      cancel: 'Cancelar',
      close: 'Fechar',
      command: 'Comando',
      copy: 'Copiar',
      default: 'Padrão',
      disabled: 'Desativado',
      enabled: 'Ativado',
      exportSettings: 'Exportar configurações',
      importSettings: 'Importar configurações',
      name: 'Nome',
      none: 'Nenhum',
      remove: 'Remover',
      save: 'Salvar',
      select: 'Selecionar',
    },
    deviceManager: {
      panelTitle: 'Gerenciador de dispositivos embarcados',
      intro: 'Gerencie dispositivos e a configuração padrão.',
      language: 'Idioma da extensão',
    },
  }
);
