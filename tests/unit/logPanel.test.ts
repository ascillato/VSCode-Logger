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
});
