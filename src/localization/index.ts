/* eslint-disable spellcheck/spell-checker */
import * as vscode from 'vscode';
import { cs } from './cs';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { hu } from './hu';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { pl } from './pl';
import { ptBr } from './pt-br';
import { ru } from './ru';
import { tr } from './tr';
import { zhCn } from './zh-cn';
import { zhTw } from './zh-tw';

export const supportedLanguages = [
  'en',
  'es',
  'it',
  'zh-cn',
  'zh-tw',
  'fr',
  'de',
  'ja',
  'ko',
  'ru',
  'pt-br',
  'tr',
  'pl',
  'cs',
  'hu',
] as const;
export const languagePreferences = ['vscode', ...supportedLanguages] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];
export type LanguagePreference = (typeof languagePreferences)[number];
export type LocalizedStrings = typeof en;

const bundles: Record<SupportedLanguage, LocalizedStrings> = {
  en,
  es,
  it,
  'zh-cn': zhCn,
  'zh-tw': zhTw,
  fr,
  de,
  ja,
  ko,
  ru,
  'pt-br': ptBr,
  tr,
  pl,
  cs,
  hu,
};

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return typeof value === 'string' && (languagePreferences as readonly string[]).includes(value);
}

function normalizePreference(value: unknown): LanguagePreference {
  return isLanguagePreference(value) ? value : 'vscode';
}

function normalizeSupportedLanguage(value: unknown): SupportedLanguage {
  if (typeof value !== 'string') {
    return 'en';
  }

  const normalized = value.toLowerCase().replace(/_/g, '-');
  if (normalized.startsWith('zh-cn') || normalized.startsWith(['zh', 'hans'].join('-'))) {
    return 'zh-cn';
  }
  if (normalized.startsWith('zh-tw') || normalized.startsWith(['zh', 'hant'].join('-'))) {
    return 'zh-tw';
  }
  if (normalized.startsWith('pt-br')) {
    return 'pt-br';
  }

  const language = normalized.split('-')[0];
  return (supportedLanguages as readonly string[]).includes(language)
    ? (language as SupportedLanguage)
    : 'en';
}

export function getLanguagePreference(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('embeddedLogger')
): LanguagePreference {
  return normalizePreference(config.get<LanguagePreference>('language', 'vscode'));
}

export function resolveLanguage(
  preference: LanguagePreference = getLanguagePreference(),
  vscodeLanguage: string = vscode.env.language
): SupportedLanguage {
  return preference === 'vscode' ? normalizeSupportedLanguage(vscodeLanguage) : preference;
}

export function getLocalizedStrings(): LocalizedStrings {
  return bundles[resolveLanguage()];
}

export function formatLocalizedString(
  template: string,
  values: Record<string, string | number | undefined> = {}
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export function localize(
  keyPath: string,
  values: Record<string, string | number | undefined> = {}
): string {
  const value = getPathValue(getLocalizedStrings(), keyPath) ?? getPathValue(en, keyPath);
  return typeof value === 'string' ? formatLocalizedString(value, values) : keyPath;
}

export function getPathValue(source: LocalizedStrings, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, source);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
