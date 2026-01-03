import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/logSession', () => {
  const logSessionInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  class MockLogSession {
    start = vi.fn(async () => undefined);
    dispose = vi.fn(() => undefined);

    constructor() {
      logSessionInstances.push(this);
    }
  }

  return { LogSession: MockLogSession, __logSessionInstances: logSessionInstances };
});

import type { EmbeddedDevice } from '../../src/deviceTree';
import { LogPanel } from '../../src/logPanel';
import { AutoSaveManager } from '../../src/logPanel/autoSaveManager';
import {
  createExtensionContext,
  getCreatedWebviews,
  resetCreatedWebviews,
  resetWindowResponses,
  Uri,
  workspace,
  setSaveDialogResponse,
} from '../mocks/vscode';
import { __logSessionInstances as logSessionInstances } from '../../src/logSession';

const device: EmbeddedDevice = {
  id: 'device-1',
  name: 'Test Device',
  host: 'example.com',
  username: 'root',
};

beforeEach(() => {
  resetWindowResponses();
  resetCreatedWebviews();
  logSessionInstances.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LogPanel (unit)', () => {
  it('reports auto-save errors to the webview when start fails', async () => {
    const context = createExtensionContext();
    setSaveDialogResponse('/tmp/output.log');
    const startSpy = vi
      .spyOn(AutoSaveManager.prototype, 'start')
      .mockRejectedValue(new Error('disk full'));
    const stopSpy = vi.spyOn(AutoSaveManager.prototype, 'stop');

    const panel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    webviewPanel.__fireMessage({ type: 'startAutoSave' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'autoSaveError',
      message: 'Auto-save failed: disk full',
    });
    expect(stopSpy).toHaveBeenCalled();

    startSpy.mockRestore();
    panel.dispose();
  });

  it('routes reconnect requests through a new LogSession instance', async () => {
    const context = createExtensionContext();
    const panel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const firstSession = logSessionInstances[0];
    const firstDispose = firstSession.dispose as vi.Mock;

    webviewPanel.__fireMessage({ type: 'requestReconnect' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondSession = logSessionInstances[1];

    expect(firstDispose).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: 'status', message: 'Reconnecting...' });
    expect(secondSession.start).toHaveBeenCalled();

    panel.dispose();
  });

  it('sanitizes incoming log lines before posting to the webview', () => {
    const context = createExtensionContext();
    const panel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    (panel as unknown as { handleIncomingLine: (line: string) => void }).handleIncomingLine(
      'binary \u001b[31mred\u001b[0m end\u0000'
    );

    expect(postMessage).toHaveBeenCalledWith({ type: 'logLine', line: 'binary red end�' });

    panel.dispose();
  });

  it('sanitizes refreshed local log file lines before sending them to the webview', async () => {
    const context = createExtensionContext();
    const panel = new LogPanel(
      context,
      { type: 'local', id: 'local-1', name: 'Local file', lines: [], filePath: '/tmp/log' },
      () => undefined
    );
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    await workspace.fs.writeFile(
      Uri.file('/tmp/log'),
      Buffer.from('line1\u001b[32mOK\u001b[0m\x07', 'utf8')
    );

    webviewPanel.__fireMessage({ type: 'refreshSourceFile' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'replaceLines',
      lines: ['line1OK�'],
      message: 'Reloaded 1 lines from log.',
    });

    panel.dispose();
  });
});
