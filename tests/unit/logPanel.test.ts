import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/logSession', () => {
  const logSessionInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    callbacks: Record<string, unknown>;
    dependencies: Record<string, unknown>;
  }> = [];
  class MockLogSession {
    start = vi.fn(async () => undefined);
    dispose = vi.fn(() => undefined);
    callbacks: Record<string, unknown>;
    dependencies: Record<string, unknown>;

    constructor(
      _device: unknown,
      _context: unknown,
      callbacks: Record<string, unknown>,
      dependencies: Record<string, unknown> = {}
    ) {
      this.callbacks = callbacks;
      this.dependencies = dependencies;
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
  window,
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

  it('reuses the last successful endpoint host on reconnect', async () => {
    const context = createExtensionContext();
    const panel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const webviewPanel = getCreatedWebviews()[0];
    const firstSession = logSessionInstances[0];
    const notifyConnectedEndpoint = firstSession.callbacks.onConnectedEndpoint as (endpoint: {
      host: string;
      label: string;
    }) => void;

    notifyConnectedEndpoint({
      host: 'backup.example.com',
      label: 'secondary',
    });

    webviewPanel.__fireMessage({ type: 'requestReconnect' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondSession = logSessionInstances[1];

    expect(secondSession.dependencies.preferredEndpointHost).toBe('backup.example.com');

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

  it('sends initial data and local file lines after the webview is ready', async () => {
    const context = createExtensionContext();
    const panel = new LogPanel(
      context,
      {
        type: 'local',
        id: 'local-ready',
        name: 'Imported',
        lines: ['one', 'two\u001b[31m red\u001b[0m'],
        filePath: '/tmp/imported.log',
      },
      () => undefined
    );
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    const startPromise = panel.start();
    webviewPanel.__fireMessage({ type: 'ready' });
    await startPromise;

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'initData',
        deviceId: 'local-ready',
        isLive: false,
      })
    );
    expect(postMessage).toHaveBeenCalledWith({
      type: 'initialLines',
      lines: ['one', 'two red'],
    });
    expect(postMessage).toHaveBeenCalledWith({ type: 'status', message: 'Loaded 2 lines.' });

    panel.dispose();
  });

  it('saves presets, deletes presets, stores highlights, and exports visible lines', async () => {
    const context = createExtensionContext();
    setSaveDialogResponse('/tmp/exported.log');
    const panel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    webviewPanel.__fireMessage({
      type: 'requestSavePreset',
      name: ' Errors ',
      minLevel: 'error',
      textFilter: 'panic',
    });
    webviewPanel.__fireMessage({
      type: 'highlightsChanged',
      highlights: [
        {
          id: 1,
          key: 'panic',
          baseColor: '#ff0000',
          color: '#ffffff',
          backgroundColor: '#ff0000',
        },
      ],
    });
    webviewPanel.__fireMessage({ type: 'deletePreset', name: 'Errors' });
    webviewPanel.__fireMessage({ type: 'exportLogs', lines: ['a', 'b'] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'presetsUpdated',
      presets: [{ name: 'Errors', minLevel: 'error', textFilter: 'panic' }],
    });
    expect(postMessage).toHaveBeenCalledWith({ type: 'presetsUpdated', presets: [] });
    await expect(workspace.fs.readFile(Uri.file('/tmp/exported.log'))).resolves.toEqual(
      Buffer.from('a\nb', 'utf8')
    );
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Exported 2 lines from Test Device.'
    );

    panel.dispose();
  });

  it('handles source-file commands and unavailable source actions', async () => {
    const context = createExtensionContext();
    const remotePanel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const remoteWebview = getCreatedWebviews()[0];

    remoteWebview.__fireMessage({ type: 'openSourceFile' });
    remoteWebview.__fireMessage({ type: 'refreshSourceFile' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Edit is only available for imported log files.'
    );
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Refresh is only available for imported log files.'
    );

    const localPanel = new LogPanel(
      context,
      { type: 'local', id: 'local-open', name: 'Local', lines: [], filePath: '/tmp/missing.log' },
      () => undefined
    );
    const localWebview = getCreatedWebviews()[1];
    localWebview.__fireMessage({ type: 'openSourceFile' });
    localWebview.__fireMessage({ type: 'refreshSourceFile' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.showTextDocument).toHaveBeenCalled();
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to read log file: File not found');

    remotePanel.dispose();
    localPanel.dispose();
  });

  it('posts session close, disconnect, auto-save, and host-key mismatch status messages', async () => {
    const context = createExtensionContext();
    setSaveDialogResponse('/tmp/live.log');
    const panel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const firstSession = logSessionInstances[0];

    (firstSession.callbacks.onClose as () => void)();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sessionClosed', message: 'Session closed.' })
    );

    webviewPanel.__fireMessage({ type: 'requestReconnect' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondSession = logSessionInstances[1];

    webviewPanel.__fireMessage({ type: 'startAutoSave' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'autoSaveStarted',
      filePath: '/tmp/live.log',
      fileName: 'live.log',
    });

    (
      secondSession.callbacks.onHostKeyMismatch as (details: {
        expected: string;
        received: string;
      }) => void
    )({ expected: 'SHA256:old', received: 'SHA256:new' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'hostKeyMismatch',
      expected: 'SHA256:old',
      received: 'SHA256:new',
    });

    webviewPanel.__fireMessage({ type: 'stopAutoSave', message: 'Stopped.' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    webviewPanel.__fireMessage({ type: 'requestDisconnect' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sessionClosed', message: 'Disconnected.' })
    );

    panel.dispose();
  });

  it('reports cancelled auto-save when no destination is selected or no live session exists', async () => {
    const context = createExtensionContext();
    const remotePanel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const remoteWebview = getCreatedWebviews()[0];
    const remotePost = remoteWebview.webview.postMessage as unknown as vi.Mock;

    setSaveDialogResponse(undefined);
    remoteWebview.__fireMessage({ type: 'startAutoSave' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remotePost).toHaveBeenCalledWith({
      type: 'autoSaveStopped',
      message: 'Auto-save cancelled.',
    });

    const localPanel = new LogPanel(
      context,
      { type: 'local', id: 'local-auto', name: 'Local', lines: [], filePath: '/tmp/local.log' },
      () => undefined
    );
    const localWebview = getCreatedWebviews()[1];
    const localPost = localWebview.webview.postMessage as unknown as vi.Mock;

    localWebview.__fireMessage({ type: 'startAutoSave' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(localPost).toHaveBeenCalledWith({ type: 'autoSaveStopped', message: '' });

    remotePanel.dispose();
    localPanel.dispose();
  });

  it('covers session callbacks, reconnect failures, dispose guards, and fallback messages', async () => {
    const context = createExtensionContext();
    const panel = new LogPanel(context, { type: 'remote', device }, () => undefined);
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const firstSession = logSessionInstances[0];

    (firstSession.callbacks.onError as (message: string) => void)('stream failed');
    (firstSession.callbacks.onStatus as (message: string) => void)('connecting');
    expect(postMessage).toHaveBeenCalledWith({ type: 'error', message: 'stream failed' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'status', message: 'connecting' });

    vi.spyOn(panel as never, 'createSession').mockReturnValueOnce({
      start: vi.fn(() => Promise.reject(new Error('plain reconnect failure'))),
      dispose: vi.fn(),
    });
    webviewPanel.__fireMessage({ type: 'requestReconnect' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'error',
      message: 'plain reconnect failure',
    });

    expect(
      (
        panel as unknown as {
          getErrorMessage: (err: unknown) => string;
          formatTimestamp: (value: number) => string;
          sanitizeLogLine: (line: string) => string;
        }
      ).getErrorMessage({ toString: () => 'object failure' })
    ).toBe('object failure');
    expect(
      (
        panel as unknown as {
          formatTimestamp: (value: number) => string;
        }
      ).formatTimestamp(Number.NaN)
    ).toEqual(expect.any(String));
    expect(
      (
        panel as unknown as {
          sanitizeLogLine: (line: string) => string;
        }
      ).sanitizeLogLine('')
    ).toBe('');

    panel.dispose();
    panel.dispose();
    webviewPanel.dispose();
    expect(firstSession.dispose).toHaveBeenCalled();
  });

  it('covers export and source-file fallback error messages', async () => {
    const context = createExtensionContext();
    const panel = new LogPanel(
      context,
      {
        type: 'local',
        id: 'local-errors',
        name: 'Local',
        lines: [],
        filePath: '/tmp/local-errors.log',
      },
      () => undefined
    );
    const webviewPanel = getCreatedWebviews()[0];

    setSaveDialogResponse(undefined);
    webviewPanel.__fireMessage({ type: 'exportLogs', lines: ['a'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.showInformationMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Exported')
    );

    vi.spyOn(workspace.fs, 'writeFile').mockRejectedValueOnce('');
    setSaveDialogResponse('/tmp/export-fails.log');
    webviewPanel.__fireMessage({ type: 'exportLogs', lines: ['a'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to export logs.');

    vi.spyOn(workspace, 'openTextDocument').mockRejectedValueOnce('');
    webviewPanel.__fireMessage({ type: 'openSourceFile' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to open log file.');

    vi.spyOn(workspace.fs, 'readFile').mockRejectedValueOnce('');
    webviewPanel.__fireMessage({ type: 'refreshSourceFile' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to read log file.');

    panel.dispose();
  });

  it('covers local-only session guard, disconnect no-op, and auto-save fallback messages', async () => {
    const context = createExtensionContext();
    const panel = new LogPanel(
      context,
      {
        type: 'local',
        id: 'local-guards',
        name: 'Local Guards',
        lines: [],
        filePath: '/tmp/g.log',
      },
      () => undefined
    );
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const internals = panel as unknown as {
      createSession: () => unknown;
      disconnect: () => void;
      writeAutoSaveLine: (line: string) => void;
    };

    expect(() => internals.createSession()).toThrow(
      'Cannot create a log session without a device.'
    );
    internals.disconnect();

    const writeSpy = vi
      .spyOn(AutoSaveManager.prototype, 'writeLine')
      .mockImplementationOnce((_line, onError, onStop) => {
        onError('');
        onStop();
      });

    internals.writeAutoSaveLine('line');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessage).toHaveBeenCalledWith({ type: 'autoSaveError', message: '' });
    writeSpy.mockRestore();
    panel.dispose();
  });
});
