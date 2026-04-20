import { createLocalizationBundle } from './factory';

export const zhCn = createLocalizationBundle(
  'zh-cn',
  'zh-CN',
  {
    vscode: 'VSCode 默认',
    en: '英语',
    es: '西班牙语',
    it: '意大利语',
    'zh-cn': '简体中文',
    'zh-tw': '繁體中文',
    fr: '法语',
    de: '德语',
    ja: '日语',
    ko: '韩语',
    ru: '俄语',
    'pt-br': '葡萄牙语（巴西）',
    tr: '土耳其语',
    pl: '波兰语',
    cs: '捷克语',
    hu: '匈牙利语',
  },
  {
    common: {
      add: '添加',
      cancel: '取消',
      close: '关闭',
      command: '命令',
      copy: '复制',
      default: '默认',
      disabled: '已禁用',
      enabled: '已启用',
      exportSettings: '导出设置',
      importSettings: '导入设置',
      name: '名称',
      none: '无',
      remove: '移除',
      save: '保存',
      select: '选择',
    },
    deviceManager: {
      panelTitle: '嵌入式设备管理器',
      intro: '管理设备和默认配置。',
      language: '扩展语言',
      reloadToPersistNewDefaultSettings:
        '设置已保存。请重新加载窗口或扩展主机，然后再次保存以保留新添加的默认设置。',
    },
  }
);
