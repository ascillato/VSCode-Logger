import { en } from './en';

export type LocalizedStrings = typeof en;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeLocalized<T extends Record<string, unknown>>(base: T, overrides: DeepPartial<T>): T {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = result[key];
    result[key] =
      isRecord(baseValue) && isRecord(value)
        ? mergeLocalized(baseValue, value as DeepPartial<Record<string, unknown>>)
        : value;
  }

  return result as T;
}

export function createLocalizationBundle(
  languageId: string,
  htmlLang: string,
  languageNames: DeepPartial<LocalizedStrings['languageNames']>,
  overrides: DeepPartial<Omit<LocalizedStrings, 'languageId' | 'htmlLang' | 'languageNames'>> = {}
): LocalizedStrings {
  return mergeLocalized(en, {
    ...overrides,
    languageId,
    htmlLang,
    languageNames: {
      ...en.languageNames,
      ...languageNames,
    },
  });
}
