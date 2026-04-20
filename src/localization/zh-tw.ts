import { createLocalizationBundle } from './factory';

export const zhTw = createLocalizationBundle(
  'zh-tw',
  'zh-TW',
  {
    vscode: 'VSCode 預設',
    en: '英文',
    es: '西班牙文',
    it: '義大利文',
    'zh-cn': '简体中文',
    'zh-tw': '繁體中文',
    fr: '法文',
    de: '德文',
    ja: '日文',
    ko: '韓文',
    ru: '俄文',
    'pt-br': '葡萄牙文（巴西）',
    tr: '土耳其文',
    pl: '波蘭文',
    cs: '捷克文',
    hu: '匈牙利文',
  },
  {
    common: {
      add: '新增',
      cancel: '取消',
      close: '關閉',
      command: '命令',
      copy: '複製',
      default: '預設',
      disabled: '已停用',
      enabled: '已啟用',
      exportSettings: '匯出設定',
      importSettings: '匯入設定',
      name: '名稱',
      none: '無',
      remove: '移除',
      save: '儲存',
      select: '選取',
    },
    deviceManager: {
      panelTitle: '嵌入式裝置管理器',
      intro: '管理裝置和預設組態。',
      language: '擴充功能語言',
    },
  }
);
