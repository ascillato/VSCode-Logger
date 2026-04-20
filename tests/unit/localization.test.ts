/* eslint-disable spellcheck/spell-checker */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import { en } from '../../src/localization/en';
import { resolveLanguage, supportedLanguages } from '../../src/localization';

const bundleImports = import.meta.glob('../../src/localization/*.ts', {
  eager: true,
}) as Record<string, Record<string, unknown>>;

function collectStringPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') {
    return [prefix];
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return collectStringPaths(child, nextPrefix);
  });
}

function getPathValue(source: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, source);
}

function exportNameForLanguage(language: string): string {
  if (language === 'zh-cn') {
    return 'zhCn';
  }
  if (language === 'zh-tw') {
    return 'zhTw';
  }
  if (language === 'pt-br') {
    return 'ptBr';
  }

  return language;
}

describe('localization', () => {
  it('resolves explicit language preferences', () => {
    expect(resolveLanguage('fr', 'en')).toBe('fr');
    expect(resolveLanguage('pt-br', 'en')).toBe('pt-br');
    expect(resolveLanguage('zh-cn', 'en')).toBe('zh-cn');
    expect(resolveLanguage('zh-tw', 'en')).toBe('zh-tw');
  });

  it('resolves VS Code display language aliases and falls back to English', () => {
    expect(resolveLanguage('vscode', 'de')).toBe('de');
    expect(resolveLanguage('vscode', 'pt-BR')).toBe('pt-br');
    expect(resolveLanguage('vscode', 'zh-Hans')).toBe('zh-cn');
    expect(resolveLanguage('vscode', 'zh-Hant')).toBe('zh-tw');
    expect(resolveLanguage('vscode', 'nl')).toBe('en');
  });

  it('keeps every supported language structurally complete with the English bundle', () => {
    const englishPaths = collectStringPaths(en).sort();

    for (const language of supportedLanguages) {
      const modulePath = `../../src/localization/${language}.ts`;
      const bundle = bundleImports[modulePath]?.[exportNameForLanguage(language)];

      expect(bundle, `${language} bundle`).toBeTruthy();
      expect(collectStringPaths(bundle).sort(), language).toEqual(englishPaths);

      for (const keyPath of englishPaths) {
        expect(typeof getPathValue(bundle, keyPath), `${language}.${keyPath}`).toBe('string');
      }
    }
  });
});
