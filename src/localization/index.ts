import * as vscode from 'vscode';
import { en } from './en';
import { es } from './es';
import { it } from './it';

export type LanguagePreference = 'vscode' | 'en' | 'es' | 'it';
export type SupportedLanguage = Exclude<LanguagePreference, 'vscode'>;
export type LocalizedStrings = typeof en;

const bundles: Record<SupportedLanguage, LocalizedStrings> = {
  en,
  es,
  it,
};

function normalizePreference(value: unknown): LanguagePreference {
  return value === 'vscode' || value === 'en' || value === 'es' || value === 'it'
    ? value
    : 'vscode';
}

function normalizeSupportedLanguage(value: unknown): SupportedLanguage {
  if (typeof value !== 'string') {
    return 'en';
  }

  const language = value.toLowerCase().split(/[-_]/)[0];
  return language === 'es' || language === 'it' ? language : 'en';
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
