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
});
