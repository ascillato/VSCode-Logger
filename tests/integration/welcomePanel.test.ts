import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getWelcomeMarkupForTesting } from '../../src/welcomePanel';

vi.mock('vscode', () => {
  const Uri = {
    file: (path: string) => ({ fsPath: path, path }),
    joinPath: (
      base: { path?: string; fsPath?: string; toString?: () => string },
      ...parts: string[]
    ) => {
      const basePath = base.path ?? base.fsPath ?? base.toString?.() ?? '';
      return { path: [basePath, ...parts].join('/') };
    },
  };

  return {
    Uri,
    ViewColumn: { One: 1 },
    window: {
      createWebviewPanel: vi.fn(),
    },
  };
});

describe('welcome panel markup', () => {
  it('includes the placeholder payload element', () => {
    const fakeWebview = {
      cspSource: 'vscode-resource://unit-test',
      asWebviewUri: (uri: vscode.Uri) => uri,
    } as unknown as vscode.Webview;

    const html = getWelcomeMarkupForTesting(fakeWebview, vscode.Uri.file('/tmp/template'));
    expect(html).toContain('id="payload"');
    expect(html).toContain('Extension Template');
  });
});
