/* eslint-disable spellcheck/spell-checker */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import { resolveLanguage } from '../../src/localization';

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
});
