import { createLocalizationBundle } from './factory';

export const ja = createLocalizationBundle(
  'ja',
  'ja',
  {
    vscode: 'VSCode の既定',
    en: '英語',
    es: 'スペイン語',
    it: 'イタリア語',
    'zh-cn': '簡体字中国語',
    'zh-tw': '繁体字中国語',
    fr: 'フランス語',
    de: 'ドイツ語',
    ja: '日本語',
    ko: '韓国語',
    ru: 'ロシア語',
    'pt-br': 'ポルトガル語 (ブラジル)',
    tr: 'トルコ語',
    pl: 'ポーランド語',
    cs: 'チェコ語',
    hu: 'ハンガリー語',
  },
  {
    common: {
      add: '追加',
      cancel: 'キャンセル',
      close: '閉じる',
      command: 'コマンド',
      copy: 'コピー',
      default: '既定',
      disabled: '無効',
      enabled: '有効',
      exportSettings: '設定をエクスポート',
      importSettings: '設定をインポート',
      name: '名前',
      none: 'なし',
      remove: '削除',
      save: '保存',
      select: '選択',
    },
    deviceManager: {
      panelTitle: '組み込みデバイス マネージャー',
      intro: 'デバイスと既定の構成を管理します。',
      language: '拡張機能の言語',
      reloadToPersistNewDefaultSettings:
        '設定を保存しました。新しく追加された既定の設定を保持するには、ウィンドウまたは拡張機能ホストを再読み込みしてから、もう一度保存してください。',
    },
  }
);
