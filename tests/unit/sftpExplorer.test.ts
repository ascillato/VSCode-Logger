import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { SftpExplorerPanel } from '../../src/sftpExplorer';
import {
  createExtensionContext,
  getCreatedWebviews,
  resetCreatedWebviews,
  resetWorkspaceConfiguration,
  resetWindowResponses,
  workspace,
} from '../mocks/vscode';

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'SFTP Device',
  host: 'device.local',
  username: 'root',
};

const flushAsync = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

const createExplorer = (deviceOverrides: Partial<EmbeddedDevice> = {}): SftpExplorerPanel => {
  const context = createExtensionContext();
  const device = { ...baseDevice, ...deviceOverrides };
  return new SftpExplorerPanel(context, device);
};

beforeEach(() => {
  resetWindowResponses();
  resetCreatedWebviews();
  resetWorkspaceConfiguration();
  workspace.isTrusted = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SftpExplorerPanel', () => {
  it('posts seeded initial state in test mode after the webview requests init', async () => {
    const panel = createExplorer({
      sftpPresetsRemote: ['/var/log', ' /opt/app '],
      sftpPresetsLocal: ['~/Downloads'],
    });
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    const startPromise = panel.start();
    webviewPanel.__fireMessage({ type: 'requestInit' });
    await startPromise;
    await flushAsync();

    expect(postMessage).toHaveBeenNthCalledWith(1, {
      type: 'connectionStatus',
      state: 'connected',
      countdownSeconds: undefined,
      message: 'Connected',
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: 'init',
      remoteHome: '/',
      localHome: '/',
      remote: expect.objectContaining({
        path: '/',
        parentPath: '/',
        isRoot: true,
        location: 'remote',
        entries: expect.arrayContaining([
          expect.objectContaining({ name: 'alpha', type: 'directory' }),
          expect.objectContaining({ name: 'charlie.txt', type: 'file' }),
        ]),
      }),
      local: expect.objectContaining({
        path: '/',
        location: 'local',
      }),
      sftpPresetsRemote: [],
      sftpPresetsLocal: [],
    });

    panel.dispose();
  });

  it('lists seeded entries and returns search previews and search results', async () => {
    const panel = createExplorer();
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    webviewPanel.__fireMessage({ type: 'requestInit' });
    await panel.start();
    await flushAsync();
    postMessage.mockClear();

    webviewPanel.__fireMessage({
      type: 'listEntries',
      location: 'remote',
      path: '/alpha',
      requestId: 'remote',
    });
    await flushAsync();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'listResponse',
      requestId: 'remote',
      snapshot: expect.objectContaining({
        path: '/alpha',
        parentPath: '/',
        isRoot: false,
        location: 'remote',
        entries: [
          { name: 'alpha-child.txt', type: 'file', size: 42 },
          { name: 'alpha-sub', type: 'directory', size: 0 },
        ],
      }),
    });

    postMessage.mockClear();

    webviewPanel.__fireMessage({
      type: 'previewSearchCommand',
      location: 'remote',
      basePath: '/',
      options: { name: 'alpha', includeSubdirectories: true, content: 'child' },
      requestId: 'preview-1',
    });
    await flushAsync();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'searchCommandPreview',
      requestId: 'preview-1',
      command: expect.stringContaining('find .'),
    });

    postMessage.mockClear();

    webviewPanel.__fireMessage({
      type: 'searchEntries',
      location: 'remote',
      basePath: '/',
      options: { content: 'child', includeSubdirectories: true },
      requestId: 'remote',
    });
    await flushAsync();

    expect(postMessage).toHaveBeenNthCalledWith(1, {
      type: 'listResponse',
      requestId: 'remote',
      snapshot: expect.objectContaining({
        path: '/',
        location: 'remote',
        emptyMessage: 'No files found',
        search: expect.objectContaining({
          basePath: '/',
          command: expect.stringContaining('find .'),
          options: expect.objectContaining({
            content: 'child',
            includeSubdirectories: true,
          }),
        }),
        entries: [
          expect.objectContaining({
            name: 'alpha-child.txt',
            fullPath: '/alpha/alpha-child.txt',
            relativePath: 'alpha/alpha-child.txt',
            permissions: 'rw-r--r--',
          }),
        ],
      }),
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: 'status',
      message: 'Found 1 file from /.',
    });

    panel.dispose();
  });

  it('saves sanitized SFTP presets back to configuration and updates the device state', async () => {
    const device: EmbeddedDevice = { ...baseDevice };
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);

    const panel = new SftpExplorerPanel(createExtensionContext(), device);
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    webviewPanel.__fireMessage({
      type: 'saveSftpPresets',
      location: 'remote',
      presets: [
        ' /var/log ',
        '',
        '/opt/app',
        '/var/log',
        '/tmp/a',
        '/tmp/b',
        '/tmp/c',
        '/tmp/d',
        '/tmp/e',
        '/tmp/f',
        '/tmp/g',
        '/tmp/h',
      ],
    });
    await flushAsync();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'sftpPresetsUpdated',
      location: 'remote',
      presets: [
        '/var/log',
        '/opt/app',
        '/var/log',
        '/tmp/a',
        '/tmp/b',
        '/tmp/c',
        '/tmp/d',
        '/tmp/e',
        '/tmp/f',
        '/tmp/g',
      ],
    });
    expect(device.sftpPresetsRemote).toEqual([
      '/var/log',
      '/opt/app',
      '/var/log',
      '/tmp/a',
      '/tmp/b',
      '/tmp/c',
      '/tmp/d',
      '/tmp/e',
      '/tmp/f',
      '/tmp/g',
    ]);
    expect(workspace.getConfiguration('embeddedLogger').get('devices', [])).toEqual([
      expect.objectContaining({
        id: 'device-1',
        sftpPresetsRemote: device.sftpPresetsRemote,
      }),
    ]);

    panel.dispose();
  });

  it('starts a reconnect countdown, posts status updates, and retries reconnection', async () => {
    vi.useFakeTimers();

    const panel = createExplorer();
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const reconnectSpy = vi
      .spyOn(panel as unknown as { attemptReconnect: () => Promise<void> }, 'attemptReconnect')
      .mockResolvedValue(undefined);

    postMessage.mockClear();
    (panel as unknown as { handleDisconnect: () => void }).handleDisconnect();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'disconnected',
      countdownSeconds: 5,
      message: 'Disconnected. Reconnecting in 5s…',
    });

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'disconnected',
      countdownSeconds: 4,
      message: 'Disconnected. Reconnecting in 4s…',
    });

    await vi.advanceTimersByTimeAsync(4000);
    await flushAsync();

    expect(reconnectSpy).toHaveBeenCalledTimes(1);

    panel.dispose();
  });
});
