import { createLocalizationBundle } from './factory';

export const ko = createLocalizationBundle(
  'ko',
  'ko',
  {
    vscode: 'VSCode 기본값',
    en: '영어',
    es: '스페인어',
    it: '이탈리아어',
    'zh-cn': '중국어 간체',
    'zh-tw': '중국어 번체',
    fr: '프랑스어',
    de: '독일어',
    ja: '일본어',
    ko: '한국어',
    ru: '러시아어',
    'pt-br': '포르투갈어(브라질)',
    tr: '터키어',
    pl: '폴란드어',
    cs: '체코어',
    hu: '헝가리어',
  },
  {
    common: {
      add: '추가',
      cancel: '취소',
      close: '닫기',
      command: '명령',
      copy: '복사',
      default: '기본값',
      disabled: '비활성화됨',
      enabled: '활성화됨',
      exportSettings: '설정 내보내기',
      importSettings: '설정 가져오기',
      name: '이름',
      none: '없음',
      remove: '제거',
      save: '저장',
      select: '선택',
    },
    deviceManager: {
      panelTitle: '임베디드 장치 관리자',
      intro: '장치와 기본 구성을 관리합니다.',
      language: '확장 언어',
    },
  }
);
