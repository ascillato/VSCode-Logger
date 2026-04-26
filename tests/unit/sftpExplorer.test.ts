import type { Stats } from 'fs';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import pathPosix from 'path/posix';
import { Readable, Writable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { SftpExplorerPanel } from '../../src/sftpExplorer';
import { SshCommandRunner } from '../../src/sshCommandRunner';
import { PasswordManager } from '../../src/passwordManager';
import {
  createExtensionContext,
  getCreatedWebviews,
  resetCreatedWebviews,
  resetWorkspaceConfiguration,
  resetWindowResponses,
  setInputBoxResponse,
  setWarningMessageResponse,
  window,
  workspace,
  Uri,
  ExtensionMode,
} from '../mocks/vscode';

type SftpExplorerInternals = {
  sftp?: MemorySftp;
  remoteHome?: string;
  hostKeyFailure?: { expected: string; received: string };
  bastionHostKeyFailure?: { expected: string; received: string };
  normalizePath(location: 'remote' | 'local', dirPath: string): string;
  isRoot(location: 'remote' | 'local', dirPath: string): boolean;
  getParentDir(location: 'remote' | 'local', dirPath: string): string;
  formatPermissions(mode?: number): string;
  isExecutable(mode?: number): boolean;
  quoteRemotePath(value: string): string;
  validateEntryName(name: string): string;
  sanitizeName(value?: string): string | undefined;
  parseGetentName(output: string): string | undefined;
  mergeMode(existingMode: number | undefined, requestedMode: number): number;
  getBastionConfig(): EmbeddedDevice['bastion'];
  getBastionDevice(bastion: NonNullable<EmbeddedDevice['bastion']>): EmbeddedDevice;
  parseFingerprint(value: string): { display: string; hex: string };
  getExpectedFingerprint(endpoint: {
    host: string;
    label: string;
    fingerprint?: string;
  }): { display: string; hex: string } | undefined;
  computeHostKeyFingerprint(key: string | Buffer): { display: string; hex: string };
  verifyHostKey(key: string | Buffer, expected?: { display: string; hex: string }): boolean;
  verifyBastionHostKey(key: string | Buffer, expected?: { display: string; hex: string }): boolean;
  updateConnectionStatus(
    state: 'connected' | 'disconnected' | 'reconnecting',
    countdownSeconds?: number,
    overrideMessage?: string
  ): void;
  getErrorMessage(err: unknown): string;
  toError(err: unknown, fallbackMessage: string): Error;
  escapeHtml(value: string): string;
  validateDeviceConfiguration(): string | undefined;
  listLocal(
    dirPath: string
  ): Promise<Array<{ name: string; type: string; isExecutable?: boolean }>>;
  buildSnapshot(
    location: 'remote' | 'local',
    dirPath: string,
    context?: 'left' | 'right'
  ): Promise<{ path: string; parentPath: string; isRoot: boolean; entries: unknown[] }>;
  createDirectory(
    location: 'remote' | 'local',
    directoryPath: string,
    name: string
  ): Promise<string>;
  createFile(location: 'remote' | 'local', directoryPath: string, name: string): Promise<string>;
  renameEntry(location: 'remote' | 'local', targetPath: string, newName: string): Promise<string>;
  duplicateEntry(location: 'remote' | 'local', targetPath: string): Promise<string>;
  copyEntry(
    from: { location: 'remote' | 'local'; path: string },
    toDirectory: { location: 'remote' | 'local'; path: string }
  ): Promise<string>;
  copyEntries(
    items: { location: 'remote' | 'local'; path: string }[],
    toDirectory: { location: 'remote' | 'local'; path: string }
  ): Promise<string>;
  deleteEntry(location: 'remote' | 'local', targetPath: string): Promise<string>;
  deleteEntries(location: 'remote' | 'local', paths: string[]): Promise<string>;
  openTerminal(location: 'remote' | 'local', directoryPath: string): Promise<void>;
  viewContent(location: 'remote' | 'local', targetPath: string): Promise<void>;
  applyPermissions(
    location: 'remote' | 'local',
    targetPath: string,
    mode: number,
    owner?: number,
    group?: number
  ): Promise<string>;
  applyPermissionsBatch(
    location: 'remote' | 'local',
    paths: string[],
    mode: number,
    owner?: number,
    group?: number
  ): Promise<string>;
  getRemoteHome(): Promise<string>;
  pathExists(location: 'remote' | 'local', targetPath: string): Promise<boolean>;
  assertDirectory(location: 'remote' | 'local', dirPath: string): Promise<void>;
  ensureDirectoryExists(location: 'remote' | 'local', dirPath: string): Promise<void>;
  getPermissionsInfo(
    location: 'remote' | 'local',
    targetPath: string
  ): Promise<{
    path: string;
    type: string;
    ownerName?: string;
    groupName?: string;
  }>;
  runEntry(location: 'remote' | 'local', targetPath: string): Promise<void>;
};

const getInternals = (panel: SftpExplorerPanel): SftpExplorerInternals =>
  panel as unknown as SftpExplorerInternals;

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

const createProductionExplorer = (
  deviceOverrides: Partial<EmbeddedDevice> = {}
): SftpExplorerPanel => {
  const context = {
    ...createExtensionContext(),
    extensionMode: ExtensionMode.Production,
  };
  const device = { ...baseDevice, ...deviceOverrides };
  return new SftpExplorerPanel(context, device);
};

type RemoteNode = {
  type: 'file' | 'directory';
  content?: string;
  mode: number;
  uid?: number;
  gid?: number;
};

const createRemoteStat = (node: RemoteNode) =>
  ({
    mode: node.mode,
    size: Buffer.byteLength(node.content ?? ''),
    uid: node.uid,
    gid: node.gid,
    mtime: 1000,
    isDirectory: () => node.type === 'directory',
    isFile: () => node.type === 'file',
  }) as unknown as Stats;

class MemorySftp {
  readonly nodes = new Map<string, RemoteNode>([
    ['/', { type: 'directory', mode: 0o755 }],
    ['/alpha', { type: 'directory', mode: 0o755 }],
    ['/alpha/child.txt', { type: 'file', content: 'child', mode: 0o644, uid: 1000, gid: 1000 }],
    ['/script.sh', { type: 'file', content: '#!/bin/sh\n', mode: 0o755 }],
  ]);

  private normalize(value: string): string {
    const normalized = pathPosix.normalize(value || '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  private parentOf(value: string): string {
    return pathPosix.dirname(this.normalize(value));
  }

  readdir(dirPath: string, callback: (err: Error | undefined, list?: unknown[]) => void): void {
    const directory = this.normalize(dirPath);
    const parent = this.nodes.get(directory);
    if (!parent || parent.type !== 'directory') {
      callback(new Error('Not a directory'));
      return;
    }
    const entries = [...this.nodes.entries()]
      .filter(([entryPath]) => entryPath !== directory && this.parentOf(entryPath) === directory)
      .map(([entryPath, node]) => ({
        filename: pathPosix.basename(entryPath),
        longname: '',
        attrs: createRemoteStat(node),
      }));
    callback(undefined, entries);
  }

  realpath(_pathValue: string, callback: (err: Error | undefined, absPath?: string) => void): void {
    callback(undefined, '/');
  }

  stat(targetPath: string, callback: (err: Error | undefined, stats?: Stats) => void): void {
    const node = this.nodes.get(this.normalize(targetPath));
    callback(node ? undefined : new Error('missing'), node ? createRemoteStat(node) : undefined);
  }

  unlink(targetPath: string, callback: (err?: Error) => void): void {
    this.nodes.delete(this.normalize(targetPath));
    callback();
  }

  rename(source: string, destination: string, callback: (err?: Error) => void): void {
    const sourcePath = this.normalize(source);
    const destinationPath = this.normalize(destination);
    const node = this.nodes.get(sourcePath);
    if (!node) {
      callback(new Error('missing'));
      return;
    }
    this.nodes.delete(sourcePath);
    this.nodes.set(destinationPath, node);
    for (const [entryPath, entryNode] of [...this.nodes.entries()]) {
      if (entryPath.startsWith(`${sourcePath}/`)) {
        this.nodes.delete(entryPath);
        this.nodes.set(`${destinationPath}${entryPath.slice(sourcePath.length)}`, entryNode);
      }
    }
    callback();
  }

  mkdir(dirPath: string, callback: (err?: Error) => void): void {
    this.nodes.set(this.normalize(dirPath), { type: 'directory', mode: 0o755 });
    callback();
  }

  rmdir(dirPath: string, callback: (err?: Error) => void): void {
    this.nodes.delete(this.normalize(dirPath));
    callback();
  }

  fastGet(remotePath: string, localPath: string, callback: (err?: Error) => void): void {
    const node = this.nodes.get(this.normalize(remotePath));
    void fs.writeFile(localPath, node?.content ?? '').then(() => callback(), callback);
  }

  fastPut(localPath: string, remotePath: string, callback: (err?: Error) => void): void {
    void fs.readFile(localPath, 'utf8').then((content) => {
      this.nodes.set(this.normalize(remotePath), { type: 'file', content, mode: 0o644 });
      callback();
    }, callback);
  }

  createReadStream(remotePath: string): Readable {
    const node = this.nodes.get(this.normalize(remotePath));
    return Readable.from([node?.content ?? '']);
  }

  createWriteStream(remotePath: string): Writable {
    const chunks: Buffer[] = [];
    return new Writable({
      write: (chunk: Buffer | string, _encoding: BufferEncoding, callback) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
        callback();
      },
      final: (callback) => {
        this.nodes.set(this.normalize(remotePath), {
          type: 'file',
          content: Buffer.concat(chunks).toString('utf8'),
          mode: 0o644,
        });
        callback();
      },
    });
  }

  setstat(
    targetPath: string,
    attrs: { mode?: number; uid?: number; gid?: number },
    callback: (err?: Error) => void
  ): void {
    const node = this.nodes.get(this.normalize(targetPath));
    if (!node) {
      callback(new Error('missing'));
      return;
    }
    this.nodes.set(this.normalize(targetPath), { ...node, ...attrs });
    callback();
  }
}

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

  it('reposts initial state and handles queued test-mode utility messages', async () => {
    const panel = createExplorer({ name: 'SFTP & <Device> "One"' });
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;

    const startPromise = panel.start();
    webviewPanel.__fireMessage({ type: 'requestInit' });
    await startPromise;
    await flushAsync();

    expect(webviewPanel.webview.html).toContain('SFTP &amp; &lt;Device&gt; &quot;One&quot;');

    postMessage.mockClear();
    panel.enqueueTestInput('queued-value');
    webviewPanel.__fireMessage({ type: 'requestInit' });
    webviewPanel.__fireMessage({
      type: 'requestInput',
      prompt: 'Enter a value',
      requestId: 'input-1',
    });
    webviewPanel.__fireMessage({
      type: 'requestPermissionsInfo',
      location: 'local',
      path: '/tmp/demo.txt',
      requestId: 'perm-1',
    });
    webviewPanel.__fireMessage({
      type: 'previewSearchCommand',
      location: 'remote',
      basePath: '/',
      options: { sizeValue: 'bad-size' },
      requestId: 'preview-err',
    });
    await flushAsync();

    const postedCalls = postMessage.mock.calls as Array<[payload: { type?: string }]>;
    const initMessages = postedCalls
      .map(([payload]) => payload)
      .filter((payload) => payload.type === 'init');
    expect(initMessages).toHaveLength(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'inputResult',
      requestId: 'input-1',
      value: 'queued-value',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'permissionsInfo',
      requestId: 'perm-1',
      info: {
        path: '/tmp/demo.txt',
        location: 'local',
        name: 'demo.txt',
        type: 'file',
        mode: 0o644,
        owner: 1000,
        group: 1000,
        ownerName: 'tester',
        groupName: 'tester',
      },
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'searchCommandPreview',
      requestId: 'preview-err',
      error: 'Size must be a number with an optional suffix such as 50M.',
    });

    panel.dispose();
  });

  it('refreshes active searches after mutations and clears them when browsing the pane', async () => {
    const panel = createExplorer();
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const explorer = panel as unknown as {
      activeSearches: Map<string, unknown>;
      searchAndPost: (
        location: 'remote' | 'local',
        basePath: string,
        options: Record<string, unknown>,
        requestId: 'remote' | 'local' | 'rightRemote'
      ) => Promise<void>;
      refreshAfterMutation: (
        location: 'remote' | 'local',
        refreshDir: string,
        requestId: string
      ) => Promise<void>;
      listAndPost: (
        location: 'remote' | 'local',
        dirPath: string,
        requestId: string,
        context?: 'left' | 'right'
      ) => Promise<void>;
    };

    webviewPanel.__fireMessage({ type: 'requestInit' });
    await panel.start();
    await flushAsync();

    await explorer.searchAndPost(
      'remote',
      '/',
      { content: 'alpha', includeSubdirectories: false },
      'remote'
    );
    expect(explorer.activeSearches.has('remote')).toBe(true);

    postMessage.mockClear();
    await explorer.refreshAfterMutation('remote', '/alpha', 'remote');

    expect(postMessage).toHaveBeenNthCalledWith(1, {
      type: 'listResponse',
      requestId: 'remote',
      snapshot: expect.objectContaining({
        path: '/',
        location: 'remote',
        search: expect.objectContaining({
          basePath: '/',
          options: expect.objectContaining({
            content: 'alpha',
            includeSubdirectories: false,
          }),
        }),
        entries: [
          expect.objectContaining({
            name: 'alpha-file.txt',
            relativePath: 'alpha-file.txt',
          }),
          expect.objectContaining({
            name: 'alpha-two.log',
            relativePath: 'alpha-two.log',
          }),
        ],
      }),
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: 'status',
      message: 'Found 2 files from /.',
    });

    postMessage.mockClear();
    await explorer.listAndPost('remote', '/alpha', 'remote', 'left');

    expect(explorer.activeSearches.has('remote')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'listResponse',
      requestId: 'remote',
      snapshot: expect.objectContaining({
        path: '/alpha',
        location: 'remote',
        entries: [
          { name: 'alpha-child.txt', type: 'file', size: 42 },
          { name: 'alpha-sub', type: 'directory', size: 0 },
        ],
      }),
    });

    panel.dispose();
  });

  it('saves empty local presets by removing them from device state and configuration', async () => {
    const device: EmbeddedDevice = {
      ...baseDevice,
      sftpPresetsRemote: [' /var/log ', '', '/opt/app '],
      sftpPresetsLocal: [' ~/Downloads ', '/tmp/work '],
    };
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);

    const panel = new SftpExplorerPanel(createExtensionContext(), device);
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const explorer = panel as unknown as {
      getSftpPresets: (location: 'remote' | 'local') => string[];
    };

    expect(explorer.getSftpPresets('remote')).toEqual(['/var/log', '/opt/app']);
    expect(explorer.getSftpPresets('local')).toEqual(['~/Downloads', '/tmp/work']);

    webviewPanel.__fireMessage({
      type: 'saveSftpPresets',
      location: 'local',
      presets: [' ', ''],
    });
    await flushAsync();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'sftpPresetsUpdated',
      location: 'local',
      presets: [],
    });
    expect(device.sftpPresetsLocal).toBeUndefined();
    expect(workspace.getConfiguration('embeddedLogger').get('devices', [])).toEqual([
      expect.not.objectContaining({
        sftpPresetsLocal: expect.anything(),
      }),
    ]);

    panel.dispose();
  });

  it('covers local filesystem helpers for listing, creating, copying, renaming, and deleting', async () => {
    const panel = createExplorer();
    const explorer = panel as unknown as {
      listLocal: (dirPath: string) => Promise<
        Array<{
          name: string;
          type: 'file' | 'directory';
          permissions?: string;
          isExecutable?: boolean;
        }>
      >;
      createDirectory: (
        location: 'remote' | 'local',
        directoryPath: string,
        name: string
      ) => Promise<string>;
      createFile: (
        location: 'remote' | 'local',
        directoryPath: string,
        name: string
      ) => Promise<string>;
      renameEntry: (
        location: 'remote' | 'local',
        targetPath: string,
        newName: string
      ) => Promise<string>;
      duplicateEntry: (location: 'remote' | 'local', targetPath: string) => Promise<string>;
      copyEntry: (
        from: { location: 'remote' | 'local'; path: string },
        toDirectory: { location: 'remote' | 'local'; path: string }
      ) => Promise<string>;
      copyEntries: (
        items: { location: 'remote' | 'local'; path: string }[],
        toDirectory: { location: 'remote' | 'local'; path: string }
      ) => Promise<string>;
      applyPermissions: (
        location: 'remote' | 'local',
        targetPath: string,
        mode: number,
        owner?: number,
        group?: number
      ) => Promise<string>;
      deleteEntry: (location: 'remote' | 'local', targetPath: string) => Promise<string>;
      deleteEntries: (location: 'remote' | 'local', paths: string[]) => Promise<string>;
    };

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-explorer-test-'));

    try {
      const alphaDir = path.join(root, 'alpha');
      const nestedDir = path.join(alphaDir, 'nested');
      const plainFile = path.join(root, 'plain.txt');
      const scriptFile = path.join(root, 'script.sh');

      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(path.join(nestedDir, 'child.txt'), 'child');
      await fs.writeFile(plainFile, 'plain');
      await fs.writeFile(scriptFile, '#!/bin/sh\necho ok\n');
      await fs.chmod(scriptFile, 0o755);

      const listed = await explorer.listLocal(root);
      expect(listed.map(({ name, type, isExecutable }) => ({ name, type, isExecutable }))).toEqual([
        { name: 'alpha', type: 'directory', isExecutable: false },
        { name: 'plain.txt', type: 'file', isExecutable: false },
        { name: 'script.sh', type: 'file', isExecutable: true },
      ]);
      expect(listed[2]?.permissions).toBe('rwxr-xr-x');

      expect(await explorer.createDirectory('local', root, 'bucket')).toBe(root);
      expect(await explorer.createFile('local', root, 'draft.txt')).toBe(root);
      expect(await explorer.renameEntry('local', path.join(root, 'draft.txt'), 'renamed.txt')).toBe(
        root
      );

      expect(await explorer.duplicateEntry('local', plainFile)).toBe(root);
      await expect(fs.readFile(path.join(root, 'plain (copy 1).txt'), 'utf8')).resolves.toBe(
        'plain'
      );

      expect(await explorer.duplicateEntry('local', alphaDir)).toBe(root);
      await expect(
        fs.readFile(path.join(root, 'alpha (copy 1)', 'nested', 'child.txt'), 'utf8')
      ).resolves.toBe('child');

      expect(
        await explorer.copyEntry(
          { location: 'local', path: plainFile },
          { location: 'local', path: path.join(root, 'bucket') }
        )
      ).toBe(path.join(root, 'bucket'));
      await expect(fs.readFile(path.join(root, 'bucket', 'plain.txt'), 'utf8')).resolves.toBe(
        'plain'
      );

      expect(
        await explorer.copyEntries(
          [
            { location: 'local', path: plainFile },
            { location: 'local', path: scriptFile },
          ],
          { location: 'local', path: path.join(root, 'bucket') }
        )
      ).toBe(path.join(root, 'bucket'));
      await expect(fs.readFile(path.join(root, 'bucket', 'script.sh'), 'utf8')).resolves.toContain(
        'echo ok'
      );

      expect(await explorer.applyPermissions('local', path.join(root, 'renamed.txt'), 0o600)).toBe(
        root
      );
      const renamedStats = await fs.stat(path.join(root, 'renamed.txt'));
      expect(renamedStats.mode & 0o777).toBe(0o600);

      expect(await explorer.deleteEntry('local', path.join(root, 'renamed.txt'))).toBe(root);
      await expect(fs.stat(path.join(root, 'renamed.txt'))).rejects.toThrow();

      expect(await explorer.deleteEntries('local', [alphaDir])).toBe(root);
      await expect(fs.stat(alphaDir)).rejects.toThrow();
    } finally {
      panel.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('validates helper logic for paths, fingerprints, key loading, and configuration', async () => {
    const panel = createExplorer({
      bastion: {
        host: ' bastion.example.com ',
        username: ' jump-user ',
      },
    });
    const explorer = panel as unknown as {
      normalizePath: (location: 'remote' | 'local', dirPath: string) => string;
      isRoot: (location: 'remote' | 'local', dirPath: string) => boolean;
      getParentDir: (location: 'remote' | 'local', dirPath: string) => string;
      formatPermissions: (mode: number | undefined) => string;
      isExecutable: (mode: number | undefined) => boolean;
      quoteRemotePath: (value: string) => string;
      sanitizeName: (value: string | undefined) => string | undefined;
      parseGetentName: (output: string) => string | undefined;
      mergeMode: (existingMode: number | undefined, requestedMode: number) => number;
      validateDeviceConfiguration: () => string | undefined;
      getBastionConfig: () =>
        | {
            host: string;
            username: string;
            port?: number;
            hostFingerprint?: string;
            privateKeyPath?: string;
          }
        | undefined;
      getBastionDevice: (bastion: { host: string; username: string }) => EmbeddedDevice;
      computeHostKeyFingerprint: (key: string | Buffer) => { display: string; hex: string };
      parseFingerprint: (value: string) => { display: string; hex: string };
      verifyHostKey: (key: string | Buffer, expected?: { display: string; hex: string }) => boolean;
      verifyBastionHostKey: (
        key: string | Buffer,
        expected?: { display: string; hex: string }
      ) => boolean;
      hostKeyFailure?: { expected: string; received: string };
      bastionHostKeyFailure?: { expected: string; received: string };
      getErrorMessage: (err: unknown) => string;
      toError: (err: unknown, fallbackMessage: string) => Error;
      expandPath: (value: string) => string;
      loadPrivateKey: (filePath: string) => Promise<Buffer>;
      execLocalCommand: (command: string) => Promise<string>;
    };
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-explorer-key-'));
    const previousEnv = process.env.SFTP_EXPLORER_TEST_DIR;

    try {
      expect(explorer.normalizePath('remote', 'alpha/bravo')).toBe('/alpha/bravo');
      expect(explorer.isRoot('remote', '/')).toBe(true);
      expect(explorer.isRoot('local', path.parse(tempDir).root)).toBe(true);
      expect(explorer.getParentDir('remote', '/alpha/bravo')).toBe('/alpha');
      expect(explorer.formatPermissions(undefined)).toBe('---------');
      expect(explorer.formatPermissions(0o755)).toBe('rwxr-xr-x');
      expect(explorer.isExecutable(0o755)).toBe(true);
      expect(explorer.isExecutable(0o644)).toBe(false);
      expect(explorer.quoteRemotePath("/tmp/it's.sh")).toBe("'/tmp/it'\\''s.sh'");
      expect(explorer.sanitizeName(' user.name-1 ')).toBe('user.name-1');
      expect(explorer.sanitizeName('bad name!')).toBeUndefined();
      expect(explorer.parseGetentName('root:x:0:0:root:/root:/bin/bash\n')).toBe('root');
      expect(explorer.parseGetentName('')).toBeUndefined();
      expect(explorer.mergeMode(0o100644, 0o755)).toBe(0o100755);
      expect(explorer.validateDeviceConfiguration()).toBeUndefined();
      expect(explorer.getBastionConfig()).toEqual({
        host: 'bastion.example.com',
        username: 'jump-user',
        port: 22,
        hostFingerprint: undefined,
        privateKeyPath: undefined,
      });
      expect(
        explorer.getBastionDevice({ host: 'bastion.example.com', username: 'jump-user' })
      ).toEqual(
        expect.objectContaining({
          id: 'device-1-bastion',
          name: 'SFTP Device bastion',
          host: 'bastion.example.com',
          username: 'jump-user',
        })
      );

      const fingerprint = explorer.computeHostKeyFingerprint(Buffer.from('host-key'));
      expect(explorer.parseFingerprint(fingerprint.display)).toEqual(fingerprint);
      const hexFingerprint = fingerprint.hex.match(/../g)?.join(':');
      expect(explorer.parseFingerprint(hexFingerprint ?? fingerprint.hex)).toEqual({
        display: hexFingerprint ?? fingerprint.hex,
        hex: fingerprint.hex,
      });
      expect(() => explorer.parseFingerprint('invalid-fingerprint')).toThrow(
        'Device "SFTP Device" has an invalid host fingerprint.'
      );
      expect(explorer.verifyHostKey(Buffer.from('host-key'), fingerprint)).toBe(true);
      expect(explorer.verifyHostKey('00'.repeat(32), fingerprint)).toBe(false);
      expect(explorer.hostKeyFailure).toEqual({
        expected: fingerprint.display,
        received: expect.any(String),
      });
      expect(explorer.verifyBastionHostKey('11'.repeat(32), fingerprint)).toBe(false);
      expect(explorer.bastionHostKeyFailure).toEqual({
        expected: fingerprint.display,
        received: expect.any(String),
      });

      expect(explorer.getErrorMessage(new Error('boom'))).toBe('boom');
      expect(explorer.getErrorMessage('plain failure')).toBe('plain failure');
      expect(explorer.toError(new Error('existing'), 'fallback').message).toBe('existing');
      expect(explorer.toError('coerced', 'fallback').message).toBe('coerced');

      process.env.SFTP_EXPLORER_TEST_DIR = tempDir;
      const keyPath = path.join(tempDir, 'id_test');
      const emptyKeyPath = path.join(tempDir, 'id_empty');
      await fs.writeFile(keyPath, 'PRIVATE KEY DATA');
      await fs.writeFile(emptyKeyPath, '');

      expect(explorer.expandPath('${env:SFTP_EXPLORER_TEST_DIR}/id_test')).toBe(
        path.resolve(tempDir, 'id_test')
      );
      await expect(
        explorer.loadPrivateKey('${env:SFTP_EXPLORER_TEST_DIR}/id_test')
      ).resolves.toEqual(Buffer.from('PRIVATE KEY DATA'));
      await expect(
        explorer.loadPrivateKey('${env:SFTP_EXPLORER_TEST_DIR}/id_empty')
      ).rejects.toThrow('The private key file is empty.');
      await expect(explorer.execLocalCommand("printf 'hello'")).resolves.toBe('hello');

      const missingHostPanel = createExplorer({ host: ' ' });
      const missingUserPanel = createExplorer({ username: ' ' });
      const invalidPortPanel = createExplorer({ port: 0 });
      const invalidBastionPanel = createExplorer({
        bastion: {
          host: ' ',
          username: 'jump-user',
        },
      });

      expect(
        (
          missingHostPanel as unknown as { validateDeviceConfiguration: () => string | undefined }
        ).validateDeviceConfiguration()
      ).toBe('Device "SFTP Device" is missing a host.');
      expect(
        (
          missingUserPanel as unknown as { validateDeviceConfiguration: () => string | undefined }
        ).validateDeviceConfiguration()
      ).toBe('Device "SFTP Device" is missing a username.');
      expect(
        (
          invalidPortPanel as unknown as { validateDeviceConfiguration: () => string | undefined }
        ).validateDeviceConfiguration()
      ).toBe('Device "SFTP Device" has an invalid port.');
      expect(
        (
          invalidBastionPanel as unknown as {
            validateDeviceConfiguration: () => string | undefined;
          }
        ).validateDeviceConfiguration()
      ).toBe('Device "SFTP Device" is missing a bastion host.');

      missingHostPanel.dispose();
      missingUserPanel.dispose();
      invalidPortPanel.dispose();
      invalidBastionPanel.dispose();
    } finally {
      panel.dispose();
      if (previousEnv === undefined) {
        delete process.env.SFTP_EXPLORER_TEST_DIR;
      } else {
        process.env.SFTP_EXPLORER_TEST_DIR = previousEnv;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('covers remote SFTP helpers with an in-memory SFTP session', async () => {
    const panel = createExplorer();
    const explorer = panel as unknown as {
      sftp: MemorySftp;
      client?: {
        exec: (
          command: string,
          callback: (
            err: Error | undefined,
            stream: Readable & {
              stderr: Readable;
              emit: (event: string, ...args: unknown[]) => boolean;
            }
          ) => void
        ) => void;
        end: () => void;
      };
      remoteHome?: string;
      listRemote: (dirPath: string) => Promise<Array<{ name: string; type: string }>>;
      getRemoteHome: () => Promise<string>;
      createDirectory: (
        location: 'remote' | 'local',
        directoryPath: string,
        name: string
      ) => Promise<string>;
      createFile: (
        location: 'remote' | 'local',
        directoryPath: string,
        name: string
      ) => Promise<string>;
      renameEntry: (
        location: 'remote' | 'local',
        targetPath: string,
        newName: string
      ) => Promise<string>;
      duplicateEntry: (location: 'remote' | 'local', targetPath: string) => Promise<string>;
      copyEntry: (
        from: { location: 'remote' | 'local'; path: string },
        toDirectory: { location: 'remote' | 'local'; path: string }
      ) => Promise<string>;
      copyEntries: (
        items: { location: 'remote' | 'local'; path: string }[],
        toDirectory: { location: 'remote' | 'local'; path: string }
      ) => Promise<string>;
      applyPermissions: (
        location: 'remote' | 'local',
        targetPath: string,
        mode: number,
        owner?: number,
        group?: number
      ) => Promise<string>;
      applyPermissionsBatch: (
        location: 'remote' | 'local',
        paths: string[],
        mode: number
      ) => Promise<string>;
      getPermissionsInfo: (
        location: 'remote' | 'local',
        targetPath: string
      ) => Promise<{
        path: string;
        ownerName?: string;
        groupName?: string;
      }>;
      buildSearchEntries: (
        location: 'remote' | 'local',
        basePath: string,
        output: string
      ) => Promise<Array<{ fullPath: string; relativePath: string }>>;
      deleteEntry: (location: 'remote' | 'local', targetPath: string) => Promise<string>;
      deleteEntries: (location: 'remote' | 'local', paths: string[]) => Promise<string>;
    };
    const sftp = new MemorySftp();
    explorer.sftp = sftp;
    explorer.remoteHome = '/';
    explorer.client = {
      exec: (command, callback) => {
        const stream = new Readable({ read: () => undefined }) as Readable & {
          stderr: Readable;
          emit: (event: string, ...args: unknown[]) => boolean;
        };
        stream.stderr = new Readable({ read: () => undefined });
        callback(undefined, stream);
        queueMicrotask(() => {
          if (command.startsWith('getent passwd')) {
            stream.emit('data', Buffer.from('root:x:0:0:root:/root:/bin/sh\n'));
            stream.emit('exit', 0);
          } else if (command.startsWith('getent group')) {
            stream.emit('data', Buffer.from('root:x:0:\n'));
            stream.emit('exit', 0);
          } else {
            stream.emit('data', Buffer.from('1000\n'));
            stream.emit('exit', 0);
          }
          stream.emit('close');
        });
      },
      end: vi.fn(),
    };
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-remote-test-'));

    try {
      expect(await explorer.getRemoteHome()).toBe('/');
      expect(await explorer.listRemote('/')).toEqual([
        expect.objectContaining({ name: 'alpha', type: 'directory' }),
        expect.objectContaining({ name: 'script.sh', type: 'file' }),
      ]);

      await expect(explorer.createDirectory('remote', '/', 'bravo')).resolves.toBe('/');
      await expect(explorer.createFile('remote', '/bravo', 'note.txt')).resolves.toBe('/bravo');
      expect(sftp.nodes.has('/bravo/note.txt')).toBe(true);

      await expect(explorer.renameEntry('remote', '/bravo/note.txt', 'renamed.txt')).resolves.toBe(
        '/bravo'
      );
      expect(sftp.nodes.has('/bravo/renamed.txt')).toBe(true);

      await expect(explorer.duplicateEntry('remote', '/script.sh')).resolves.toBe('/');
      expect(sftp.nodes.has('/script (copy 1).sh')).toBe(true);

      await expect(explorer.duplicateEntry('remote', '/alpha')).resolves.toBe('/');
      expect(sftp.nodes.has('/alpha (copy 1)/child.txt')).toBe(true);

      await expect(
        explorer.copyEntry(
          { location: 'remote', path: '/script.sh' },
          { location: 'remote', path: '/bravo' }
        )
      ).resolves.toBe('/bravo');
      expect(sftp.nodes.has('/bravo/script.sh')).toBe(true);

      await expect(explorer.copyEntries([], { location: 'remote', path: '/bravo' })).resolves.toBe(
        '/bravo'
      );

      const localFile = path.join(tempDir, 'upload.txt');
      await fs.writeFile(localFile, 'upload');
      await expect(
        explorer.copyEntry(
          { location: 'local', path: localFile },
          { location: 'remote', path: '/bravo' }
        )
      ).resolves.toBe('/bravo');
      expect(sftp.nodes.get('/bravo/upload.txt')?.content).toBe('upload');

      await expect(
        explorer.copyEntry(
          { location: 'remote', path: '/script.sh' },
          { location: 'local', path: tempDir }
        )
      ).resolves.toBe(tempDir);
      await expect(fs.readFile(path.join(tempDir, 'script.sh'), 'utf8')).resolves.toContain(
        '#!/bin/sh'
      );

      await expect(
        explorer.applyPermissions('remote', '/script.sh', 0o600, 1001, 1002)
      ).resolves.toBe('/');
      expect(sftp.nodes.get('/script.sh')).toEqual(
        expect.objectContaining({ mode: 0o600, uid: 1001, gid: 1002 })
      );

      await expect(
        explorer.applyPermissionsBatch('remote', ['/script.sh', '/bravo/upload.txt'], 0o644)
      ).resolves.toBe('/');
      await expect(explorer.applyPermissionsBatch('remote', [], 0o644)).resolves.toBe('/');

      await expect(explorer.getPermissionsInfo('remote', '/script.sh')).resolves.toEqual(
        expect.objectContaining({
          path: '/script.sh',
          ownerName: 'root',
          groupName: 'root',
        })
      );

      await expect(
        explorer.buildSearchEntries('remote', '/', './script.sh\n./bravo/upload.txt\n')
      ).resolves.toEqual([
        expect.objectContaining({
          fullPath: '/bravo/upload.txt',
          relativePath: 'bravo/upload.txt',
        }),
        expect.objectContaining({ fullPath: '/script.sh', relativePath: 'script.sh' }),
      ]);

      await expect(explorer.deleteEntry('remote', '/bravo/upload.txt')).resolves.toBe('/bravo');
      expect(sftp.nodes.has('/bravo/upload.txt')).toBe(false);
      await expect(explorer.deleteEntries('remote', ['/alpha (copy 1)'])).resolves.toBe('/');
      expect(sftp.nodes.has('/alpha (copy 1)')).toBe(false);
      await expect(explorer.deleteEntries('remote', [])).resolves.toBe('/');
    } finally {
      panel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('opens local and remote files for viewing and syncs edited remote temp files', async () => {
    const panel = createExplorer();
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const explorer = panel as unknown as {
      sftp: MemorySftp;
      remoteHome?: string;
      viewedTempFiles: Map<string, { remotePath: string }>;
      viewContent: (location: 'remote' | 'local', targetPath: string) => Promise<void>;
      handleTempFileSave: (doc: { uri: { fsPath: string } }) => Promise<void>;
      handleTempFileClose: (doc: { uri: { fsPath: string } }) => Promise<void>;
    };
    const sftp = new MemorySftp();
    explorer.sftp = sftp;
    explorer.remoteHome = '/';
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-view-test-'));

    try {
      const localFile = path.join(tempDir, 'local.txt');
      await fs.writeFile(localFile, 'local contents');

      await explorer.viewContent('local', localFile);

      expect(window.showTextDocument).toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith({
        type: 'status',
        message: 'Opened local.txt from local.',
      });

      await explorer.viewContent('remote', '/script.sh');

      const [tempPath, mapping] = [...explorer.viewedTempFiles.entries()][0];
      expect(mapping).toEqual({ remotePath: '/script.sh' });
      await expect(fs.readFile(tempPath, 'utf8')).resolves.toContain('#!/bin/sh');
      expect(postMessage).toHaveBeenCalledWith({
        type: 'status',
        message: 'Opened script.sh from remote.',
      });

      await fs.writeFile(tempPath, '#!/bin/sh\necho edited\n');
      await explorer.handleTempFileSave({ uri: Uri.file(tempPath) });

      expect(sftp.nodes.get('/script.sh')?.content).toContain('echo edited');
      expect(postMessage).toHaveBeenCalledWith({
        type: 'status',
        message: 'Saved to remote: script.sh',
      });

      await explorer.handleTempFileClose({ uri: Uri.file(tempPath) });

      expect(explorer.viewedTempFiles.size).toBe(0);
      await expect(fs.stat(tempPath)).rejects.toThrow();
    } finally {
      panel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('opens local and remote terminals and rejects local file targets', async () => {
    const panel = createExplorer();
    const explorer = panel as unknown as {
      remoteHome?: string;
      openTerminal: (location: 'remote' | 'local', directoryPath: string) => Promise<void>;
      deleteEntries: (location: 'remote' | 'local', paths: string[]) => Promise<string>;
      applyPermissionsBatch: (
        location: 'remote' | 'local',
        paths: string[],
        mode: number
      ) => Promise<string>;
      refreshAfterMutation: (
        location: 'remote' | 'local',
        refreshDir: string,
        requestId: string
      ) => Promise<void>;
      listAndPost: ReturnType<typeof vi.fn>;
    };
    explorer.remoteHome = '/';
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-terminal-test-'));

    try {
      const folder = path.join(tempDir, 'folder');
      const file = path.join(tempDir, 'file.txt');
      await fs.mkdir(folder);
      await fs.writeFile(file, 'not a directory');

      await explorer.openTerminal('local', folder);
      expect(window.createTerminal).toHaveBeenCalledWith({
        name: 'Local: folder',
        cwd: folder,
      });

      await explorer.openTerminal('remote', '/alpha');
      expect(window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'SFTP Device SSH',
          pty: expect.any(Object),
        })
      );
      await explorer.openTerminal('remote', '');
      await explorer.openTerminal('local', '');
      expect(window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          name: `Local: ${path.basename(os.homedir()) || os.homedir()}`,
          cwd: os.homedir(),
        })
      );

      await expect(explorer.openTerminal('local', file)).rejects.toThrow(
        `Target path is not a directory: ${file}`
      );

      await expect(explorer.deleteEntries('local', [])).resolves.toBe(os.homedir());
      await expect(explorer.applyPermissionsBatch('local', [], 0o644)).resolves.toBe(os.homedir());
      explorer.listAndPost = vi.fn(async () => undefined);
      await explorer.refreshAfterMutation('remote', '/alpha', 'rightRemote');
      await explorer.refreshAfterMutation('local', folder, 'custom');
      expect(explorer.listAndPost).toHaveBeenCalledWith('remote', '/alpha', 'rightRemote', 'right');
      expect(explorer.listAndPost).toHaveBeenCalledWith('local', folder, 'custom', undefined);
    } finally {
      panel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('runs executable remote entries and rejects unsupported run targets', async () => {
    const panel = createExplorer();
    const explorer = panel as unknown as {
      sftp: MemorySftp;
      runEntry: (location: 'remote' | 'local', targetPath: string) => Promise<void>;
    };
    explorer.sftp = new MemorySftp();
    const runSpy = vi
      .spyOn(SshCommandRunner.prototype, 'run')
      .mockResolvedValue(' command output ');

    try {
      await explorer.runEntry('remote', '/script.sh');

      expect(window.withProgress).toHaveBeenCalledWith(
        {
          title: 'Running script.sh on SFTP Device',
          location: expect.any(Number),
        },
        expect.any(Function)
      );
      expect(runSpy).toHaveBeenCalledWith({
        name: '/script.sh',
        command: "'/script.sh'",
      });
      expect(window.showInformationMessage).toHaveBeenCalledWith('command output');

      await expect(explorer.runEntry('local', '/tmp/script.sh')).rejects.toThrow(
        'Running files is only supported for remote entries.'
      );
      await expect(explorer.runEntry('remote', '/alpha')).rejects.toThrow(
        'Cannot run a directory.'
      );
      await expect(explorer.runEntry('remote', '/alpha/child.txt')).rejects.toThrow(
        'The selected file is not executable.'
      );
    } finally {
      runSpy.mockRestore();
      panel.dispose();
    }
  });

  it('builds local search snapshots with relative paths and metadata', async () => {
    const panel = createExplorer();
    const explorer = panel as unknown as {
      buildSearchSnapshot: (
        location: 'remote' | 'local',
        search: { basePath: string; command: string; options: Record<string, unknown> }
      ) => Promise<{
        path: string;
        location: 'remote' | 'local';
        entries: Array<{ name: string; relativePath?: string; permissions?: string }>;
        search?: { command: string; options: Record<string, unknown> };
      }>;
    };
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-local-search-'));

    try {
      await fs.mkdir(path.join(tempDir, 'nested'));
      await fs.writeFile(path.join(tempDir, 'alpha.txt'), 'top-level');
      await fs.writeFile(path.join(tempDir, 'nested', 'alpha-child.txt'), 'child');
      await fs.writeFile(path.join(tempDir, 'nested', 'bravo.txt'), 'bravo');

      const snapshot = await explorer.buildSearchSnapshot('local', {
        basePath: tempDir,
        command: '',
        options: { name: 'alpha', includeSubdirectories: true },
      });

      expect(snapshot).toEqual(
        expect.objectContaining({
          path: tempDir,
          location: 'local',
          search: expect.objectContaining({
            command: expect.stringContaining('find .'),
            options: expect.objectContaining({
              name: 'alpha',
              includeSubdirectories: true,
            }),
          }),
          entries: [
            expect.objectContaining({
              name: 'alpha.txt',
              relativePath: 'alpha.txt',
              permissions: expect.any(String),
            }),
            expect.objectContaining({
              name: 'alpha-child.txt',
              relativePath: path.join('nested', 'alpha-child.txt'),
              permissions: expect.any(String),
            }),
          ],
        })
      );
    } finally {
      panel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prompts before overwriting existing files during copy operations', async () => {
    const panel = createExplorer();
    const explorer = panel as unknown as {
      copyEntry: (
        from: { location: 'remote' | 'local'; path: string },
        toDirectory: { location: 'remote' | 'local'; path: string }
      ) => Promise<string>;
    };
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-overwrite-test-'));

    try {
      const sourceDir = path.join(tempDir, 'source');
      const targetDir = path.join(tempDir, 'target');
      const sourceFile = path.join(sourceDir, 'same.txt');
      const targetFile = path.join(targetDir, 'same.txt');
      await fs.mkdir(sourceDir);
      await fs.mkdir(targetDir);
      await fs.writeFile(sourceFile, 'new contents');
      await fs.writeFile(targetFile, 'old contents');

      await expect(
        explorer.copyEntry(
          { location: 'local', path: sourceFile },
          { location: 'local', path: targetDir }
        )
      ).resolves.toBe(targetDir);
      await expect(fs.readFile(targetFile, 'utf8')).resolves.toBe('old contents');
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        'A file named "same.txt" already exists in the local destination. Overwrite it?',
        { modal: true },
        'Overwrite'
      );

      setWarningMessageResponse('Overwrite');
      await expect(
        explorer.copyEntry(
          { location: 'local', path: sourceFile },
          { location: 'local', path: targetDir }
        )
      ).resolves.toBe(targetDir);
      await expect(fs.readFile(targetFile, 'utf8')).resolves.toBe('new contents');
    } finally {
      panel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves stored password and private-key authentication without prompting', async () => {
    const context = createExtensionContext();
    const passwordDevice: EmbeddedDevice = { ...baseDevice, id: 'auth-password' };
    const passwordPanel = new SftpExplorerPanel(context, passwordDevice);
    const passwordManager = new PasswordManager(context);
    await passwordManager.storePassword(passwordDevice, 'stored-password');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-auth-test-'));

    try {
      const keyPath = path.join(tempDir, 'id_test');
      await fs.writeFile(keyPath, 'PRIVATE KEY DATA');

      await expect(
        (
          passwordPanel as unknown as {
            getAuthentication: () => Promise<{ password?: string }>;
          }
        ).getAuthentication()
      ).resolves.toEqual({ password: 'stored-password' });

      const keyDevice: EmbeddedDevice = {
        ...baseDevice,
        id: 'auth-key',
        privateKeyPath: keyPath,
        bastion: {
          host: 'jump.local',
          username: 'jump',
          privateKeyPath: keyPath,
        },
      };
      const keyPanel = new SftpExplorerPanel(context, keyDevice);
      const bastionDevice: EmbeddedDevice = {
        id: 'auth-key-bastion',
        name: 'SFTP Device bastion',
        host: 'jump.local',
        username: 'jump',
      };
      await passwordManager.storePassphrase(keyDevice, 'device-passphrase');
      await passwordManager.storePassphrase(bastionDevice, 'bastion-passphrase');

      const keyExplorer = keyPanel as unknown as {
        getAuthentication: () => Promise<{ privateKey?: Buffer; passphrase?: string }>;
        getBastionConfig: () => {
          host: string;
          username: string;
          privateKeyPath?: string;
        };
        getBastionAuthentication: (bastion: {
          host: string;
          username: string;
          privateKeyPath?: string;
        }) => Promise<{ privateKey?: Buffer; passphrase?: string }>;
      };

      await expect(keyExplorer.getAuthentication()).resolves.toEqual({
        privateKey: Buffer.from('PRIVATE KEY DATA'),
        passphrase: 'device-passphrase',
      });
      await expect(
        keyExplorer.getBastionAuthentication(keyExplorer.getBastionConfig())
      ).resolves.toEqual({
        privateKey: Buffer.from('PRIVATE KEY DATA'),
        passphrase: 'bastion-passphrase',
      });
      expect(window.showInputBox).not.toHaveBeenCalled();

      keyPanel.dispose();
    } finally {
      passwordPanel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('routes production webview messages through mutation and utility handlers', async () => {
    const panel = createProductionExplorer();
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const explorer = panel as unknown as {
      listAndPost: ReturnType<typeof vi.fn>;
      deleteEntry: ReturnType<typeof vi.fn>;
      deleteEntries: ReturnType<typeof vi.fn>;
      renameEntry: ReturnType<typeof vi.fn>;
      duplicateEntry: ReturnType<typeof vi.fn>;
      createDirectory: ReturnType<typeof vi.fn>;
      createFile: ReturnType<typeof vi.fn>;
      copyEntry: ReturnType<typeof vi.fn>;
      copyEntries: ReturnType<typeof vi.fn>;
      refreshAfterMutation: ReturnType<typeof vi.fn>;
      viewContent: ReturnType<typeof vi.fn>;
      runEntry: ReturnType<typeof vi.fn>;
      openTerminal: ReturnType<typeof vi.fn>;
      getPermissionsInfo: ReturnType<typeof vi.fn>;
      resolveOwnerGroupIds: ReturnType<typeof vi.fn>;
      applyPermissions: ReturnType<typeof vi.fn>;
      applyPermissionsBatch: ReturnType<typeof vi.fn>;
      saveSftpPresets: ReturnType<typeof vi.fn>;
      previewSearchCommand: ReturnType<typeof vi.fn>;
      searchAndPost: ReturnType<typeof vi.fn>;
    };

    explorer.listAndPost = vi.fn(async () => undefined);
    explorer.deleteEntry = vi.fn(async () => '/refresh');
    explorer.deleteEntries = vi.fn(async () => '/refresh');
    explorer.renameEntry = vi.fn(async () => '/refresh');
    explorer.duplicateEntry = vi.fn(async () => '/refresh');
    explorer.createDirectory = vi.fn(async () => '/refresh');
    explorer.createFile = vi.fn(async () => '/refresh');
    explorer.copyEntry = vi.fn(async () => '/target');
    explorer.copyEntries = vi.fn(async () => '/target');
    explorer.refreshAfterMutation = vi.fn(async () => undefined);
    explorer.viewContent = vi.fn(async () => undefined);
    explorer.runEntry = vi.fn(async () => undefined);
    explorer.openTerminal = vi.fn(async () => undefined);
    explorer.getPermissionsInfo = vi.fn(async () => ({
      path: '/file.txt',
      location: 'remote',
      name: 'file.txt',
      type: 'file',
      mode: 0o644,
    }));
    explorer.resolveOwnerGroupIds = vi.fn(async () => ({ owner: 1001, group: 1002 }));
    explorer.applyPermissions = vi.fn(async () => '/refresh');
    explorer.applyPermissionsBatch = vi.fn(async () => '/refresh');
    explorer.saveSftpPresets = vi.fn(async () => undefined);
    explorer.previewSearchCommand = vi.fn(() => ({
      basePath: '/',
      command: 'find . -type f',
      options: { includeSubdirectories: true },
    }));
    explorer.searchAndPost = vi.fn(async () => undefined);

    setWarningMessageResponse('Yes');
    setInputBoxResponse('typed-value');

    const messages = [
      { type: 'listEntries', location: 'remote', path: '/var', requestId: 'rightRemote' },
      { type: 'deleteEntry', location: 'remote', path: '/old.txt', requestId: 'remote' },
      { type: 'deleteEntries', location: 'local', paths: ['/a'], requestId: 'local' },
      {
        type: 'renameEntry',
        location: 'remote',
        path: '/old.txt',
        newName: 'new.txt',
        requestId: 'remote',
      },
      { type: 'duplicateEntry', location: 'local', path: '/a.txt', requestId: 'local' },
      {
        type: 'createDirectory',
        location: 'remote',
        path: '/',
        name: 'logs',
        requestId: 'remote',
      },
      { type: 'createFile', location: 'local', path: '/', name: 'note.txt', requestId: 'local' },
      {
        type: 'copyEntry',
        from: { location: 'remote', path: '/remote.txt' },
        toDirectory: { location: 'local', path: '/tmp' },
        requestId: 'local',
      },
      {
        type: 'copyEntries',
        items: [{ location: 'local', path: '/tmp/a.txt' }],
        toDirectory: { location: 'remote', path: '/upload' },
        requestId: 'remote',
      },
      { type: 'viewContent', location: 'remote', path: '/README.txt' },
      { type: 'runEntry', location: 'remote', path: '/script.sh' },
      { type: 'openTerminal', location: 'local', path: '/tmp' },
      {
        type: 'requestPermissionsInfo',
        location: 'remote',
        path: '/file.txt',
        requestId: 'perm-1',
      },
      {
        type: 'updatePermissions',
        location: 'remote',
        path: '/file.txt',
        mode: 0o600,
        owner: 'app',
        group: 'staff',
        requestId: 'remote',
      },
      {
        type: 'updatePermissionsBatch',
        location: 'local',
        paths: ['/a.txt', '/b.txt'],
        mode: 0o644,
        owner: 1001,
        requestId: 'local',
      },
      { type: 'requestConfirmation', message: 'Continue?', requestId: 'confirm-1' },
      { type: 'requestInput', prompt: 'Name', value: 'default', requestId: 'input-1' },
      { type: 'saveSftpPresets', location: 'remote', presets: ['/var/log'] },
      {
        type: 'previewSearchCommand',
        location: 'remote',
        basePath: '/',
        options: { name: 'log' },
        requestId: 'preview-1',
      },
      {
        type: 'searchEntries',
        location: 'remote',
        basePath: '/',
        options: { name: 'log' },
        requestId: 'rightRemote',
      },
    ];

    for (const message of messages) {
      webviewPanel.__fireMessage(message);
    }
    await flushAsync();

    expect(explorer.listAndPost).toHaveBeenCalledWith('remote', '/var', 'rightRemote', 'right');
    expect(explorer.deleteEntry).toHaveBeenCalledWith('remote', '/old.txt');
    expect(explorer.deleteEntries).toHaveBeenCalledWith('local', ['/a']);
    expect(explorer.renameEntry).toHaveBeenCalledWith('remote', '/old.txt', 'new.txt');
    expect(explorer.duplicateEntry).toHaveBeenCalledWith('local', '/a.txt');
    expect(explorer.createDirectory).toHaveBeenCalledWith('remote', '/', 'logs');
    expect(explorer.createFile).toHaveBeenCalledWith('local', '/', 'note.txt');
    expect(explorer.copyEntry).toHaveBeenCalledWith(
      { location: 'remote', path: '/remote.txt' },
      { location: 'local', path: '/tmp' }
    );
    expect(explorer.copyEntries).toHaveBeenCalledWith([{ location: 'local', path: '/tmp/a.txt' }], {
      location: 'remote',
      path: '/upload',
    });
    expect(explorer.viewContent).toHaveBeenCalledWith('remote', '/README.txt');
    expect(explorer.runEntry).toHaveBeenCalledWith('remote', '/script.sh');
    expect(explorer.openTerminal).toHaveBeenCalledWith('local', '/tmp');
    expect(explorer.resolveOwnerGroupIds).toHaveBeenCalledWith('remote', 'app', 'staff');
    expect(explorer.applyPermissions).toHaveBeenCalledWith(
      'remote',
      '/file.txt',
      0o600,
      1001,
      1002
    );
    expect(explorer.applyPermissionsBatch).toHaveBeenCalledWith(
      'local',
      ['/a.txt', '/b.txt'],
      0o644,
      1001,
      1002
    );
    expect(explorer.saveSftpPresets).toHaveBeenCalledWith('remote', ['/var/log']);
    expect(explorer.searchAndPost).toHaveBeenCalledWith(
      'remote',
      '/',
      { name: 'log' },
      'rightRemote'
    );
    expect(explorer.refreshAfterMutation).toHaveBeenCalledTimes(10);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'permissionsInfo',
      requestId: 'perm-1',
      info: expect.objectContaining({ path: '/file.txt' }),
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'confirmationResult',
      requestId: 'confirm-1',
      confirmed: true,
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'inputResult',
      requestId: 'input-1',
      value: 'typed-value',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'searchCommandPreview',
      requestId: 'preview-1',
      command: 'find . -type f',
    });

    panel.dispose();
  });

  it('posts production initial state using remote and local snapshots', async () => {
    const panel = createProductionExplorer({
      sftpPresetsRemote: ['/var/log'],
      sftpPresetsLocal: ['/tmp'],
    });
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const explorer = panel as unknown as {
      remotePaths: { left?: string; right?: string };
      getRemoteHome: ReturnType<typeof vi.fn>;
      buildSnapshot: ReturnType<typeof vi.fn>;
      postInitialState: () => Promise<void>;
    };

    explorer.getRemoteHome = vi.fn(async () => '/home/root');
    explorer.buildSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        path: '/home/root',
        parentPath: '/home',
        isRoot: false,
        entries: [],
        location: 'remote',
      })
      .mockResolvedValueOnce({
        path: os.homedir(),
        parentPath: path.dirname(os.homedir()),
        isRoot: false,
        entries: [],
        location: 'local',
      });

    await explorer.postInitialState();

    expect(explorer.buildSnapshot).toHaveBeenNthCalledWith(1, 'remote', '/home/root');
    expect(explorer.buildSnapshot).toHaveBeenNthCalledWith(2, 'local', os.homedir());
    expect(explorer.remotePaths).toEqual({ left: '/home/root', right: '/home/root' });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'connected',
      countdownSeconds: undefined,
      message: 'Connected',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'init',
      remoteHome: '/home/root',
      localHome: os.homedir(),
      remote: expect.objectContaining({ location: 'remote' }),
      local: expect.objectContaining({ location: 'local' }),
      sftpPresetsRemote: ['/var/log'],
      sftpPresetsLocal: ['/tmp'],
    });

    panel.dispose();
  });

  it('builds production snapshots and updates remote pane paths', async () => {
    const panel = createProductionExplorer();
    const explorer = panel as unknown as {
      sftp: MemorySftp;
      remotePaths: { left?: string; right?: string };
      buildSnapshot: (
        location: 'remote' | 'local',
        dirPath: string,
        context?: 'left' | 'right'
      ) => Promise<{
        path: string;
        parentPath: string;
        isRoot: boolean;
        location: 'remote' | 'local';
        entries: Array<{ name: string; type: 'file' | 'directory' }>;
      }>;
    };
    explorer.sftp = new MemorySftp();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-snapshot-test-'));

    try {
      await fs.writeFile(path.join(tempDir, 'local.txt'), 'local');

      await expect(explorer.buildSnapshot('remote', '/alpha', 'right')).resolves.toEqual(
        expect.objectContaining({
          path: '/alpha',
          parentPath: '/',
          isRoot: false,
          location: 'remote',
          entries: [expect.objectContaining({ name: 'child.txt', type: 'file' })],
        })
      );
      expect(explorer.remotePaths.right).toBe('/alpha');

      await expect(explorer.buildSnapshot('local', tempDir)).resolves.toEqual(
        expect.objectContaining({
          path: tempDir,
          parentPath: path.dirname(tempDir),
          isRoot: false,
          location: 'local',
          entries: [expect.objectContaining({ name: 'local.txt', type: 'file' })],
        })
      );
    } finally {
      panel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reconnects and refreshes active remote panes', async () => {
    const panel = createProductionExplorer();
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const explorer = panel as unknown as {
      activeSearches: Map<
        string,
        { basePath: string; options: Record<string, unknown>; command: string }
      >;
      remotePaths: { left?: string; right?: string };
      remoteHome?: string;
      sftp?: MemorySftp;
      createSftpConnection: ReturnType<typeof vi.fn>;
      searchAndPost: ReturnType<typeof vi.fn>;
      listAndPost: ReturnType<typeof vi.fn>;
      startReconnectCountdown: ReturnType<typeof vi.fn>;
      attemptReconnect: () => Promise<void>;
      refreshRemoteViewsAfterReconnect: () => Promise<void>;
    };

    explorer.activeSearches.set('remote', {
      basePath: '/var',
      command: 'find .',
      options: { name: 'log' },
    });
    explorer.activeSearches.set('rightRemote', {
      basePath: '/opt',
      command: 'find .',
      options: { name: 'txt' },
    });
    explorer.createSftpConnection = vi.fn(async () => new MemorySftp());
    explorer.searchAndPost = vi.fn(async () => undefined);
    explorer.listAndPost = vi.fn(async () => undefined);

    await explorer.attemptReconnect();

    expect(explorer.sftp).toBeInstanceOf(MemorySftp);
    expect(explorer.searchAndPost).toHaveBeenCalledWith(
      'remote',
      '/var',
      { name: 'log' },
      'remote'
    );
    expect(explorer.searchAndPost).toHaveBeenCalledWith(
      'remote',
      '/opt',
      { name: 'txt' },
      'rightRemote'
    );
    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'reconnecting',
      countdownSeconds: undefined,
      message: 'Reconnecting…',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'connected',
      countdownSeconds: undefined,
      message: 'Connected',
    });

    explorer.activeSearches.clear();
    explorer.remoteHome = '/';
    explorer.remotePaths = { left: '/var', right: '/opt' };
    explorer.searchAndPost.mockClear();
    explorer.listAndPost.mockClear();
    await explorer.refreshRemoteViewsAfterReconnect();
    expect(explorer.listAndPost).toHaveBeenCalledWith('remote', '/var', 'remote', 'left');
    expect(explorer.listAndPost).toHaveBeenCalledWith('remote', '/opt', 'rightRemote', 'right');

    explorer.createSftpConnection = vi.fn(async () => {
      throw new Error('network down');
    });
    explorer.startReconnectCountdown = vi.fn();
    await explorer.attemptReconnect();
    expect(postMessage).toHaveBeenCalledWith({ type: 'error', message: 'network down' });
    expect(window.showErrorMessage).toHaveBeenCalledWith('network down');
    expect(explorer.startReconnectCountdown).toHaveBeenCalled();

    panel.dispose();
  });

  it('falls back across configured SFTP endpoints before succeeding', async () => {
    const panel = createProductionExplorer({ secondaryHost: 'backup.local' });
    const explorer = panel as unknown as {
      activeEndpoint?: { host: string; label: string };
      getAuthentication: ReturnType<typeof vi.fn>;
      getBastionConfig: ReturnType<typeof vi.fn>;
      getExpectedFingerprint: ReturnType<typeof vi.fn>;
      connectToEndpoint: ReturnType<typeof vi.fn>;
      createSftpConnection: (isReconnect: boolean) => Promise<MemorySftp>;
    };
    const sftp = new MemorySftp();

    explorer.getAuthentication = vi.fn(async () => ({ password: 'secret' }));
    explorer.getBastionConfig = vi.fn(() => undefined);
    explorer.getExpectedFingerprint = vi.fn(() => undefined);
    explorer.connectToEndpoint = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValueOnce(sftp);

    await expect(explorer.createSftpConnection(false)).resolves.toBe(sftp);

    expect(explorer.connectToEndpoint).toHaveBeenNthCalledWith(
      1,
      { host: 'device.local', fingerprint: undefined, label: 'primary' },
      { password: 'secret' },
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(explorer.connectToEndpoint).toHaveBeenNthCalledWith(
      2,
      { host: 'backup.local', fingerprint: undefined, label: 'secondary' },
      { password: 'secret' },
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(explorer.activeEndpoint).toEqual({ host: 'backup.local', label: 'secondary' });

    panel.dispose();
  });

  it('covers lookup helpers, remote home resolution, and remote exec failures', async () => {
    const panel = createProductionExplorer();
    const explorer = panel as unknown as {
      sftp?: MemorySftp;
      remoteHome?: string;
      client?: {
        exec: (
          command: string,
          callback: (
            err: Error | undefined,
            stream: Readable & {
              stderr: Readable;
              emit: (event: string, ...args: unknown[]) => boolean;
            }
          ) => void
        ) => void;
      };
      getRemoteHome: () => Promise<string>;
      getEntryStats: (location: 'remote' | 'local', targetPath: string) => Promise<Stats>;
      getPermissionsInfo: (location: 'remote' | 'local', targetPath: string) => Promise<unknown>;
      lookupLocalName: (kind: 'user' | 'group', id?: number) => Promise<string | undefined>;
      lookupLocalId: (kind: 'user' | 'group', name: string) => Promise<number | undefined>;
      lookupRemoteName: (kind: 'user' | 'group', id?: number) => Promise<string | undefined>;
      lookupRemoteId: (kind: 'user' | 'group', name: string) => Promise<number | undefined>;
      resolveOwnerGroupNames: (
        location: 'remote' | 'local',
        owner?: number,
        group?: number
      ) => Promise<{ ownerName?: string; groupName?: string }>;
      resolveOwnerGroupIds: (
        location: 'remote' | 'local',
        owner?: number | string,
        group?: number | string
      ) => Promise<{ owner?: number; group?: number }>;
      execRemoteCommand: (command: string) => Promise<string>;
      searchAndPost: (
        location: 'remote' | 'local',
        basePath: string,
        options: Record<string, unknown>,
        requestId: 'remote' | 'local' | 'rightRemote'
      ) => Promise<void>;
    };
    const sftp = new MemorySftp();
    explorer.sftp = sftp;

    await expect(explorer.getRemoteHome()).resolves.toBe('/');
    await expect(explorer.getEntryStats('remote', '/missing.txt')).rejects.toThrow('missing');

    sftp.nodes.set('/no-mode.txt', {
      type: 'file',
      content: 'x',
      mode: undefined as unknown as number,
    });
    await expect(explorer.getPermissionsInfo('remote', '/no-mode.txt')).rejects.toThrow(
      'Unable to read permissions for the selected entry.'
    );

    await expect(explorer.lookupLocalName('user')).resolves.toBeUndefined();
    await expect(explorer.lookupLocalName('user', 0)).resolves.toBeDefined();
    await expect(explorer.lookupLocalName('user', -99999)).resolves.toBeUndefined();
    await expect(explorer.lookupLocalId('user', 'root')).resolves.toEqual(expect.any(Number));
    await expect(explorer.lookupLocalId('user', 'bad name!')).rejects.toThrow(
      'Names may only include letters, numbers, underscore, dash, or dot.'
    );
    await expect(
      explorer.lookupLocalId('user', 'definitely_missing_user_zz')
    ).resolves.toBeUndefined();
    await expect(explorer.resolveOwnerGroupNames('local', 0, 0)).resolves.toEqual(
      expect.objectContaining({
        ownerName: expect.any(String),
        groupName: expect.any(String),
      })
    );
    await expect(explorer.resolveOwnerGroupIds('local', 1001, 1002)).resolves.toEqual({
      owner: 1001,
      group: 1002,
    });

    explorer.client = undefined;
    await expect(explorer.execRemoteCommand('whoami')).rejects.toThrow(
      'SSH client is not connected.'
    );

    explorer.client = {
      exec: (_command, callback) => {
        const stream = new Readable({ read: () => undefined }) as Readable & {
          stderr: Readable;
          emit: (event: string, ...args: unknown[]) => boolean;
        };
        stream.stderr = new Readable({ read: () => undefined });
        callback(new Error('exec failed'), stream);
      },
      end: vi.fn(),
    };
    await expect(explorer.execRemoteCommand('bad')).rejects.toThrow('exec failed');

    explorer.client = {
      exec: (_command, callback) => {
        const stream = new Readable({ read: () => undefined }) as Readable & {
          stderr: Readable;
          emit: (event: string, ...args: unknown[]) => boolean;
        };
        stream.stderr = new Readable({ read: () => undefined });
        callback(undefined, stream);
        queueMicrotask(() => {
          stream.stderr.emit('data', Buffer.from('permission denied'));
          stream.emit('exit', 1);
          stream.emit('close');
        });
      },
      end: vi.fn(),
    };
    await expect(explorer.execRemoteCommand('bad')).rejects.toThrow('permission denied');

    explorer.client = {
      exec: (command, callback) => {
        const stream = new Readable({ read: () => undefined }) as Readable & {
          stderr: Readable;
          emit: (event: string, ...args: unknown[]) => boolean;
        };
        stream.stderr = new Readable({ read: () => undefined });
        callback(undefined, stream);
        queueMicrotask(() => {
          if (command.startsWith('getent passwd')) {
            stream.emit('data', Buffer.from('root:x:0:0:root:/root:/bin/sh\n'));
            stream.emit('exit', 0);
          } else if (command.startsWith('id -u')) {
            stream.emit('data', Buffer.from('0\n'));
            stream.emit('exit', 0);
          } else {
            stream.emit('exit', 1);
          }
          stream.emit('close');
        });
      },
      end: vi.fn(),
    };
    await expect(explorer.lookupRemoteName('user')).resolves.toBeUndefined();
    await expect(explorer.lookupRemoteName('user', -1)).resolves.toBeUndefined();
    await expect(explorer.lookupRemoteName('user', 0)).resolves.toBe('root');
    await expect(explorer.lookupRemoteId('user', 'root')).resolves.toBe(0);
    await expect(explorer.lookupRemoteId('user', 'bad name!')).rejects.toThrow(
      'Names may only include letters, numbers, underscore, dash, or dot.'
    );

    explorer.client = {
      exec: (_command, callback) => {
        const stream = new Readable({ read: () => undefined }) as Readable & {
          stderr: Readable;
          emit: (event: string, ...args: unknown[]) => boolean;
        };
        stream.stderr = new Readable({ read: () => undefined });
        callback(undefined, stream);
        queueMicrotask(() => {
          stream.emit('exit', 2);
          stream.emit('close');
        });
      },
      end: vi.fn(),
    };
    await expect(explorer.execRemoteCommand('bad')).rejects.toThrow('Command exited with code 2');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-search-and-post-'));
    try {
      await fs.writeFile(path.join(tempDir, 'one.txt'), 'one');
      await explorer.searchAndPost(
        'local',
        tempDir,
        { name: 'one', includeSubdirectories: false },
        'local'
      );
      expect(
        getCreatedWebviews()[0].webview.postMessage as unknown as vi.Mock
      ).toHaveBeenCalledWith({
        type: 'status',
        message: `Found 1 file from ${tempDir}.`,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    panel.dispose();
  });

  it('covers filesystem validation and conflict branches', async () => {
    const panel = createProductionExplorer();
    const explorer = panel as unknown as {
      validateEntryName: (name: string) => string;
      assertDirectory: (location: 'remote' | 'local', dirPath: string) => Promise<void>;
      ensureDirectoryExists: (location: 'remote' | 'local', dirPath: string) => Promise<void>;
      createDirectory: (
        location: 'remote' | 'local',
        directoryPath: string,
        name: string
      ) => Promise<string>;
      createFile: (
        location: 'remote' | 'local',
        directoryPath: string,
        name: string
      ) => Promise<string>;
      copyEntry: (
        from: { location: 'remote' | 'local'; path: string },
        toDirectory: { location: 'remote' | 'local'; path: string }
      ) => Promise<string>;
      viewContent: (location: 'remote' | 'local', targetPath: string) => Promise<void>;
      applyPermissions: (
        location: 'remote' | 'local',
        targetPath: string,
        mode: number,
        owner?: number,
        group?: number
      ) => Promise<string>;
    };
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-validation-test-'));

    try {
      const sourceDir = path.join(tempDir, 'source');
      const targetDir = path.join(tempDir, 'target');
      const sourceFile = path.join(sourceDir, 'entry.txt');
      const targetFile = path.join(targetDir, 'entry.txt');
      const targetSubdir = path.join(targetDir, 'folder');
      const noOwnerStatsFile = path.join(tempDir, 'no-owner.txt');

      await fs.mkdir(sourceDir);
      await fs.mkdir(targetDir);
      await fs.mkdir(targetSubdir);
      await fs.mkdir(path.join(targetDir, 'source'));
      await fs.writeFile(sourceFile, 'source');
      await fs.writeFile(targetFile, 'target');
      await fs.writeFile(noOwnerStatsFile, 'x');

      expect(() => explorer.validateEntryName('  ')).toThrow('A name is required.');
      expect(() => explorer.validateEntryName('bad/name')).toThrow(
        'Names must not include path separators.'
      );
      await expect(explorer.assertDirectory('local', sourceFile)).rejects.toThrow(
        'Destination path must be a directory.'
      );
      await expect(
        explorer.ensureDirectoryExists('local', path.join(tempDir, 'missing'))
      ).rejects.toThrow(`Local path not found: ${path.join(tempDir, 'missing')}`);
      await expect(explorer.createDirectory('local', tempDir, 'target')).rejects.toThrow(
        'An entry with that name already exists.'
      );
      await expect(explorer.createFile('local', tempDir, 'no-owner.txt')).rejects.toThrow(
        'An entry with that name already exists.'
      );
      await expect(
        explorer.copyEntry(
          { location: 'local', path: sourceDir },
          { location: 'local', path: targetDir }
        )
      ).rejects.toThrow('An entry with the same name already exists in the destination.');
      await expect(
        explorer.copyEntry(
          { location: 'local', path: sourceFile },
          { location: 'local', path: targetSubdir }
        )
      ).resolves.toBe(targetSubdir);
      await expect(explorer.viewContent('local', sourceDir)).rejects.toThrow(
        'Only files can be opened for viewing.'
      );

      const getEntryStatsSpy = vi.spyOn(explorer, 'getEntryStats' as never).mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 1,
        mode: 0o644,
      });
      await expect(
        explorer.applyPermissions('local', noOwnerStatsFile, 0o600, 1001)
      ).rejects.toThrow(
        'Unable to change owner or group because current identifiers are unavailable.'
      );
      getEntryStatsSpy.mockRestore();
    } finally {
      panel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('covers additional test-mode message branches and search filtering paths', async () => {
    const panel = createExplorer();
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const explorer = panel as unknown as {
      collectTestSearchEntries: (
        basePath: string,
        options: Record<string, unknown>
      ) => Array<{ fullPath?: string; relativePath?: string }>;
      handleTestMessage: (message: Record<string, unknown>) => boolean;
    };

    expect(
      explorer.collectTestSearchEntries('/alpha', {
        name: 'nested',
        includeSubdirectories: true,
        content: 'nested alpha',
        contentCaseSensitive: true,
      })
    ).toEqual([
      expect.objectContaining({
        fullPath: '/alpha/alpha-sub/nested.txt',
        relativePath: 'alpha-sub/nested.txt',
      }),
    ]);
    expect(
      explorer.collectTestSearchEntries('/alpha', {
        name: 'missing',
        includeSubdirectories: true,
      })
    ).toEqual([]);
    expect(
      explorer.collectTestSearchEntries('/alpha', {
        content: 'MISSING',
        includeSubdirectories: true,
        contentCaseSensitive: true,
      })
    ).toEqual([]);

    const ignoredMessages = [
      { type: 'deleteEntry', location: 'remote', path: '/alpha', requestId: 'remote' },
      { type: 'deleteEntries', location: 'remote', paths: ['/alpha'], requestId: 'remote' },
      { type: 'renameEntry', location: 'remote', path: '/a', newName: 'b', requestId: 'remote' },
      { type: 'duplicateEntry', location: 'remote', path: '/a', requestId: 'remote' },
      { type: 'createDirectory', location: 'remote', path: '/', name: 'x', requestId: 'remote' },
      { type: 'createFile', location: 'remote', path: '/', name: 'x', requestId: 'remote' },
      {
        type: 'copyEntry',
        from: { location: 'remote', path: '/a' },
        toDirectory: { location: 'local', path: '/tmp' },
        requestId: 'local',
      },
      {
        type: 'copyEntries',
        items: [{ location: 'remote', path: '/a' }],
        toDirectory: { location: 'local', path: '/tmp' },
        requestId: 'local',
      },
      {
        type: 'updatePermissions',
        location: 'remote',
        path: '/a',
        mode: 0o644,
        requestId: 'remote',
      },
      {
        type: 'updatePermissionsBatch',
        location: 'remote',
        paths: ['/a'],
        mode: 0o644,
        requestId: 'remote',
      },
      { type: 'runEntry', location: 'remote', path: '/a', requestId: 'remote' },
      { type: 'viewContent', location: 'remote', path: '/a' },
      { type: 'openTerminal', location: 'remote', path: '/a' },
      { type: 'requestConfirmation', message: 'Continue?', requestId: 'confirm' },
    ];

    for (const message of ignoredMessages) {
      expect(explorer.handleTestMessage(message)).toBe(true);
    }
    expect(explorer.handleTestMessage({ type: 'requestInit' })).toBe(false);
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));

    panel.dispose();
  });

  it('covers SFTP snapshot, lookup, and lifecycle error branches', async () => {
    const panel = createProductionExplorer();
    const webviewPanel = getCreatedWebviews()[0];
    const postMessage = webviewPanel.webview.postMessage as unknown as vi.Mock;
    const explorer = panel as unknown as {
      sftp?: MemorySftp;
      sftpReady?: Promise<MemorySftp>;
      hasEverConnected?: boolean;
      remoteHome?: string;
      remotePaths: { left?: string; right?: string };
      viewedTempFiles: Map<string, { remotePath: string }>;
      ensureSftp: () => Promise<MemorySftp>;
      createSftpConnection: ReturnType<typeof vi.fn>;
      buildSearchEntries: (
        location: 'remote' | 'local',
        basePath: string,
        output: string
      ) => Promise<Array<{ fullPath: string; relativePath: string; modified?: number }>>;
      buildSearchSnapshot: (
        location: 'remote' | 'local',
        search: { basePath: string; command: string; options: Record<string, unknown> },
        context?: 'left' | 'right'
      ) => Promise<unknown>;
      buildSnapshot: (
        location: 'remote' | 'local',
        dirPath: string,
        context?: 'left' | 'right'
      ) => Promise<{ path: string }>;
      getRemoteHome: () => Promise<string>;
      getEntryStats: (location: 'remote' | 'local', targetPath: string) => Promise<Stats>;
      resolveOwnerGroupIds: (
        location: 'remote' | 'local',
        owner?: number | string,
        group?: number | string
      ) => Promise<{ owner?: number; group?: number }>;
      applyMode: (location: 'remote' | 'local', targetPath: string, mode?: number) => Promise<void>;
      refreshRemoteViewsAfterReconnect: () => Promise<void>;
      searchAndPost: ReturnType<typeof vi.fn>;
      listAndPost: ReturnType<typeof vi.fn>;
      cleanupTempFiles: () => Promise<void>;
      startReconnectCountdown: () => void;
      handleDisconnect: () => void;
      updateConnectionStatus: (
        state: 'connected' | 'disconnected' | 'reconnecting',
        countdownSeconds?: number,
        overrideMessage?: string
      ) => void;
    };
    const sftp = new MemorySftp();
    explorer.sftp = sftp;

    const getEntryStatsSpy = vi
      .spyOn(explorer, 'getEntryStats' as never)
      .mockImplementation(async (_location: 'remote' | 'local', targetPath: string) => {
        if (targetPath.endsWith('dir')) {
          return {
            isFile: () => false,
            isDirectory: () => true,
            size: 0,
            mode: 0o755,
          };
        }
        if (targetPath.endsWith('date.txt')) {
          return {
            isFile: () => true,
            isDirectory: () => false,
            size: 10,
            mode: 0o644,
            mtime: new Date('2025-01-01T00:00:00Z'),
          };
        }
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: 20,
          mode: 0o755,
          mtimeMs: undefined,
          mtime: undefined,
        };
      });

    await expect(
      explorer.buildSearchEntries('remote', '/base', './date.txt\n./dir\n./plain.txt\n')
    ).resolves.toEqual([
      expect.objectContaining({
        fullPath: '/base/date.txt',
        relativePath: 'date.txt',
        modified: Date.parse('2025-01-01T00:00:00Z'),
      }),
      expect.objectContaining({
        fullPath: '/base/plain.txt',
        relativePath: 'plain.txt',
        modified: undefined,
      }),
    ]);
    getEntryStatsSpy.mockRestore();

    await expect(explorer.buildSnapshot('remote', '', 'left')).resolves.toEqual(
      expect.objectContaining({ path: '/' })
    );
    expect(explorer.remotePaths.left).toBe('/');

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: String.fromCharCode(97, 105, 120) });
    try {
      await expect(
        explorer.buildSearchSnapshot('local', {
          basePath: os.homedir(),
          command: '',
          options: {},
        })
      ).rejects.toThrow('Local file search is only supported');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }

    explorer.sftp = undefined;
    explorer.sftpReady = Promise.resolve(sftp);
    await expect(explorer.ensureSftp()).resolves.toBe(sftp);
    explorer.sftp = undefined;
    explorer.sftpReady = undefined;
    explorer.createSftpConnection = vi.fn(async () => sftp);
    await expect(explorer.ensureSftp()).resolves.toBe(sftp);
    expect(explorer.hasEverConnected).toBe(true);

    const brokenHome = new MemorySftp();
    brokenHome.realpath = (_pathValue, callback) => callback(undefined, undefined);
    explorer.sftp = brokenHome;
    explorer.remoteHome = undefined;
    await expect(explorer.getRemoteHome()).rejects.toThrow(
      'Unable to resolve remote home directory.'
    );

    sftp.stat = (_targetPath, callback) => callback(undefined, undefined);
    explorer.sftp = sftp;
    await expect(explorer.getEntryStats('remote', '/missing')).rejects.toThrow(
      'Unable to read remote file information.'
    );

    explorer.searchAndPost = vi.fn(async () => undefined);
    explorer.listAndPost = vi.fn(async () => undefined);
    explorer.remoteHome = '/';
    explorer.remotePaths = { left: '/same', right: '/same' };
    await explorer.refreshRemoteViewsAfterReconnect();
    expect(explorer.listAndPost).toHaveBeenCalledWith('remote', '/same', 'remote', 'left');
    expect(explorer.listAndPost).toHaveBeenCalledTimes(1);

    await expect(
      explorer.resolveOwnerGroupIds('remote', undefined, 'missing_group')
    ).rejects.toThrow('Unable to resolve group name "missing_group".');
    await expect(explorer.applyMode('remote', '/script.sh', undefined)).resolves.toBeUndefined();

    explorer.updateConnectionStatus('disconnected');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'disconnected',
      countdownSeconds: undefined,
      message: 'Disconnected. Reconnecting…',
    });

    explorer.viewedTempFiles.set('/tmp/does-not-exist-sftp-test', { remotePath: '/script.sh' });
    await expect(explorer.cleanupTempFiles()).resolves.toBeUndefined();

    panel.dispose();
  });

  it('routes SFTP endpoint connections and skips dot entries during directory downloads', async () => {
    const panel = createProductionExplorer();
    const explorer = panel as unknown as {
      sftp?: {
        readdir: (
          dirPath: string,
          callback: (err: Error | undefined, items?: unknown[]) => void
        ) => void;
      };
      connectThroughBastion: ReturnType<typeof vi.fn>;
      connectDirect: ReturnType<typeof vi.fn>;
      connectToEndpoint: (
        endpoint: { host: string; label: 'primary' },
        auth: { password: string },
        expectedFingerprint?: { display: string; hex: string },
        bastion?: { host: string; username: string },
        bastionAuth?: { password: string },
        expectedBastionFingerprint?: { display: string; hex: string }
      ) => Promise<MemorySftp>;
      downloadDirectory: (
        remoteSource: string,
        localDestination: string,
        mode?: number
      ) => Promise<void>;
      downloadFile: ReturnType<typeof vi.fn>;
      applyMode: ReturnType<typeof vi.fn>;
    };
    const sftp = new MemorySftp();
    explorer.connectThroughBastion = vi.fn(async () => sftp);
    explorer.connectDirect = vi.fn(async () => sftp);

    await expect(
      explorer.connectToEndpoint(
        { host: 'device.local', label: 'primary' },
        { password: 'device' },
        undefined,
        { host: 'jump.local', username: 'jump' },
        { password: 'jump' }
      )
    ).resolves.toBe(sftp);
    expect(explorer.connectThroughBastion).toHaveBeenCalledWith(
      { host: 'device.local', label: 'primary' },
      { password: 'device' },
      undefined,
      { host: 'jump.local', username: 'jump' },
      { password: 'jump' },
      undefined
    );

    await expect(
      explorer.connectToEndpoint({ host: 'device.local', label: 'primary' }, { password: 'device' })
    ).resolves.toBe(sftp);
    expect(explorer.connectDirect).toHaveBeenCalledWith(
      { host: 'device.local', label: 'primary' },
      { password: 'device' },
      undefined
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-dot-download-'));
    explorer.sftp = {
      readdir: (_dirPath, callback) =>
        callback(undefined, [
          { filename: '.', attrs: { isDirectory: () => true, mode: 0o755 } },
          { filename: '..', attrs: { isDirectory: () => true, mode: 0o755 } },
          { filename: 'plain.txt', attrs: { isDirectory: () => false, mode: 0o644 } },
        ]),
    };
    explorer.downloadFile = vi.fn(async () => undefined);
    explorer.applyMode = vi.fn(async () => undefined);

    try {
      await explorer.downloadDirectory('/remote', path.join(tempDir, 'downloaded'), 0o755);
      expect(explorer.downloadFile).toHaveBeenCalledTimes(1);
      expect(explorer.downloadFile).toHaveBeenCalledWith(
        '/remote/plain.txt',
        path.join(tempDir, 'downloaded', 'plain.txt'),
        0o644
      );
    } finally {
      panel.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('covers path, permission, fingerprint, status, and error helper branches', () => {
    const panel = createExplorer({
      bastion: {
        host: ' jump.local ',
        username: ' jump ',
        port: undefined,
        hostFingerprint: ' SHA256:abc ',
        privateKeyPath: ' ~/.ssh/id_ed25519 ',
      },
    });
    const internals = getInternals(panel);
    const postMessage = getCreatedWebviews()[0].webview.postMessage as unknown as vi.Mock;

    expect(internals.normalizePath('remote', '')).toBe('/');
    expect(internals.normalizePath('remote', 'var/../log')).toBe('/log');
    expect(internals.normalizePath('local', '')).toBe(path.resolve(os.homedir()));
    expect(internals.isRoot('remote', '/')).toBe(true);
    expect(internals.isRoot('remote', '/tmp')).toBe(false);
    expect(internals.isRoot('local', path.parse(process.cwd()).root)).toBe(true);
    expect(internals.getParentDir('remote', '/')).toBe('/');
    expect(internals.getParentDir('remote', '/var/log')).toBe('/var');
    expect(internals.getParentDir('local', path.join(process.cwd(), 'file.txt'))).toBe(
      process.cwd()
    );

    expect(internals.formatPermissions()).toBe('---------');
    expect(internals.formatPermissions(0)).toBe('---------');
    expect(internals.formatPermissions(0o755)).toBe('rwxr-xr-x');
    expect(internals.isExecutable()).toBe(false);
    expect(internals.isExecutable(0o644)).toBe(false);
    expect(internals.isExecutable(0o111)).toBe(true);
    expect(internals.quoteRemotePath("a'b")).toBe("'a'\\''b'");

    expect(internals.validateEntryName(' name.txt ')).toBe('name.txt');
    expect(() => internals.validateEntryName('   ')).toThrow('A name is required.');
    expect(() => internals.validateEntryName('a/b')).toThrow(
      'Names must not include path separators.'
    );
    expect(internals.sanitizeName()).toBeUndefined();
    expect(internals.sanitizeName(' bad name ')).toBeUndefined();
    expect(internals.sanitizeName('valid.name-1_')).toBe('valid.name-1_');
    expect(internals.parseGetentName('')).toBeUndefined();
    expect(internals.parseGetentName('root:x:0:0:root:/root:/bin/sh')).toBe('root');
    expect(internals.mergeMode(undefined, 0o755)).toBe(0o755);
    expect(internals.mergeMode(0o100000, 0o644)).toBe(0o100644);

    expect(internals.getBastionConfig()).toEqual(
      expect.objectContaining({
        host: 'jump.local',
        username: 'jump',
        port: 22,
        hostFingerprint: 'SHA256:abc',
        privateKeyPath: '~/.ssh/id_ed25519',
      })
    );
    expect(
      getInternals(createExplorer({ bastion: { host: ' ', username: 'jump' } })).getBastionConfig()
    ).toBeUndefined();
    expect(internals.getBastionDevice({ host: 'jump.local', username: 'jump' })).toEqual(
      expect.objectContaining({ id: 'device-1-bastion', name: 'SFTP Device bastion' })
    );

    const base64 = Buffer.from('abc').toString('base64');
    expect(internals.parseFingerprint(`SHA256:${base64}`)).toEqual({
      display: `SHA256:${base64}`,
      hex: '616263',
    });
    const hex = 'a'.repeat(64);
    const colonHex = hex.match(/../g)?.join(':') ?? hex;
    expect(internals.parseFingerprint(colonHex)).toEqual({ display: colonHex, hex });
    expect(() => internals.parseFingerprint('  ')).toThrow('missing an SSH host key fingerprint');
    expect(() => internals.parseFingerprint('not-a-fingerprint')).toThrow(
      'has an invalid host fingerprint'
    );
    expect(
      internals.getExpectedFingerprint({ host: 'device.local', label: 'primary' })
    ).toBeUndefined();
    expect(
      internals.getExpectedFingerprint({
        host: 'device.local',
        label: 'primary',
        fingerprint: colonHex,
      })
    ).toEqual({ display: colonHex, hex });

    const actual = internals.computeHostKeyFingerprint(Buffer.from('mock-host-key'));
    expect(internals.computeHostKeyFingerprint(hex)).toEqual({
      display: `SHA256:${Buffer.from(hex, 'hex').toString('base64')}`,
      hex,
    });
    expect(internals.verifyHostKey(Buffer.from('mock-host-key'))).toBe(true);
    expect(internals.verifyHostKey(Buffer.from('mock-host-key'), actual)).toBe(true);
    expect(internals.verifyHostKey(Buffer.from('other-key'), actual)).toBe(false);
    expect(internals.hostKeyFailure).toEqual({
      expected: actual.display,
      received: `SHA256:${createHash('sha256').update(Buffer.from('other-key')).digest('base64')}`,
    });
    expect(internals.verifyBastionHostKey(Buffer.from('mock-host-key'))).toBe(true);
    expect(internals.verifyBastionHostKey(Buffer.from('other-key'), actual)).toBe(false);
    expect(internals.bastionHostKeyFailure?.expected).toBe(actual.display);

    postMessage.mockClear();
    internals.updateConnectionStatus('connected');
    internals.updateConnectionStatus('reconnecting');
    internals.updateConnectionStatus('disconnected', 3);
    internals.updateConnectionStatus('disconnected', undefined, 'Offline');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'connected',
      countdownSeconds: undefined,
      message: 'Connected',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'reconnecting',
      countdownSeconds: undefined,
      message: 'Reconnecting…',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'disconnected',
      countdownSeconds: 3,
      message: 'Disconnected. Reconnecting in 3s…',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'connectionStatus',
      state: 'disconnected',
      countdownSeconds: undefined,
      message: 'Offline',
    });

    expect(internals.escapeHtml('&<>"x')).toBe('&amp;&lt;&gt;&quot;x');
    expect(internals.getErrorMessage(new Error('boom'))).toBe('boom');
    expect(internals.getErrorMessage('plain')).toBe('plain');
    expect(internals.toError(new Error('existing'), 'fallback').message).toBe('existing');
    expect(internals.toError('', 'fallback').message).toBe('fallback');

    panel.dispose();
  });

  it('covers local filesystem mutations, snapshots, terminals, and content viewing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-logger-sftp-local-'));
    const panel = createExplorer();
    const internals = getInternals(panel);

    try {
      await fs.mkdir(path.join(root, 'folder'));
      await fs.writeFile(path.join(root, 'folder', 'nested.txt'), 'nested', 'utf8');
      await fs.writeFile(path.join(root, 'script.sh'), '#!/bin/sh\n', 'utf8');
      await fs.chmod(path.join(root, 'script.sh'), 0o755);

      const listed = await internals.listLocal(root);
      expect(listed[0]).toEqual(expect.objectContaining({ name: 'folder', type: 'directory' }));
      expect(listed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'script.sh', type: 'file', isExecutable: true }),
        ])
      );

      const snapshot = await internals.buildSnapshot('local', root);
      expect(snapshot).toEqual(
        expect.objectContaining({
          path: root,
          parentPath: path.dirname(root),
          isRoot: false,
        })
      );

      await internals.createDirectory('local', root, ' new-folder ');
      await internals.createFile('local', root, 'new.txt');
      await expect(internals.createFile('local', root, 'new.txt')).rejects.toThrow(
        'An entry with that name already exists.'
      );
      await internals.renameEntry('local', path.join(root, 'new.txt'), 'renamed.txt');
      await internals.duplicateEntry('local', path.join(root, 'renamed.txt'));
      await internals.duplicateEntry('local', path.join(root, 'folder'));
      await internals.copyEntry(
        { location: 'local', path: path.join(root, 'renamed.txt') },
        { location: 'local', path: path.join(root, 'new-folder') }
      );
      await expect(
        internals.copyEntry(
          { location: 'local', path: path.join(root, 'folder') },
          { location: 'local', path: root }
        )
      ).rejects.toThrow('An entry with the same name already exists in the destination.');
      await expect(
        internals.copyEntry(
          { location: 'local', path: path.join(root, 'renamed.txt') },
          { location: 'local', path: path.join(root, 'renamed.txt') }
        )
      ).rejects.toThrow('Destination path must be a directory.');
      await expect(internals.copyEntries([], { location: 'local', path: root })).resolves.toBe(
        root
      );
      await expect(internals.deleteEntries('local', [])).resolves.toBe(os.homedir());

      await internals.openTerminal('local', root);
      expect(window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ name: `Local: ${path.basename(root)}`, cwd: root })
      );
      await expect(internals.openTerminal('local', path.join(root, 'script.sh'))).rejects.toThrow(
        'Target path is not a directory'
      );

      await internals.viewContent('local', path.join(root, 'script.sh'));
      expect(window.showTextDocument).toHaveBeenCalled();
      await expect(internals.viewContent('local', root)).rejects.toThrow(
        'Only files can be opened for viewing.'
      );

      await internals.applyPermissions('local', path.join(root, 'script.sh'), 0o644);
      await expect(internals.applyPermissionsBatch('local', [], 0o600)).resolves.toBe(os.homedir());
      await internals.deleteEntry('local', path.join(root, 'renamed.txt'));
      await internals.deleteEntry('local', path.join(root, 'new-folder'));
    } finally {
      panel.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('covers remote SFTP mutations and remote validation branches with a memory backend', async () => {
    const panel = createExplorer();
    const internals = getInternals(panel);
    const sftp = new MemorySftp();
    internals.sftp = sftp;

    await expect(internals.getRemoteHome()).resolves.toBe('/');
    await expect(internals.getRemoteHome()).resolves.toBe('/');
    expect(await internals.pathExists('remote', '/script.sh')).toBe(true);
    expect(await internals.pathExists('remote', '/missing.sh')).toBe(false);

    const snapshot = await internals.buildSnapshot('remote', '/alpha', 'right');
    expect(snapshot.entries).toEqual([
      expect.objectContaining({ name: 'child.txt', type: 'file' }),
    ]);

    await expect(internals.assertDirectory('remote', '/script.sh')).rejects.toThrow(
      'Destination path must be a directory.'
    );
    await expect(internals.ensureDirectoryExists('remote', '/missing')).rejects.toThrow(
      'Remote path not found: /missing'
    );
    await expect(internals.runEntry('local', '/tmp/script.sh')).rejects.toThrow(
      'Running files is only supported for remote entries.'
    );
    await expect(internals.runEntry('remote', '/alpha')).rejects.toThrow('Cannot run a directory.');
    await expect(internals.runEntry('remote', '/alpha/child.txt')).rejects.toThrow(
      'The selected file is not executable.'
    );

    await internals.createDirectory('remote', '/', 'beta');
    await internals.createFile('remote', '/beta', 'empty.txt');
    await expect(internals.createDirectory('remote', '/', 'beta')).rejects.toThrow(
      'An entry with that name already exists.'
    );
    await internals.renameEntry('remote', '/beta/empty.txt', 'renamed.txt');
    await internals.duplicateEntry('remote', '/beta/renamed.txt');
    await internals.duplicateEntry('remote', '/alpha');
    await internals.copyEntry(
      { location: 'remote', path: '/script.sh' },
      { location: 'remote', path: '/beta' }
    );
    await expect(
      internals.copyEntry({ location: 'remote', path: '/alpha' }, { location: 'remote', path: '/' })
    ).rejects.toThrow('An entry with the same name already exists in the destination.');
    await expect(internals.copyEntries([], { location: 'remote', path: '/' })).resolves.toBe('/');
    await expect(internals.deleteEntries('remote', [])).resolves.toBe('/');

    const permissions = await internals.getPermissionsInfo('remote', '/script.sh');
    expect(permissions).toEqual(
      expect.objectContaining({ path: '/script.sh', type: 'file', ownerName: undefined })
    );
    await internals.applyPermissions('remote', '/script.sh', 0o700, 2000, 2001);
    expect(sftp.nodes.get('/script.sh')).toEqual(
      expect.objectContaining({ mode: 0o700, uid: 2000, gid: 2001 })
    );
    await expect(internals.applyPermissionsBatch('remote', [], 0o600)).resolves.toBe('/');
    await internals.deleteEntry('remote', '/beta/script.sh');
    await internals.deleteEntry('remote', '/beta');

    panel.dispose();
  });

  it('covers test-mode fallback helpers and search entry metadata branches', async () => {
    const productionPanel = createProductionExplorer();
    productionPanel.enqueueTestInput('ignored');
    expect(
      (productionPanel as unknown as { testInputQueue: string[] }).testInputQueue
    ).toHaveLength(0);
    productionPanel.dispose();

    const panel = createExplorer();
    const explorer = panel as unknown as {
      normalizeTestPath: (value: string) => string;
      buildTestSnapshot: (
        location: 'remote' | 'local',
        dirPath: string,
        context?: 'left' | 'right'
      ) => { path: string; parentPath: string; isRoot: boolean; entries: unknown[] };
      getNextTestInput: () => string;
      buildTestSearchSnapshot: (
        location: 'remote' | 'local',
        search: { basePath: string; command: string; options: Partial<unknown> }
      ) => { parentPath: string; entries: unknown[] };
      collectTestSearchEntries: (
        basePath: string,
        options?: { includeSubdirectories?: boolean; content?: string }
      ) => unknown[];
      buildSearchEntries: (
        location: 'remote' | 'local',
        basePath: string,
        output: string
      ) => Promise<Array<{ name: string; modified?: number; relativePath?: string }>>;
      getEntryStats: ReturnType<typeof vi.fn>;
      isPaneRequestId: (requestId: string) => boolean;
      toPaneRequestId: (requestId: string) => string;
      getSearchLocationForRequestId: (requestId: string) => 'remote' | 'local';
      sortEntries: (
        entries: Array<{ name: string; type: 'file' | 'directory'; size: number }>
      ) => Array<{ name: string; type: 'file' | 'directory' }>;
    };

    expect(explorer.normalizeTestPath('relative/path')).toBe('/relative/path');
    expect(explorer.normalizeTestPath('')).toBe('/');
    expect(explorer.buildTestSnapshot('remote', '/missing', 'right')).toEqual(
      expect.objectContaining({ path: '/missing', parentPath: '/', isRoot: false, entries: [] })
    );
    expect(explorer.getNextTestInput()).toBe('test-value');
    expect(
      explorer.buildTestSearchSnapshot('local', {
        basePath: '/alpha',
        command: '',
        options: { includeSubdirectories: false },
      }).parentPath
    ).toBe('/');
    expect(explorer.collectTestSearchEntries('/alpha', { includeSubdirectories: false })).toEqual([
      expect.objectContaining({ relativePath: 'alpha-child.txt' }),
    ]);
    expect(explorer.collectTestSearchEntries('/', { content: undefined })).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'alpha-file.txt' })])
    );

    explorer.getEntryStats = vi.fn(async (_location: 'remote' | 'local', targetPath: string) => {
      const name = pathPosix.basename(targetPath);
      return {
        isFile: () => !name.startsWith('dir'),
        isDirectory: () => name.startsWith('dir'),
        size: 1,
        mode: 0o755,
        mtime: name === 'date.txt' ? new Date(1000) : name === 'seconds.txt' ? 2 : undefined,
        mtimeMs: name === 'ms.txt' ? 3000 : undefined,
      };
    });

    const entries = await explorer.buildSearchEntries(
      'remote',
      '/base',
      './date.txt\nms.txt\nseconds.txt\nplain.txt\ndir-entry\n\n'
    );
    expect(entries.map((entry) => [entry.name, entry.modified])).toEqual([
      ['date.txt', 1000],
      ['ms.txt', 3000],
      ['plain.txt', undefined],
      ['seconds.txt', 2000],
    ]);

    expect(explorer.isPaneRequestId('custom')).toBe(false);
    expect(explorer.toPaneRequestId('local')).toBe('local');
    expect(explorer.toPaneRequestId('rightRemote')).toBe('rightRemote');
    expect(explorer.toPaneRequestId('custom')).toBe('remote');
    expect(explorer.getSearchLocationForRequestId('rightRemote')).toBe('remote');
    expect(
      explorer.sortEntries([
        { name: 'z.txt', type: 'file', size: 1 },
        { name: 'a', type: 'directory', size: 0 },
      ])
    ).toEqual([expect.objectContaining({ name: 'a' }), expect.objectContaining({ name: 'z.txt' })]);

    panel.dispose();
  });

  it('covers transfer branch combinations and overwrite decisions with stubbed operations', async () => {
    const panel = createExplorer();
    const explorer = panel as unknown as {
      copyEntry: SftpExplorerInternals['copyEntry'];
      getEntryStats: ReturnType<typeof vi.fn>;
      assertDirectory: ReturnType<typeof vi.fn>;
      pathExists: ReturnType<typeof vi.fn>;
      confirmOverwrite: ReturnType<typeof vi.fn>;
      copyRemoteDirectory: ReturnType<typeof vi.fn>;
      copyRemoteFile: ReturnType<typeof vi.fn>;
      downloadDirectory: ReturnType<typeof vi.fn>;
      downloadFile: ReturnType<typeof vi.fn>;
      uploadDirectory: ReturnType<typeof vi.fn>;
      uploadFile: ReturnType<typeof vi.fn>;
      copyLocalDirectory: ReturnType<typeof vi.fn>;
      applyMode: ReturnType<typeof vi.fn>;
    };
    const statFor = (targetPath: string) => ({
      isDirectory: () => targetPath.includes('dir'),
      isFile: () => !targetPath.includes('dir'),
      size: 1,
      mode: 0o755,
      mtimeMs: 1,
    });

    explorer.getEntryStats = vi.fn(async (_location: 'remote' | 'local', targetPath: string) =>
      statFor(targetPath)
    );
    explorer.assertDirectory = vi.fn(async () => undefined);
    explorer.pathExists = vi.fn(async () => false);
    explorer.confirmOverwrite = vi.fn(async () => true);
    explorer.copyRemoteDirectory = vi.fn(async () => undefined);
    explorer.copyRemoteFile = vi.fn(async () => undefined);
    explorer.downloadDirectory = vi.fn(async () => undefined);
    explorer.downloadFile = vi.fn(async () => undefined);
    explorer.uploadDirectory = vi.fn(async () => undefined);
    explorer.uploadFile = vi.fn(async () => undefined);
    explorer.copyLocalDirectory = vi.fn(async () => undefined);
    explorer.applyMode = vi.fn(async () => undefined);

    await explorer.copyEntry(
      { location: 'remote', path: '/source-dir' },
      { location: 'remote', path: '/dest' }
    );
    await explorer.copyEntry(
      { location: 'remote', path: '/source.txt' },
      { location: 'remote', path: '/dest' }
    );
    await explorer.copyEntry(
      { location: 'remote', path: '/source-dir' },
      { location: 'local', path: '/tmp' }
    );
    await explorer.copyEntry(
      { location: 'remote', path: '/source.txt' },
      { location: 'local', path: '/tmp' }
    );
    await explorer.copyEntry(
      { location: 'local', path: '/tmp/source-dir' },
      { location: 'remote', path: '/dest' }
    );
    await explorer.copyEntry(
      { location: 'local', path: '/tmp/source.txt' },
      { location: 'remote', path: '/dest' }
    );
    await explorer.copyEntry(
      { location: 'local', path: '/tmp/source-dir' },
      { location: 'local', path: '/tmp/dest' }
    );

    expect(explorer.copyRemoteDirectory).toHaveBeenCalled();
    expect(explorer.copyRemoteFile).toHaveBeenCalled();
    expect(explorer.downloadDirectory).toHaveBeenCalled();
    expect(explorer.downloadFile).toHaveBeenCalled();
    expect(explorer.uploadDirectory).toHaveBeenCalled();
    expect(explorer.uploadFile).toHaveBeenCalled();
    expect(explorer.copyLocalDirectory).toHaveBeenCalled();

    explorer.pathExists = vi.fn(async () => true);
    explorer.getEntryStats = vi.fn(async (_location: 'remote' | 'local', targetPath: string) => ({
      ...statFor(targetPath),
      isDirectory: () => false,
      isFile: () => true,
    }));
    explorer.confirmOverwrite = vi.fn(async () => false);
    await expect(
      explorer.copyEntry(
        { location: 'remote', path: '/source.txt' },
        { location: 'remote', path: '/dest' }
      )
    ).resolves.toBe('/dest');
    expect(explorer.confirmOverwrite).toHaveBeenCalled();

    panel.dispose();
  });

  it('covers authentication, private-key, and connection validation helper branches', async () => {
    const keyFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-key-')), 'id.key');
    const emptyKeyFile = `${keyFile}.empty`;
    await fs.writeFile(keyFile, 'PRIVATE KEY', 'utf8');
    await fs.writeFile(emptyKeyFile, '', 'utf8');
    process.env.VSCODE_LOGGER_TEST_KEY = keyFile;

    const panel = createExplorer({
      privateKeyPath: '${env:VSCODE_LOGGER_TEST_KEY}',
      bastion: {
        host: 'jump.local',
        username: 'jump',
        privateKeyPath: keyFile,
      },
    });
    const explorer = panel as unknown as {
      passwordManager: {
        getPassword: ReturnType<typeof vi.fn>;
        getPassphrase: ReturnType<typeof vi.fn>;
      };
      getAuthentication: () => Promise<{
        privateKey?: Buffer;
        password?: string;
        passphrase?: string;
      }>;
      getBastionAuthentication: (
        bastion: NonNullable<EmbeddedDevice['bastion']>
      ) => Promise<{ privateKey?: Buffer; password?: string; passphrase?: string }>;
      loadPrivateKey: (filePath: string) => Promise<Buffer>;
      expandPath: (value: string) => string;
      validateDeviceConfiguration: () => string | undefined;
    };

    explorer.passwordManager = {
      getPassword: vi.fn(async () => ''),
      getPassphrase: vi.fn(async () => ''),
    };
    await expect(explorer.getAuthentication()).resolves.toEqual({
      privateKey: Buffer.from('PRIVATE KEY'),
      passphrase: undefined,
    });
    await expect(
      explorer.getBastionAuthentication({
        host: 'jump.local',
        username: 'jump',
        privateKeyPath: keyFile,
      })
    ).resolves.toEqual({ privateKey: Buffer.from('PRIVATE KEY'), passphrase: undefined });
    await expect(explorer.loadPrivateKey(emptyKeyFile)).rejects.toThrow(
      'The private key file is empty.'
    );
    expect(explorer.expandPath('~/demo')).toBe(path.resolve(os.homedir(), 'demo'));

    const passwordPanel = createExplorer({ privateKeyPath: undefined });
    const passwordExplorer = passwordPanel as unknown as typeof explorer;
    passwordExplorer.passwordManager = {
      getPassword: vi.fn(async () => ''),
      getPassphrase: vi.fn(async () => undefined),
    };
    await expect(passwordExplorer.getAuthentication()).rejects.toThrow(
      'Password or private key is required to connect to the device.'
    );
    await expect(
      passwordExplorer.getBastionAuthentication({ host: 'jump.local', username: 'jump' })
    ).rejects.toThrow('Password or private key is required to connect to the bastion host.');

    expect(getInternals(createExplorer({ username: ' ' })).validateDeviceConfiguration()).toBe(
      'Device "SFTP Device" is missing a username.'
    );
    expect(getInternals(createExplorer({ port: 0 })).validateDeviceConfiguration()).toBe(
      'Device "SFTP Device" has an invalid port.'
    );
    expect(
      getInternals(
        createExplorer({ bastion: { host: 'jump.local', username: 'jump', port: 0 } })
      ).validateDeviceConfiguration()
    ).toBe('Device "SFTP Device" has an invalid bastion port.');

    panel.dispose();
    passwordPanel.dispose();
    await fs.rm(path.dirname(keyFile), { recursive: true, force: true });
  });

  it('covers preset deletion and search refresh routing helper branches', async () => {
    const configuredDevice: EmbeddedDevice = { ...baseDevice };
    await workspace.getConfiguration('embeddedLogger').update('devices', [configuredDevice]);
    const panel = new SftpExplorerPanel(createExtensionContext(), configuredDevice);
    const explorer = panel as unknown as {
      saveSftpPresets: (location: 'remote' | 'local', presets: string[]) => Promise<void>;
      buildSearchSnapshot: (
        location: 'remote' | 'local',
        search: { basePath: string; command: string; options: Partial<unknown> },
        context?: 'left' | 'right'
      ) => Promise<unknown>;
      refreshAfterMutation: (
        location: 'remote' | 'local',
        refreshDir: string,
        requestId: string
      ) => Promise<void>;
      refreshRemoteViewsAfterReconnect: () => Promise<void>;
      activeSearches: Map<string, { basePath: string; command: string; options: Partial<unknown> }>;
      ensureDirectoryExists: ReturnType<typeof vi.fn>;
      execRemoteCommand: ReturnType<typeof vi.fn>;
      execLocalCommand: ReturnType<typeof vi.fn>;
      buildSearchEntries: ReturnType<typeof vi.fn>;
      searchAndPost: ReturnType<typeof vi.fn>;
      listAndPost: ReturnType<typeof vi.fn>;
      remotePaths: { left?: string; right?: string };
      remoteHome?: string;
    };

    await explorer.saveSftpPresets('local', [' /tmp/downloads ']);
    expect(configuredDevice.sftpPresetsLocal).toEqual(['/tmp/downloads']);
    await explorer.saveSftpPresets('local', []);
    expect(configuredDevice.sftpPresetsLocal).toBeUndefined();

    await workspace.getConfiguration('embeddedLogger').update('devices', []);
    await expect(explorer.saveSftpPresets('remote', ['/var/log'])).rejects.toThrow(
      'Cannot save SFTP presets because device "SFTP Device" is no longer configured.'
    );

    explorer.ensureDirectoryExists = vi.fn(async () => undefined);
    explorer.execRemoteCommand = vi.fn(async () => 'remote.txt\n');
    explorer.execLocalCommand = vi.fn(async () => 'local.txt\n');
    explorer.buildSearchEntries = vi.fn(async () => [{ name: 'result.txt' }]);

    await explorer.buildSearchSnapshot(
      'remote',
      { basePath: '/var', command: '', options: { includeSubdirectories: true } },
      'right'
    );
    await explorer.buildSearchSnapshot('local', {
      basePath: os.tmpdir(),
      command: '',
      options: { includeSubdirectories: true },
    });
    expect(explorer.execRemoteCommand).toHaveBeenCalled();
    expect(explorer.execLocalCommand).toHaveBeenCalled();

    explorer.searchAndPost = vi.fn(async () => undefined);
    explorer.listAndPost = vi.fn(async () => undefined);
    explorer.activeSearches.set('remote', {
      basePath: '/search',
      command: 'find .',
      options: { includeSubdirectories: true },
    });
    await explorer.refreshAfterMutation('remote', '/ignored', 'remote');
    expect(explorer.searchAndPost).toHaveBeenCalledWith(
      'remote',
      '/search',
      { includeSubdirectories: true },
      'remote'
    );

    explorer.activeSearches.clear();
    await explorer.refreshAfterMutation('remote', '/right', 'rightRemote');
    expect(explorer.listAndPost).toHaveBeenCalledWith('remote', '/right', 'rightRemote', 'right');

    explorer.remoteHome = '/home/root';
    explorer.remotePaths = { left: '/left', right: '/right' };
    await explorer.refreshRemoteViewsAfterReconnect();
    expect(explorer.listAndPost).toHaveBeenCalledWith('remote', '/left', 'remote', 'left');
    expect(explorer.listAndPost).toHaveBeenCalledWith('remote', '/right', 'rightRemote', 'right');

    explorer.activeSearches.set('remote', {
      basePath: '/left-search',
      command: 'find .',
      options: {},
    });
    explorer.activeSearches.set('rightRemote', {
      basePath: '/right-search',
      command: 'find .',
      options: {},
    });
    await explorer.refreshRemoteViewsAfterReconnect();
    expect(explorer.searchAndPost).toHaveBeenCalledWith('remote', '/left-search', {}, 'remote');
    expect(explorer.searchAndPost).toHaveBeenCalledWith(
      'remote',
      '/right-search',
      {},
      'rightRemote'
    );

    panel.dispose();
  });

  it('covers remote listing and remote delete error branches', async () => {
    const panel = createExplorer();
    const explorer = getInternals(panel);

    explorer.sftp = {
      readdir: (_dirPath: string, callback: (err: Error | undefined, items?: unknown[]) => void) =>
        callback(new Error('readdir failed')),
    } as unknown as MemorySftp;
    await expect(
      (explorer as unknown as { listRemote: (dirPath: string) => Promise<unknown[]> }).listRemote(
        '/'
      )
    ).rejects.toThrow('readdir failed');

    explorer.sftp = {
      readdir: (_dirPath: string, callback: (err: Error | undefined, items?: unknown[]) => void) =>
        callback(undefined, undefined),
    } as unknown as MemorySftp;
    await expect(
      (explorer as unknown as { listRemote: (dirPath: string) => Promise<unknown[]> }).listRemote(
        '/'
      )
    ).resolves.toEqual([]);

    explorer.sftp = {
      readdir: (_dirPath: string, callback: (err: Error | undefined, items?: unknown[]) => void) =>
        callback(undefined, [
          {
            filename: 'date.txt',
            attrs: {
              mode: 0o644,
              size: 1,
              mtime: new Date(1000),
              isDirectory: () => false,
            },
          },
          {
            filename: 'no-time.txt',
            attrs: {
              mode: 0o644,
              size: 1,
              mtime: undefined,
              isDirectory: () => false,
            },
          },
        ]),
    } as unknown as MemorySftp;
    await expect(
      (explorer as unknown as { listRemote: (dirPath: string) => Promise<unknown[]> }).listRemote(
        '/'
      )
    ).resolves.toEqual([
      expect.objectContaining({ name: 'date.txt', modified: 1000 }),
      expect.objectContaining({ name: 'no-time.txt', modified: undefined }),
    ]);

    const removeMethod = 'un' + 'link';
    explorer.sftp = {
      stat: (
        _targetPath: string,
        callback: (err: Error | undefined, stats?: { isDirectory: () => boolean }) => void
      ) => callback(undefined, { isDirectory: () => false }),
      [removeMethod]: (_targetPath: string, callback: (err?: Error) => void) =>
        callback(new Error('remove failed')),
    } as unknown as MemorySftp;
    await expect(explorer.deleteEntry('remote', '/file.txt')).rejects.toThrow('remove failed');

    panel.dispose();
  });
});
