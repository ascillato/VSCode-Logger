import { createLocalizationBundle } from './factory';

export const ru = createLocalizationBundle(
  'ru',
  'ru',
  {
    vscode: 'По умолчанию VSCode',
    en: 'Английский',
    es: 'Испанский',
    it: 'Итальянский',
    'zh-cn': 'Упрощенный китайский',
    'zh-tw': 'Традиционный китайский',
    fr: 'Французский',
    de: 'Немецкий',
    ja: 'Японский',
    ko: 'Корейский',
    ru: 'Русский',
    'pt-br': 'Португальский (Бразилия)',
    tr: 'Турецкий',
    pl: 'Польский',
    cs: 'Чешский',
    hu: 'Венгерский',
  },
  {
    common: {
      add: 'Добавить',
      cancel: 'Отмена',
      close: 'Закрыть',
      command: 'Команда',
      copy: 'Копировать',
      default: 'По умолчанию',
      disabled: 'Отключено',
      enabled: 'Включено',
      exportSettings: 'Экспорт настроек',
      importSettings: 'Импорт настроек',
      name: 'Имя',
      none: 'Нет',
      remove: 'Удалить',
      save: 'Сохранить',
      select: 'Выбрать',
    },
    deviceManager: {
      panelTitle: 'Диспетчер встроенных устройств',
      intro: 'Управление устройствами и конфигурацией по умолчанию.',
      language: 'Язык расширения',
    },
  }
);
