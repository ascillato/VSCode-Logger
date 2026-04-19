import type { Stats } from 'fs';
import * as fs from 'fs/promises';
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

      await expect(explorer.openTerminal('local', file)).rejects.toThrow(
        `Target path is not a directory: ${file}`
      );
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
      } as never);
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
});
