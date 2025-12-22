/**
 * @file sftpExplorer.ts
 * @brief Provides a Webview panel to browse and transfer files over SFTP.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { Client, ConnectConfig } from 'ssh2';
import { Readable, Writable } from 'stream';
import { promisify } from 'util';
import { BastionConfig, EmbeddedDevice } from './deviceTree';
import { HostEndpoint, getHostEndpoints } from './hostEndpoints';
import { PasswordManager } from './passwordManager';
import { SshCommandRunner } from './sshCommandRunner';
import { SshTerminalSession } from './sshTerminal';

type ForwardingClient = Client & {
    forwardOut(
        srcIP: string,
        srcPort: number,
        dstIP: string,
        dstPort: number,
        callback: (err: Error | undefined, stream: any) => void
    ): void;
};

type SocketConnectConfig = ConnectConfig & { sock?: any };

interface ExplorerEntry {
    name: string;
    type: 'file' | 'directory';
    size: number;
    modified?: number;
    permissions?: string;
    isExecutable?: boolean;
}

interface DirectorySnapshot {
    path: string;
    parentPath: string;
    isRoot: boolean;
    entries: ExplorerEntry[];
    location: 'remote' | 'local';
}

interface InitResponse {
    type: 'init';
    remoteHome: string;
    localHome: string;
    remote: DirectorySnapshot;
    local: DirectorySnapshot;
    sftpPresetsRemote: string[];
    sftpPresetsLocal: string[];
}

interface ListResponse {
    type: 'listResponse';
    requestId: string;
    snapshot: DirectorySnapshot;
}

interface StatusMessage {
    type: 'status';
    message: string;
}

type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

interface PermissionsInfo {
    path: string;
    location: 'remote' | 'local';
    name: string;
    type: 'file' | 'directory';
    mode: number;
    owner?: number;
    group?: number;
    ownerName?: string;
    groupName?: string;
}

interface ConnectionStatusMessage {
    type: 'connectionStatus';
    state: ConnectionState;
    countdownSeconds?: number;
    message: string;
}

interface ErrorMessage {
    type: 'error';
    message: string;
}

interface PermissionsInfoMessage {
    type: 'permissionsInfo';
    requestId: string;
    info: PermissionsInfo;
}

interface SftpPresetsMessage {
    type: 'sftpPresetsUpdated';
    location: 'remote' | 'local';
    presets: string[];
}

type ConfirmationResponse = { type: 'confirmationResult'; requestId: string; confirmed: boolean };
type InputResponse = { type: 'inputResult'; requestId: string; value?: string };

type WebviewResponse =
    | InitResponse
    | ListResponse
    | StatusMessage
    | ErrorMessage
    | ConfirmationResponse
    | InputResponse
    | ConnectionStatusMessage
    | PermissionsInfoMessage
    | SftpPresetsMessage;

type WebviewRequest =
    | { type: 'requestInit' }
    | { type: 'listEntries'; location: 'remote' | 'local'; path: string; requestId: string }
    | { type: 'deleteEntry'; location: 'remote' | 'local'; path: string; requestId: string }
    | { type: 'renameEntry'; location: 'remote' | 'local'; path: string; newName: string; requestId: string }
    | { type: 'duplicateEntry'; location: 'remote' | 'local'; path: string; requestId: string }
    | { type: 'createDirectory'; location: 'remote' | 'local'; path: string; name: string; requestId: string }
    | { type: 'createFile'; location: 'remote' | 'local'; path: string; name: string; requestId: string }
    | {
          type: 'copyEntry';
          from: { location: 'remote' | 'local'; path: string };
          toDirectory: { location: 'remote' | 'local'; path: string };
          requestId: string;
      }
    | {
          type: 'copyEntries';
          items: { location: 'remote' | 'local'; path: string }[];
          toDirectory: { location: 'remote' | 'local'; path: string };
          requestId: string;
      }
    | { type: 'requestPermissionsInfo'; location: 'remote' | 'local'; path: string; requestId: string }
    | {
          type: 'updatePermissions';
          location: 'remote' | 'local';
          path: string;
          mode: number;
          owner?: number | string;
          group?: number | string;
          requestId: string;
      }
    | {
          type: 'updatePermissionsBatch';
          location: 'remote' | 'local';
          paths: string[];
          mode: number;
          owner?: number | string;
          group?: number | string;
          requestId: string;
      }
    | { type: 'runEntry'; location: 'remote' | 'local'; path: string; requestId: string }
    | { type: 'viewContent'; location: 'remote' | 'local'; path: string }
    | { type: 'openTerminal'; location: 'remote' | 'local'; path: string }
    | { type: 'deleteEntries'; location: 'remote' | 'local'; paths: string[]; requestId: string }
    | { type: 'requestConfirmation'; message: string; requestId: string }
    | { type: 'requestInput'; prompt: string; value?: string; requestId: string }
    | { type: 'saveSftpPresets'; location: 'remote' | 'local'; presets: string[] };

interface HostKeyMismatch {
    expected: string;
    received: string;
}

type FileStat = {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
    mtime?: number | Date;
    mtimeMs?: number;
    mode?: number;
    uid?: number;
    gid?: number;
};

const execFileAsync = promisify(execFile);

interface SftpFileEntry {
    filename: string;
    longname: string;
    attrs: FileStat;
}

interface SftpClient {
    readdir(path: string, callback: (err: Error | undefined, list?: SftpFileEntry[]) => void): void;
    realpath(path: string, callback: (err: Error | undefined, absPath?: string) => void): void;
    stat(path: string, callback: (err: Error | undefined, stats?: FileStat) => void): void;
    unlink(path: string, callback: (err?: Error) => void): void;
    rename(src: string, dest: string, callback: (err?: Error) => void): void;
    fastGet(src: string, dest: string, callback: (err?: Error) => void): void;
    fastPut(src: string, dest: string, callback: (err?: Error) => void): void;
    createReadStream(path: string): Readable;
    createWriteStream(path: string): Writable;
    mkdir(path: string, callback: (err?: Error) => void): void;
    rmdir(path: string, callback: (err?: Error) => void): void;
    setstat(path: string, attrs: { mode?: number; uid?: number; gid?: number }, callback: (err?: Error) => void): void;
}

type ClientWithSftp = Client & { sftp(callback: (err: Error | undefined, sftp?: SftpClient) => void): void };

class HostKeyMismatchError extends Error {
    constructor(
        message: string,
        public readonly expected: string,
        public readonly received: string
    ) {
        super(message);
        this.name = 'HostKeyMismatchError';
    }
}

export class SftpExplorerPanel {
    private readonly panel: vscode.WebviewPanel;
    private readonly passwordManager: PasswordManager;
    private readonly localHome: string;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
    private readonly webviewReady: Promise<void>;
    private resolveWebviewReady?: () => void;

    private client?: ClientWithSftp;
    private bastionClient?: Client;
    private sftp?: SftpClient;
    private sftpReady?: Promise<SftpClient>;
    private remoteHome?: string;
    private hostKeyFailure?: HostKeyMismatch;
    private bastionHostKeyFailure?: HostKeyMismatch;
    private activeEndpoint?: HostEndpoint;
    private remotePaths: { left?: string; right?: string } = {};
    private connectionState: ConnectionState = 'connected';
    private countdownTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;
    private readonly reconnectDelayMs = 5000;
    private hasEverConnected = false;
    private disposed = false;
    private viewContentDirectory?: string;
    private readonly viewedTempFiles = new Map<string, { remotePath: string }>();
    private readonly sftpPresetsKey: string;
    private readonly sftpLocalPresetsKey: string;

    readonly onDidDispose = this.onDidDisposeEmitter.event;

    constructor(private readonly context: vscode.ExtensionContext, private readonly device: EmbeddedDevice) {
        this.passwordManager = new PasswordManager(context);
        this.localHome = os.homedir();
        this.sftpPresetsKey = `embeddedLogger.sftpPresets.${device.id}`;
        this.sftpLocalPresetsKey = `embeddedLogger.sftpPresets.local.${device.id}`;

        this.panel = vscode.window.createWebviewPanel(
            'embeddedLoggerSftpExplorer',
            `${device.name} SFTP Explorer`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
                    vscode.Uri.file(path.join(this.context.extensionPath, 'resources')),
                ],
            }
        );

        this.panel.webview.html = this.getHtml(this.panel.webview);
        this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
        this.panel.webview.onDidReceiveMessage((message: WebviewRequest) => {
            void this.handleMessage(message);
        });

        this.webviewReady = new Promise((resolve) => {
            this.resolveWebviewReady = resolve;
        });

        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                void this.handleTempFileSave(doc);
            }),
            vscode.workspace.onDidCloseTextDocument((doc) => {
                void this.handleTempFileClose(doc);
            })
        );
    }

    async start(): Promise<void> {
        await this.webviewReady;
        await this.postInitialState();
    }

    reveal(): void {
        this.panel.reveal(vscode.ViewColumn.Active, true);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        void this.cleanupTempFiles();
        while (this.disposables.length) {
            const item = this.disposables.pop();
            item?.dispose();
        }
        this.clearReconnectTimers();
        this.onDidDisposeEmitter.fire();
        this.onDidDisposeEmitter.dispose();
        this.sftp = undefined;
        this.sftpReady = undefined;
        this.client?.end();
        this.client = undefined;
        this.bastionClient?.end();
        this.bastionClient = undefined;
        this.panel.dispose();
    }

    private async handleMessage(message: WebviewRequest): Promise<void> {
        try {
            switch (message.type) {
                case 'requestInit':
                    if (this.resolveWebviewReady) {
                        this.resolveWebviewReady();
                        this.resolveWebviewReady = undefined;
                    }
                    break;
                case 'listEntries':
                    await this.listAndPost(
                        message.location,
                        message.path,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                case 'deleteEntry': {
                    const refreshDir = await this.deleteEntry(message.location, message.path);
                    await this.listAndPost(
                        message.location,
                        refreshDir,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'deleteEntries': {
                    const refreshDir = await this.deleteEntries(message.location, message.paths);
                    await this.listAndPost(
                        message.location,
                        refreshDir,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'renameEntry': {
                    const refreshDir = await this.renameEntry(message.location, message.path, message.newName);
                    await this.listAndPost(
                        message.location,
                        refreshDir,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'duplicateEntry': {
                    const refreshDir = await this.duplicateEntry(message.location, message.path);
                    await this.listAndPost(
                        message.location,
                        refreshDir,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'createDirectory': {
                    const refreshDir = await this.createDirectory(message.location, message.path, message.name);
                    await this.listAndPost(
                        message.location,
                        refreshDir,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'createFile': {
                    const refreshDir = await this.createFile(message.location, message.path, message.name);
                    await this.listAndPost(
                        message.location,
                        refreshDir,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'copyEntry': {
                    const refreshDir = await this.copyEntry(message.from, message.toDirectory);
                    await this.listAndPost(
                        message.toDirectory.location,
                        refreshDir,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'copyEntries': {
                    const refreshDir = await this.copyEntries(message.items, message.toDirectory);
                    await this.listAndPost(
                        message.toDirectory.location,
                        refreshDir,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'viewContent': {
                    await this.viewContent(message.location, message.path);
                    break;
                }
                case 'runEntry': {
                    await this.runEntry(message.location, message.path);
                    break;
                }
                case 'openTerminal': {
                    await this.openTerminal(message.location, message.path);
                    break;
                }
                case 'requestPermissionsInfo': {
                    const info = await this.getPermissionsInfo(message.location, message.path);
                    this.postMessage({ type: 'permissionsInfo', requestId: message.requestId, info });
                    break;
                }
                case 'updatePermissions': {
                    const { owner, group } = await this.resolveOwnerGroupIds(
                        message.location,
                        message.owner,
                        message.group
                    );
                    const parent = await this.applyPermissions(
                        message.location,
                        message.path,
                        message.mode,
                        owner,
                        group
                    );
                    await this.listAndPost(
                        message.location,
                        parent,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'updatePermissionsBatch': {
                    const { owner, group } = await this.resolveOwnerGroupIds(
                        message.location,
                        message.owner,
                        message.group
                    );
                    const parent = await this.applyPermissionsBatch(
                        message.location,
                        message.paths,
                        message.mode,
                        owner,
                        group
                    );
                    await this.listAndPost(
                        message.location,
                        parent,
                        message.requestId,
                        message.requestId === 'rightRemote' ? 'right' : message.requestId === 'remote' ? 'left' : undefined
                    );
                    break;
                }
                case 'requestConfirmation': {
                    const result = await vscode.window.showWarningMessage(message.message, { modal: true }, 'Yes');
                    this.postMessage({
                        type: 'confirmationResult',
                        requestId: message.requestId,
                        confirmed: result === 'Yes',
                    });
                    break;
                }
                case 'requestInput': {
                    const value = await vscode.window.showInputBox({ prompt: message.prompt, value: message.value });
                    this.postMessage({ type: 'inputResult', requestId: message.requestId, value: value ?? '' });
                    break;
                }
                case 'saveSftpPresets': {
                    await this.saveSftpPresets(message.location, message.presets);
                    break;
                }
            }
        } catch (err: any) {
            const messageText = err instanceof HostKeyMismatchError ? err.message : err?.message ?? String(err);
            this.postMessage({ type: 'error', message: messageText });
            vscode.window.showErrorMessage(messageText);
        }
    }

    private async postInitialState(): Promise<void> {
        const remoteHome = await this.getRemoteHome();
        const remoteSnapshot = await this.buildSnapshot('remote', remoteHome);
        const localSnapshot = await this.buildSnapshot('local', this.localHome);
        const sftpPresetsRemote = this.getSftpPresets('remote');
        const sftpPresetsLocal = this.getSftpPresets('local');

        const payload: InitResponse = {
            type: 'init',
            remoteHome,
            localHome: this.localHome,
            remote: remoteSnapshot,
            local: localSnapshot,
            sftpPresetsRemote,
            sftpPresetsLocal,
        };

        this.remotePaths = { left: remoteSnapshot.path, right: remoteSnapshot.path };
        this.updateConnectionStatus('connected');
        this.postMessage(payload);
    }

    private getSftpPresets(location: 'remote' | 'local'): string[] {
        const key = location === 'remote' ? this.sftpPresetsKey : this.sftpLocalPresetsKey;
        return this.context.workspaceState.get<string[]>(key, []);
    }

    private async saveSftpPresets(location: 'remote' | 'local', presets: string[]): Promise<void> {
        const sanitized = presets.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        const key = location === 'remote' ? this.sftpPresetsKey : this.sftpLocalPresetsKey;
        await this.context.workspaceState.update(key, sanitized);
        this.postMessage({ type: 'sftpPresetsUpdated', location, presets: sanitized });
    }

    private async listAndPost(
        location: 'remote' | 'local',
        dirPath: string,
        requestId: string,
        context: 'left' | 'right' | undefined = undefined
    ): Promise<void> {
        const snapshot = await this.buildSnapshot(location, dirPath, context);
        this.postMessage({ type: 'listResponse', requestId, snapshot });
    }

    private async buildSnapshot(
        location: 'remote' | 'local',
        dirPath: string,
        context: 'left' | 'right' | undefined = undefined
    ): Promise<DirectorySnapshot> {
        const normalizedPath = this.normalizePath(location, dirPath || (location === 'remote' ? this.remoteHome ?? '/' : this.localHome));
        await this.ensureDirectoryExists(location, normalizedPath);
        const entries = location === 'remote' ? await this.listRemote(normalizedPath) : await this.listLocal(normalizedPath);
        if (location === 'remote') {
            if (context === 'right') {
                this.remotePaths.right = normalizedPath;
            } else {
                this.remotePaths.left = normalizedPath;
            }
        }
        return {
            path: normalizedPath,
            parentPath: this.getParentDir(location, normalizedPath),
            isRoot: this.isRoot(location, normalizedPath),
            entries,
            location,
        };
    }

    private normalizePath(location: 'remote' | 'local', dirPath: string): string {
        if (location === 'remote') {
            const normalized = path.posix.normalize(dirPath || '/');
            return normalized.startsWith('/') ? normalized : `/${normalized}`;
        }
        return path.resolve(dirPath || this.localHome);
    }

    private isRoot(location: 'remote' | 'local', dirPath: string): boolean {
        if (location === 'remote') {
            return this.normalizePath('remote', dirPath) === '/';
        }
        const parsed = path.parse(dirPath);
        return parsed.root === dirPath;
    }

    private getParentDir(location: 'remote' | 'local', dirPath: string): string {
        if (location === 'remote') {
            const normalized = this.normalizePath('remote', dirPath);
            if (normalized === '/') {
                return '/';
            }
            const parent = path.posix.dirname(normalized);
            return parent || '/';
        }

        const normalized = this.normalizePath('local', dirPath);
        const parent = path.dirname(normalized);
        return parent || normalized;
    }

    private formatPermissions(mode: number | undefined): string {
        if (mode === undefined) {
            return '---------';
        }

        const flags = [0o400, 0o200, 0o100, 0o40, 0o20, 0o10, 0o4, 0o2, 0o1];
        const symbols = ['r', 'w', 'x', 'r', 'w', 'x', 'r', 'w', 'x'];

        return symbols
            .map((symbol, index) => ((mode & flags[index]) !== 0 ? symbol : '-'))
            .join('');
    }

    private isExecutable(mode: number | undefined): boolean {
        return mode !== undefined && (mode & 0o111) !== 0;
    }

    private quoteRemotePath(value: string): string {
        return `'${value.replace(/'/g, "'\\''")}'`;
    }

    private async listLocal(dirPath: string): Promise<ExplorerEntry[]> {
        const directory = this.normalizePath('local', dirPath);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const mapped: ExplorerEntry[] = [];
        for (const entry of entries) {
            if (entry.name === '.' || entry.name === '..') {
                continue;
            }
            const fullPath = path.join(directory, entry.name);
            const stats = await fs.stat(fullPath);
            const mode = stats.mode;
            const type: ExplorerEntry['type'] = stats.isDirectory() ? 'directory' : 'file';
            mapped.push({
                name: entry.name,
                type,
                size: stats.size,
                modified: stats.mtimeMs,
                permissions: this.formatPermissions(mode),
                isExecutable: type === 'file' && this.isExecutable(mode),
            });
        }

        return this.sortEntries(mapped);
    }

    private async listRemote(dirPath: string): Promise<ExplorerEntry[]> {
        const sftp = await this.ensureSftp();
        const directory = this.normalizePath('remote', dirPath);
        const entries = await new Promise<ExplorerEntry[]>((resolve, reject) => {
            sftp.readdir(directory, (err: Error | undefined, items?: SftpFileEntry[]) => {
                if (err) {
                    reject(err);
                    return;
                }
                const mapped: ExplorerEntry[] = (items || [])
                    .filter((item) => item.filename !== '.' && item.filename !== '..')
                    .map((item) => {
                        const mode = item.attrs.mode;
                        const type: ExplorerEntry['type'] = item.attrs.isDirectory() ? 'directory' : 'file';
                        return {
                            name: item.filename,
                            type,
                            size: Number(item.attrs.size),
                            modified:
                                item.attrs.mtime instanceof Date
                                    ? item.attrs.mtime.getTime()
                                    : item.attrs.mtime !== undefined
                                    ? Number(item.attrs.mtime) * 1000
                                    : undefined,
                            permissions: this.formatPermissions(mode),
                            isExecutable: type === 'file' && this.isExecutable(mode),
                        };
                    });
                resolve(this.sortEntries(mapped));
            });
        });

        return entries;
    }

    private sortEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
        return [...entries].sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
    }

    private async deleteEntry(location: 'remote' | 'local', targetPath: string): Promise<string> {
        const normalizedTarget = this.normalizePath(location, targetPath);
        const stats = await this.getEntryStats(location, normalizedTarget);
        if (stats.isDirectory()) {
            await this.deleteDirectory(location, normalizedTarget);
            return this.getParentDir(location, normalizedTarget);
        }

        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            await new Promise<void>((resolve, reject) => {
                sftp.unlink(normalizedTarget, (err?: Error) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            return this.getParentDir(location, normalizedTarget);
        }

        await fs.unlink(normalizedTarget);
        return this.getParentDir(location, normalizedTarget);
    }

    private async deleteEntries(location: 'remote' | 'local', paths: string[]): Promise<string> {
        if (!paths.length) {
            return location === 'remote' ? this.remoteHome ?? '/' : this.localHome;
        }

        const normalizedTargets = paths.map((target) => this.normalizePath(location, target));
        for (const target of normalizedTargets) {
            await this.deleteEntry(location, target);
        }

        return this.getParentDir(location, normalizedTargets[0]);
    }

    private async renameEntry(location: 'remote' | 'local', targetPath: string, newName: string): Promise<string> {
        const normalizedTarget = this.normalizePath(location, targetPath);
        const stats = await this.getEntryStats(location, normalizedTarget);

        const parent = this.getParentDir(location, normalizedTarget);
        const destination = location === 'remote' ? path.posix.join(parent, newName) : path.join(parent, newName);

        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            await new Promise<void>((resolve, reject) => {
                sftp.rename(normalizedTarget, destination, (err?: Error) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            return parent;
        }

        await fs.rename(normalizedTarget, destination);
        return parent;
    }

    private async duplicateEntry(location: 'remote' | 'local', targetPath: string): Promise<string> {
        const normalizedTarget = this.normalizePath(location, targetPath);
        const stats = await this.getEntryStats(location, normalizedTarget);

        const parent = this.getParentDir(location, normalizedTarget);
        const baseName = path.basename(normalizedTarget);
        const duplicateName = await this.generateCopyName(location, parent, baseName);
        const destination = location === 'remote' ? path.posix.join(parent, duplicateName) : path.join(parent, duplicateName);

        if (stats.isDirectory()) {
            if (location === 'remote') {
                await this.copyRemoteDirectory(normalizedTarget, destination, stats.mode);
            } else {
                await this.copyLocalDirectory(normalizedTarget, destination, stats.mode);
            }
            return parent;
        }

        if (location === 'remote') {
            await this.copyRemoteFile(normalizedTarget, destination, stats.mode);
            return parent;
        }

        await fs.copyFile(normalizedTarget, destination);
        await this.applyMode('local', destination, stats.mode);
        return parent;
    }

    private async confirmOverwrite(location: 'remote' | 'local', destinationPath: string): Promise<boolean> {
        const baseName = location === 'remote' ? path.posix.basename(destinationPath) : path.basename(destinationPath);
        const locationLabel = location === 'remote' ? 'remote' : 'local';
        const result = await vscode.window.showWarningMessage(
            `A file named "${baseName}" already exists in the ${locationLabel} destination. Overwrite it?`,
            { modal: true },
            'Overwrite'
        );

        return result === 'Overwrite';
    }

    private async copyEntry(
        from: { location: 'remote' | 'local'; path: string },
        toDirectory: { location: 'remote' | 'local'; path: string }
    ): Promise<string> {
        const normalizedSource = this.normalizePath(from.location, from.path);
        const normalizedTargetDir = this.normalizePath(toDirectory.location, toDirectory.path);
        const sourceStats = await this.getEntryStats(from.location, normalizedSource);
        const isDirectory = sourceStats.isDirectory();

        await this.assertDirectory(toDirectory.location, normalizedTargetDir);

        const destinationName = path.basename(normalizedSource);
        const destinationPath = toDirectory.location === 'remote'
            ? path.posix.join(this.normalizePath('remote', normalizedTargetDir), destinationName)
            : path.join(this.normalizePath('local', normalizedTargetDir), destinationName);

        const exists = await this.pathExists(toDirectory.location, destinationPath);
        if (exists) {
            const destinationStats = await this.getEntryStats(toDirectory.location, destinationPath);
            if (isDirectory || destinationStats.isDirectory()) {
                throw new Error('An entry with the same name already exists in the destination.');
            }

            const confirmed = await this.confirmOverwrite(toDirectory.location, destinationPath);
            if (!confirmed) {
                return normalizedTargetDir;
            }
        }

        if (from.location === 'remote' && toDirectory.location === 'remote') {
            if (isDirectory) {
                await this.copyRemoteDirectory(normalizedSource, destinationPath, sourceStats.mode);
            } else {
                await this.copyRemoteFile(normalizedSource, destinationPath, sourceStats.mode);
            }
            return normalizedTargetDir;
        }

        if (from.location === 'remote' && toDirectory.location === 'local') {
            if (isDirectory) {
                await this.downloadDirectory(normalizedSource, destinationPath, sourceStats.mode);
            } else {
                await this.downloadFile(normalizedSource, destinationPath, sourceStats.mode);
            }
            return normalizedTargetDir;
        }

        if (from.location === 'local' && toDirectory.location === 'remote') {
            if (isDirectory) {
                await this.uploadDirectory(normalizedSource, destinationPath, sourceStats.mode);
            } else {
                await this.uploadFile(normalizedSource, destinationPath, sourceStats.mode);
            }
            return normalizedTargetDir;
        }

        if (isDirectory) {
            await this.copyLocalDirectory(normalizedSource, destinationPath, sourceStats.mode);
        } else {
            await fs.copyFile(normalizedSource, destinationPath);
            await this.applyMode('local', destinationPath, sourceStats.mode);
        }
        return normalizedTargetDir;
    }

    private async copyEntries(
        items: { location: 'remote' | 'local'; path: string }[],
        toDirectory: { location: 'remote' | 'local'; path: string }
    ): Promise<string> {
        if (!items.length) {
            return this.normalizePath(toDirectory.location, toDirectory.path);
        }

        for (const item of items) {
            await this.copyEntry(item, toDirectory);
        }

        return this.normalizePath(toDirectory.location, toDirectory.path);
    }

    private async openTerminal(location: 'remote' | 'local', directoryPath: string): Promise<void> {
        const normalizedDir = this.normalizePath(
            location,
            directoryPath || (location === 'remote' ? this.remoteHome ?? '/' : this.localHome)
        );

        if (location === 'remote') {
            const terminal = vscode.window.createTerminal({
                name: `${this.device.name} SSH`,
                pty: new SshTerminalSession(this.device, this.context, normalizedDir),
            });
            terminal.show(true);
            return;
        }

        const stats = await fs.stat(normalizedDir);
        if (!stats.isDirectory()) {
            throw new Error(`Target path is not a directory: ${normalizedDir}`);
        }

        const terminal = vscode.window.createTerminal({
            name: `Local: ${path.basename(normalizedDir) || normalizedDir}`,
            cwd: normalizedDir,
        });
        terminal.show(true);
    }

    private async viewContent(location: 'remote' | 'local', targetPath: string): Promise<void> {
        if (location !== 'remote') {
            throw new Error('Viewing content is only supported for remote files.');
        }

        const normalizedTarget = this.normalizePath('remote', targetPath);
        const stats = await this.getEntryStats('remote', normalizedTarget);
        if (!stats.isFile()) {
            throw new Error('Only files can be opened for viewing.');
        }

        const tempDir = await this.ensureViewContentDirectory();
        const baseName = path.posix.basename(normalizedTarget);
        const extension = path.posix.extname(baseName);
        const stem = extension ? baseName.slice(0, -extension.length) : baseName;
        const uniqueSuffix = createHash('sha256').update(normalizedTarget).digest('hex').slice(0, 8);
        const tempFileName = `${stem}-${uniqueSuffix}${extension}`;
        const localPath = path.join(tempDir, tempFileName);

        await this.downloadFile(normalizedTarget, localPath);
        this.viewedTempFiles.set(localPath, { remotePath: normalizedTarget });

        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(localPath));
        await vscode.window.showTextDocument(document, { preview: false });
        this.postMessage({ type: 'status', message: `Opened ${baseName} from remote.` });
    }

    private async runEntry(location: 'remote' | 'local', targetPath: string): Promise<void> {
        if (location !== 'remote') {
            throw new Error('Running files is only supported for remote entries.');
        }

        const normalizedTarget = this.normalizePath('remote', targetPath);
        const stats = await this.getEntryStats('remote', normalizedTarget);
        if (stats.isDirectory()) {
            throw new Error('Cannot run a directory.');
        }
        if (!this.isExecutable(stats.mode)) {
            throw new Error('The selected file is not executable.');
        }

        const runner = new SshCommandRunner(this.device, this.context);
        const command = this.quoteRemotePath(normalizedTarget);
        const title = `Running ${path.posix.basename(normalizedTarget)} on ${this.device.name}`;

        await vscode.window.withProgress(
            { title, location: vscode.ProgressLocation.Notification },
            async () => {
                const output = await runner.run({ name: normalizedTarget, command });
                const trimmed = output.trim();
                const message = trimmed || `Command "${normalizedTarget}" finished on ${this.device.name}.`;
                vscode.window.showInformationMessage(message);
            }
        );
    }

    private updateConnectionStatus(state: ConnectionState, countdownSeconds?: number, overrideMessage?: string): void {
        this.connectionState = state;
        const message =
            overrideMessage
                ?? (state === 'connected'
                    ? 'Connected'
                    : state === 'reconnecting'
                    ? 'Reconnecting…'
                    : countdownSeconds !== undefined
                    ? `Disconnected. Reconnecting in ${countdownSeconds}s…`
                    : 'Disconnected. Reconnecting…');
        this.postMessage({ type: 'connectionStatus', state, countdownSeconds, message });
    }

    private clearReconnectTimers(): void {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = undefined;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private handleDisconnect(): void {
        if (this.disposed || this.connectionState === 'disconnected') {
            return;
        }

        this.sftp = undefined;
        this.sftpReady = undefined;
        this.client = undefined;
        this.startReconnectCountdown();
    }

    private startReconnectCountdown(): void {
        if (this.disposed) {
            return;
        }

        this.clearReconnectTimers();
        let remainingSeconds = Math.max(1, Math.floor(this.reconnectDelayMs / 1000));
        this.updateConnectionStatus('disconnected', remainingSeconds);

        this.countdownTimer = setInterval(() => {
            remainingSeconds -= 1;
            if (remainingSeconds <= 0) {
                this.clearReconnectTimers();
                void this.attemptReconnect();
                return;
            }
            this.updateConnectionStatus('disconnected', remainingSeconds);
        }, 1000);

        this.reconnectTimer = setTimeout(() => {
            this.clearReconnectTimers();
            void this.attemptReconnect();
        }, this.reconnectDelayMs);
    }

    private async attemptReconnect(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.updateConnectionStatus('reconnecting');
        try {
            this.sftpReady = this.createSftpConnection(true);
            this.sftp = await this.sftpReady;
            this.updateConnectionStatus('connected');
            await this.refreshRemoteViewsAfterReconnect();
        } catch (err: any) {
            const messageText = err instanceof HostKeyMismatchError ? err.message : err?.message ?? String(err);
            this.postMessage({ type: 'error', message: messageText });
            vscode.window.showErrorMessage(messageText);
            this.startReconnectCountdown();
        }
    }

    private async refreshRemoteViewsAfterReconnect(): Promise<void> {
        const leftPath = this.remotePaths.left ?? this.remoteHome ?? '/';
        await this.listAndPost('remote', leftPath, 'remote', 'left');

        const rightPath = this.remotePaths.right ?? this.remoteHome;
        if (rightPath && rightPath !== leftPath) {
            await this.listAndPost('remote', rightPath, 'rightRemote', 'right');
        }
    }

    private async getRemoteHome(): Promise<string> {
        if (this.remoteHome) {
            return this.remoteHome;
        }

        const sftp = await this.ensureSftp();
        this.remoteHome = await new Promise<string>((resolve, reject) => {
            sftp.realpath('.', (err: Error | undefined, absPath?: string) => {
                if (err || !absPath) {
                    reject(err ?? new Error('Unable to resolve remote home directory.'));
                } else {
                    resolve(absPath);
                }
            });
        });

        return this.remoteHome;
    }

    private async getEntryStats(location: 'remote' | 'local', targetPath: string): Promise<FileStat> {
        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            const stats = await new Promise<FileStat>((resolve, reject) => {
                sftp.stat(targetPath, (err: Error | undefined, attr?: FileStat) => {
                    if (err || !attr) {
                        reject(err ?? new Error('Unable to read remote file information.'));
                        return;
                    }
                    resolve(attr);
                });
            });
            return stats;
        }

        return fs.stat(targetPath);
    }

    private async getPermissionsInfo(location: 'remote' | 'local', targetPath: string): Promise<PermissionsInfo> {
        const normalizedTarget = this.normalizePath(location, targetPath);
        const stats = await this.getEntryStats(location, normalizedTarget);
        if (stats.mode === undefined) {
            throw new Error('Unable to read permissions for the selected entry.');
        }

        const isDirectory = stats.isDirectory();
        const name = location === 'remote' ? path.posix.basename(normalizedTarget) : path.basename(normalizedTarget);

        const { ownerName, groupName } = await this.resolveOwnerGroupNames(location, stats.uid, stats.gid);

        return {
            path: normalizedTarget,
            location,
            name,
            type: isDirectory ? 'directory' : 'file',
            mode: stats.mode,
            owner: stats.uid,
            group: stats.gid,
            ownerName,
            groupName,
        };
    }

    private sanitizeName(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }
        const trimmed = value.trim();
        return /^[\w.-]+$/.test(trimmed) ? trimmed : undefined;
    }

    private parseGetentName(output: string): string | undefined {
        const line = output.trim().split('\n')[0];
        if (!line) {
            return undefined;
        }
        const [name] = line.split(':');
        return name || undefined;
    }

    private async lookupLocalName(kind: 'user' | 'group', id?: number): Promise<string | undefined> {
        if (id === undefined) {
            return undefined;
        }
        try {
            const { stdout } = await execFileAsync('getent', [kind === 'user' ? 'passwd' : 'group', String(id)]);
            const name = this.parseGetentName(stdout);
            if (name) {
                return name;
            }
        } catch (err) {
            // ignore and fall back
        }

        try {
            const args = kind === 'user' ? ['-nu', String(id)] : ['-ng', String(id)];
            const { stdout } = await execFileAsync('id', args);
            const name = stdout.trim();
            return name || undefined;
        } catch (err) {
            return undefined;
        }
    }

    private async lookupLocalId(kind: 'user' | 'group', name: string): Promise<number | undefined> {
        const sanitized = this.sanitizeName(name);
        if (!sanitized) {
            throw new Error('Names may only include letters, numbers, underscore, dash, or dot.');
        }
        try {
            const args = kind === 'user' ? ['-u', sanitized] : ['-g', sanitized];
            const { stdout } = await execFileAsync('id', args);
            const value = Number(stdout.trim());
            return Number.isInteger(value) ? value : undefined;
        } catch (err) {
            return undefined;
        }
    }

    private async execRemoteCommand(command: string): Promise<string> {
        await this.ensureSftp();
        const client = this.client;
        if (!client) {
            throw new Error('SSH client is not connected.');
        }
        return await new Promise<string>((resolve, reject) => {
            client.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }
                let output = '';
                let errorOutput = '';
                let exitCode: number | null = null;
                stream.on('data', (chunk: Buffer) => {
                    output += chunk.toString();
                });
                stream.stderr.on('data', (chunk: Buffer) => {
                    errorOutput += chunk.toString();
                });
                stream.on('exit', (code: number | null) => {
                    exitCode = code;
                });
                stream.on('close', () => {
                    if (exitCode === 0) {
                        resolve(output);
                    } else {
                        reject(new Error(errorOutput || `Command exited with code ${exitCode ?? 'unknown'}`));
                    }
                });
            });
        });
    }

    private async lookupRemoteName(kind: 'user' | 'group', id?: number): Promise<string | undefined> {
        if (id === undefined || id < 0) {
            return undefined;
        }
        const commands = [
            `getent ${kind === 'user' ? 'passwd' : 'group'} ${id}`,
            `id -n${kind === 'user' ? 'u' : 'g'} ${id}`,
        ];
        for (const command of commands) {
            try {
                const output = await this.execRemoteCommand(command);
                const name = command.startsWith('getent') ? this.parseGetentName(output) : output.trim();
                if (name) {
                    return name;
                }
            } catch (err) {
                // ignore and try next
            }
        }
        return undefined;
    }

    private async lookupRemoteId(kind: 'user' | 'group', name: string): Promise<number | undefined> {
        const sanitized = this.sanitizeName(name);
        if (!sanitized) {
            throw new Error('Names may only include letters, numbers, underscore, dash, or dot.');
        }
        const command = `id -${kind === 'user' ? 'u' : 'g'} ${sanitized}`;
        try {
            const output = await this.execRemoteCommand(command);
            const value = Number(output.trim());
            return Number.isInteger(value) ? value : undefined;
        } catch (err) {
            return undefined;
        }
    }

    private async resolveOwnerGroupNames(
        location: 'remote' | 'local',
        owner?: number,
        group?: number
    ): Promise<{ ownerName?: string; groupName?: string }> {
        if (location === 'remote') {
            const [ownerName, groupName] = await Promise.all([
                this.lookupRemoteName('user', owner),
                this.lookupRemoteName('group', group),
            ]);
            return { ownerName, groupName };
        }

        const [ownerName, groupName] = await Promise.all([
            this.lookupLocalName('user', owner),
            this.lookupLocalName('group', group),
        ]);
        return { ownerName, groupName };
    }

    private async resolveOwnerGroupIds(
        location: 'remote' | 'local',
        owner?: number | string,
        group?: number | string
    ): Promise<{ owner?: number; group?: number }> {
        const ownerIdPromise = typeof owner === 'string'
            ? location === 'remote'
                ? this.lookupRemoteId('user', owner)
                : this.lookupLocalId('user', owner)
            : Promise.resolve(owner);
        const groupIdPromise = typeof group === 'string'
            ? location === 'remote'
                ? this.lookupRemoteId('group', group)
                : this.lookupLocalId('group', group)
            : Promise.resolve(group);

        const [ownerId, groupId] = await Promise.all([ownerIdPromise, groupIdPromise]);

        if (typeof owner === 'string' && ownerId === undefined) {
            throw new Error(`Unable to resolve owner name "${owner}".`);
        }
        if (typeof group === 'string' && groupId === undefined) {
            throw new Error(`Unable to resolve group name "${group}".`);
        }
        return { owner: ownerId, group: groupId };
    }

    private mergeMode(existingMode: number | undefined, requestedMode: number): number {
        const base = existingMode ?? 0;
        return (base & ~0o777) | (requestedMode & 0o777);
    }

    private async applyMode(location: 'remote' | 'local', targetPath: string, mode?: number): Promise<void> {
        if (mode === undefined) {
            return;
        }

        const normalizedTarget = this.normalizePath(location, targetPath);
        const normalizedMode = this.mergeMode(mode, mode);

        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            await new Promise<void>((resolve, reject) => {
                sftp.setstat(normalizedTarget, { mode: normalizedMode }, (err?: Error) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
            return;
        }

        await fs.chmod(normalizedTarget, normalizedMode & 0o7777);
    }

    private async applyPermissions(
        location: 'remote' | 'local',
        targetPath: string,
        mode: number,
        owner?: number,
        group?: number
    ): Promise<string> {
        const normalizedTarget = this.normalizePath(location, targetPath);
        const stats = await this.getEntryStats(location, normalizedTarget);

        const updatedMode = this.mergeMode(stats.mode, mode);
        const parentDir = this.getParentDir(location, normalizedTarget);

        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            const attrs: { mode: number; uid?: number; gid?: number } = { mode: updatedMode };
            if (owner !== undefined) {
                attrs.uid = owner;
            }
            if (group !== undefined) {
                attrs.gid = group;
            }
            await new Promise<void>((resolve, reject) => {
                sftp.setstat(normalizedTarget, attrs, (err?: Error) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
            return parentDir;
        }

        await fs.chmod(normalizedTarget, updatedMode);
        if (owner !== undefined || group !== undefined) {
            const uid = owner ?? stats.uid;
            const gid = group ?? stats.gid;
            if (uid === undefined || gid === undefined) {
                throw new Error('Unable to change owner or group because current identifiers are unavailable.');
            }
            await fs.chown(normalizedTarget, uid, gid);
        }

        return parentDir;
    }

    private async applyPermissionsBatch(
        location: 'remote' | 'local',
        paths: string[],
        mode: number,
        owner?: number,
        group?: number
    ): Promise<string> {
        if (!paths.length) {
            return location === 'remote' ? this.remoteHome ?? '/' : this.localHome;
        }

        const normalizedPaths = paths.map((target) => this.normalizePath(location, target));
        for (const target of normalizedPaths) {
            await this.applyPermissions(location, target, mode, owner, group);
        }

        return this.getParentDir(location, normalizedPaths[0]);
    }

    private async assertDirectory(location: 'remote' | 'local', dirPath: string): Promise<void> {
        const stats = await this.getEntryStats(location, dirPath);
        if (!stats.isDirectory()) {
            throw new Error('Destination path must be a directory.');
        }
    }

    private async ensureDirectoryExists(location: 'remote' | 'local', dirPath: string): Promise<void> {
        const exists = await this.pathExists(location, dirPath);
        if (!exists) {
            throw new Error(`${location === 'remote' ? 'Remote' : 'Local'} path not found: ${dirPath}`);
        }
        await this.assertDirectory(location, dirPath);
    }

    private async deleteDirectory(location: 'remote' | 'local', dirPath: string): Promise<void> {
        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            await this.deleteRemoteDirectoryRecursive(sftp, dirPath);
            return;
        }

        await fs.rm(dirPath, { recursive: true, force: false });
    }

    private async pathExists(location: 'remote' | 'local', targetPath: string): Promise<boolean> {
        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            return await new Promise<boolean>((resolve) => {
                sftp.stat(targetPath, (err: Error | undefined) => {
                    resolve(!err);
                });
            });
        }

        try {
            await fs.stat(targetPath);
            return true;
        } catch {
            return false;
        }
    }

    private validateEntryName(name: string): string {
        const trimmed = name.trim();
        if (!trimmed) {
            throw new Error('A name is required.');
        }
        if (/[\\/]/.test(trimmed)) {
            throw new Error('Names must not include path separators.');
        }
        return trimmed;
    }

    private async createDirectory(location: 'remote' | 'local', directoryPath: string, name: string): Promise<string> {
        const trimmed = this.validateEntryName(name);
        const normalizedDir = this.normalizePath(location, directoryPath);
        await this.assertDirectory(location, normalizedDir);

        const destination = location === 'remote'
            ? path.posix.join(normalizedDir, trimmed)
            : path.join(normalizedDir, trimmed);

        const exists = await this.pathExists(location, destination);
        if (exists) {
            throw new Error('An entry with that name already exists.');
        }

        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            await new Promise<void>((resolve, reject) => {
                sftp.mkdir(destination, (err?: Error) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
            return normalizedDir;
        }

        await fs.mkdir(destination);
        return normalizedDir;
    }

    private async createFile(location: 'remote' | 'local', directoryPath: string, name: string): Promise<string> {
        const trimmed = this.validateEntryName(name);
        const normalizedDir = this.normalizePath(location, directoryPath);
        await this.assertDirectory(location, normalizedDir);

        const destination = location === 'remote'
            ? path.posix.join(normalizedDir, trimmed)
            : path.join(normalizedDir, trimmed);

        const exists = await this.pathExists(location, destination);
        if (exists) {
            throw new Error('An entry with that name already exists.');
        }

        if (location === 'remote') {
            const sftp = await this.ensureSftp();
            await new Promise<void>((resolve, reject) => {
                const writeStream = sftp.createWriteStream(destination);
                let finished = false;

                const fail = (err: Error) => {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    writeStream.destroy();
                    reject(err);
                };

                writeStream.on('error', fail);
                writeStream.on('close', () => {
                    if (!finished) {
                        finished = true;
                        resolve();
                    }
                });

                writeStream.end();
            });
            return normalizedDir;
        }

        await fs.writeFile(destination, '', { flag: 'wx' });
        return normalizedDir;
    }

    private async generateCopyName(location: 'remote' | 'local', directory: string, baseName: string): Promise<string> {
        const ext = path.extname(baseName);
        const nameWithoutExt = path.basename(baseName, ext);
        let attempt = 1;

        while (true) {
            const candidate = `${nameWithoutExt} (copy ${attempt})${ext}`;
            const candidatePath = location === 'remote' ? path.posix.join(directory, candidate) : path.join(directory, candidate);
            const exists = await this.pathExists(location, candidatePath);
            if (!exists) {
                return candidate;
            }
            attempt += 1;
        }
    }

    private async copyRemoteFile(source: string, destination: string, mode?: number): Promise<void> {
        const sftp = await this.ensureSftp();
        await new Promise<void>((resolve, reject) => {
            const readStream = sftp.createReadStream(source);
            const writeStream = sftp.createWriteStream(destination);
            let completed = false;

            const fail = (err: Error) => {
                if (completed) {
                    return;
                }
                completed = true;
                readStream.destroy();
                writeStream.destroy();
                reject(err);
            };

            readStream.on('error', fail);
            writeStream.on('error', fail);
            writeStream.on('close', () => {
                if (!completed) {
                    completed = true;
                    resolve();
                }
            });

            readStream.pipe(writeStream);
        });

        await this.applyMode('remote', destination, mode);
    }

    private async copyRemoteDirectory(source: string, destination: string, mode?: number): Promise<void> {
        const sftp = await this.ensureSftp();
        await new Promise<void>((resolve, reject) => {
            sftp.mkdir(destination, (err?: Error) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });

        await this.applyMode('remote', destination, mode);

        const entries = await new Promise<SftpFileEntry[]>((resolve, reject) => {
            sftp.readdir(source, (err: Error | undefined, items?: SftpFileEntry[]) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(items || []);
            });
        });

        for (const entry of entries) {
            if (entry.filename === '.' || entry.filename === '..') {
                continue;
            }
            const childSource = path.posix.join(source, entry.filename);
            const childDestination = path.posix.join(destination, entry.filename);
            if (entry.attrs.isDirectory()) {
                await this.copyRemoteDirectory(childSource, childDestination, entry.attrs.mode);
            } else {
                await this.copyRemoteFile(childSource, childDestination, entry.attrs.mode);
            }
        }
    }

    private async copyLocalDirectory(source: string, destination: string, mode?: number): Promise<void> {
        await fs.mkdir(destination);
        await this.applyMode('local', destination, mode);
        const entries = await fs.readdir(source, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name === '.' || entry.name === '..') {
                continue;
            }
            const childSource = path.join(source, entry.name);
            const childDestination = path.join(destination, entry.name);
            const childStats = await fs.stat(childSource);
            if (entry.isDirectory()) {
                await this.copyLocalDirectory(childSource, childDestination, childStats.mode);
            } else {
                await fs.copyFile(childSource, childDestination);
                await this.applyMode('local', childDestination, childStats.mode);
            }
        }
    }

    private async downloadDirectory(remoteSource: string, localDestination: string, mode?: number): Promise<void> {
        const sftp = await this.ensureSftp();
        await fs.mkdir(localDestination);
        await this.applyMode('local', localDestination, mode);

        const entries = await new Promise<SftpFileEntry[]>((resolve, reject) => {
            sftp.readdir(remoteSource, (err: Error | undefined, items?: SftpFileEntry[]) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(items || []);
            });
        });

        for (const entry of entries) {
            if (entry.filename === '.' || entry.filename === '..') {
                continue;
            }
            const childSource = path.posix.join(remoteSource, entry.filename);
            const childDestination = path.join(localDestination, entry.filename);
            if (entry.attrs.isDirectory()) {
                await this.downloadDirectory(childSource, childDestination, entry.attrs.mode);
            } else {
                await this.downloadFile(childSource, childDestination, entry.attrs.mode);
            }
        }
    }

    private async uploadDirectory(localSource: string, remoteDestination: string, mode?: number): Promise<void> {
        const sftp = await this.ensureSftp();
        await new Promise<void>((resolve, reject) => {
            sftp.mkdir(remoteDestination, (err?: Error) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });

        await this.applyMode('remote', remoteDestination, mode);

        const entries = await fs.readdir(localSource, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === '.' || entry.name === '..') {
                continue;
            }
            const childSource = path.join(localSource, entry.name);
            const childDestination = path.posix.join(remoteDestination, entry.name);
            const childStats = await fs.stat(childSource);
            if (entry.isDirectory()) {
                await this.uploadDirectory(childSource, childDestination, childStats.mode);
            } else {
                await this.uploadFile(childSource, childDestination, childStats.mode);
            }
        }
    }

    private async deleteRemoteDirectoryRecursive(sftp: SftpClient, dirPath: string): Promise<void> {
        const entries = await new Promise<SftpFileEntry[]>((resolve, reject) => {
            sftp.readdir(dirPath, (err: Error | undefined, items?: SftpFileEntry[]) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(items || []);
            });
        });

        for (const entry of entries) {
            if (entry.filename === '.' || entry.filename === '..') {
                continue;
            }
            const childPath = path.posix.join(dirPath, entry.filename);
            if (entry.attrs.isDirectory()) {
                await this.deleteRemoteDirectoryRecursive(sftp, childPath);
            } else {
                await new Promise<void>((resolve, reject) => {
                    sftp.unlink(childPath, (err?: Error) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    });
                });
            }
        }

        await new Promise<void>((resolve, reject) => {
            sftp.rmdir(dirPath, (err?: Error) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    private async downloadFile(remotePath: string, localPath: string, mode?: number): Promise<void> {
        const sftp = await this.ensureSftp();
        await new Promise<void>((resolve, reject) => {
            sftp.fastGet(remotePath, localPath, (err?: Error) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        await this.applyMode('local', localPath, mode);
    }

    private async ensureViewContentDirectory(): Promise<string> {
        if (!this.viewContentDirectory) {
            const dir = path.join(os.tmpdir(), 'vscode-logger-view');
            await fs.mkdir(dir, { recursive: true });
            this.viewContentDirectory = dir;
        }
        return this.viewContentDirectory;
    }

    private async handleTempFileSave(doc: vscode.TextDocument): Promise<void> {
        const mapping = this.viewedTempFiles.get(doc.uri.fsPath);
        if (!mapping) {
            return;
        }

        try {
            await this.uploadFile(doc.uri.fsPath, mapping.remotePath);
            this.postMessage({ type: 'status', message: `Saved to remote: ${path.posix.basename(mapping.remotePath)}` });
        } catch (err: any) {
            const message = err?.message ?? 'Unable to save file back to remote.';
            this.postMessage({ type: 'error', message });
            vscode.window.showErrorMessage(message);
        }
    }

    private async handleTempFileClose(doc: vscode.TextDocument): Promise<void> {
        const mapping = this.viewedTempFiles.get(doc.uri.fsPath);
        if (!mapping) {
            return;
        }
        this.viewedTempFiles.delete(doc.uri.fsPath);
        try {
            await fs.unlink(doc.uri.fsPath);
        } catch (err) {
            // Ignore cleanup errors
        }
    }

    private async cleanupTempFiles(): Promise<void> {
        const entries = [...this.viewedTempFiles.keys()];
        this.viewedTempFiles.clear();
        await Promise.all(
            entries.map(async (filePath) => {
                try {
                    await fs.unlink(filePath);
                } catch (err) {
                    // Ignore cleanup errors
                }
            })
        );
    }

    private async uploadFile(localPath: string, remotePath: string, mode?: number): Promise<void> {
        const sftp = await this.ensureSftp();
        await new Promise<void>((resolve, reject) => {
            sftp.fastPut(localPath, remotePath, (err?: Error) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        await this.applyMode('remote', remotePath, mode);
    }

    private postMessage(message: WebviewResponse): void {
        this.panel.webview.postMessage(message);
    }

    private async ensureSftp(): Promise<SftpClient> {
        if (this.sftp) {
            return this.sftp;
        }

        if (this.sftpReady) {
            this.sftp = await this.sftpReady;
            return this.sftp;
        }

        this.sftpReady = this.createSftpConnection(this.hasEverConnected);
        this.sftp = await this.sftpReady;
        this.hasEverConnected = true;
        return this.sftp;
    }

    private async createSftpConnection(isReconnect: boolean): Promise<SftpClient> {
        const validationError = this.validateDeviceConfiguration();
        if (validationError) {
            throw new Error(validationError);
        }

        const auth = await this.getAuthentication();
        const bastion = this.getBastionConfig();
        const bastionAuth = bastion ? await this.getBastionAuthentication(bastion) : undefined;
        const endpoints = getHostEndpoints(this.device);

        if (endpoints.length === 0) {
            throw new Error(`Device "${this.device.name}" is missing a host.`);
        }

        const maxAttempts = endpoints.length > 1 ? 3 : 1;
        let endpointIndex = 0;
        let attempts = 0;
        let lastError: unknown;

        while (attempts < maxAttempts) {
            const endpoint = endpoints[endpointIndex];
            this.activeEndpoint = endpoint;
            const expectedFingerprint = this.getExpectedFingerprint(endpoint);
            const bastionEndpoint =
                bastion && bastion.host
                    ? ({ host: bastion.host, fingerprint: bastion.hostFingerprint, label: 'bastion' } as HostEndpoint)
                    : undefined;
            const expectedBastionFingerprint = bastionEndpoint
                ? this.getExpectedFingerprint(bastionEndpoint)
                : undefined;
            this.hostKeyFailure = undefined;
            this.bastionHostKeyFailure = undefined;
            this.updateConnectionStatus(
                'reconnecting',
                undefined,
                isReconnect ? undefined : `Connecting to ${endpoint.host}…`
            );

            try {
                const sftp = await this.connectToEndpoint(
                    endpoint,
                    auth,
                    expectedFingerprint,
                    bastion,
                    bastionAuth,
                    expectedBastionFingerprint
                );
                return sftp;
            } catch (err) {
                if (err instanceof HostKeyMismatchError) {
                    throw err;
                }

                lastError = err;
                attempts++;

                if (endpoints.length > 1) {
                    endpointIndex = (endpointIndex + 1) % endpoints.length;
                    continue;
                }

                break;
            }
        }

        throw lastError ?? new Error('Failed to connect over SFTP.');
    }

    private validateDeviceConfiguration(): string | undefined {
        const host = this.device.host?.trim();
        const username = this.device.username?.trim();
        if (!host) {
            return `Device "${this.device.name}" is missing a host.`;
        }
        if (!username) {
            return `Device "${this.device.name}" is missing a username.`;
        }
        if (this.device.port !== undefined && (!Number.isInteger(this.device.port) || this.device.port <= 0)) {
            return `Device "${this.device.name}" has an invalid port.`;
        }

        const bastion = this.device.bastion;
        if (bastion) {
            if (!bastion.host?.trim()) {
                return `Device "${this.device.name}" is missing a bastion host.`;
            }
            if (!bastion.username?.trim()) {
                return `Device "${this.device.name}" is missing a bastion username.`;
            }
            if (bastion.port !== undefined && (!Number.isInteger(bastion.port) || bastion.port <= 0)) {
                return `Device "${this.device.name}" has an invalid bastion port.`;
            }
        }

        return undefined;
    }

    private async connectToEndpoint(
        endpoint: HostEndpoint,
        auth: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        expectedFingerprint?: { display: string; hex: string },
        bastion?: BastionConfig,
        bastionAuth?: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        expectedBastionFingerprint?: { display: string; hex: string }
    ): Promise<SftpClient> {
        if (bastion && bastionAuth) {
            return this.connectThroughBastion(
                endpoint,
                auth,
                expectedFingerprint,
                bastion,
                bastionAuth,
                expectedBastionFingerprint
            );
        }

        return this.connectDirect(endpoint, auth, expectedFingerprint);
    }

    private async connectThroughBastion(
        endpoint: HostEndpoint,
        auth: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        expectedFingerprint: { display: string; hex: string } | undefined,
        bastion: BastionConfig,
        bastionAuth: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        expectedBastionFingerprint?: { display: string; hex: string }
    ): Promise<SftpClient> {
        return await new Promise<SftpClient>((resolve, reject) => {
            const bastionClient = new Client() as ForwardingClient;
            this.bastionClient = bastionClient;
            const bastionPort = bastion.port ?? 22;

            bastionClient
                .on('ready', () => {
                    bastionClient.forwardOut('127.0.0.1', 0, endpoint.host, this.device.port ?? 22, (err: Error | undefined, stream: any) => {
                        if (err) {
                            bastionClient.end();
                            reject(err);
                            return;
                        }

                        void this.connectDirect(endpoint, auth, expectedFingerprint, stream, () => bastionClient.end())
                            .then(resolve)
                            .catch((error) => {
                                bastionClient.end();
                                reject(error);
                            });
                    });
                })
                .on('error', (err) => {
                    if (this.bastionHostKeyFailure) {
                        const message = `Host key verification failed for bastion ${bastion.host}:${bastionPort}. Expected ${this.bastionHostKeyFailure.expected} but received ${this.bastionHostKeyFailure.received}.`;
                        reject(
                            new HostKeyMismatchError(
                                message,
                                this.bastionHostKeyFailure.expected,
                                this.bastionHostKeyFailure.received
                            )
                        );
                        return;
                    }
                    reject(new Error(`SSH error: ${err.message}`));
                })
                .on('close', () => {
                    // handled by downstream connection close
                })
                .connect({
                    host: bastion.host,
                    port: bastionPort,
                    username: bastion.username,
                    ...bastionAuth,
                    hostHash: 'sha256',
                    hostVerifier: (key) => this.verifyBastionHostKey(key, expectedBastionFingerprint),
                });
        });
    }

    private async connectDirect(
        endpoint: HostEndpoint,
        auth: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        expectedFingerprint?: { display: string; hex: string },
        sock?: any,
        onComplete?: () => void
    ): Promise<SftpClient> {
        return await new Promise<SftpClient>((resolve, reject) => {
            const client = new Client() as ClientWithSftp;
            this.client = client;

            const port = this.device.port ?? 22;
            const host = endpoint.host;
            const username = this.device.username.trim();
            let completed = false;

            const finalize = () => {
                if (!completed) {
                    completed = true;
                    onComplete?.();
                }
            };

            client
                .on('ready', () => {
                    client.sftp((err: Error | undefined, sftp?: SftpClient) => {
                        if (err || !sftp) {
                            finalize();
                            reject(err ?? new Error('Failed to start SFTP session.'));
                            return;
                        }
                        this.clearReconnectTimers();
                        this.updateConnectionStatus('connected');
                        resolve(sftp);
                    });
                })
                .on('error', (err) => {
                    this.handleDisconnect();
                    finalize();
                    if (this.hostKeyFailure) {
                        const message = `Host key verification failed for ${host}:${port}. Expected ${this.hostKeyFailure.expected} but received ${this.hostKeyFailure.received}.`;
                        reject(
                            new HostKeyMismatchError(message, this.hostKeyFailure.expected, this.hostKeyFailure.received)
                        );
                        return;
                    }
                    reject(new Error(`SSH error: ${err.message}`));
                })
                .on('close', () => {
                    this.handleDisconnect();
                    finalize();
                })
                .connect({
                    host,
                    port,
                    username,
                    sock,
                    ...auth,
                    hostHash: 'sha256',
                    hostVerifier: (key) => this.verifyHostKey(key, expectedFingerprint),
                } as SocketConnectConfig);
        });
    }

    private async getAuthentication(): Promise<Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>> {
        const privateKeyPath = this.device.privateKeyPath?.trim();
        if (privateKeyPath) {
            const privateKey = await this.loadPrivateKey(privateKeyPath);
            const passphrase = await this.passwordManager.getPassphrase(this.device, {
                onPrompt: () => this.updateConnectionStatus('reconnecting', undefined, 'Waiting for the user to enter the password…'),
            });
            return { privateKey, passphrase: passphrase || undefined };
        }

        const password = await this.passwordManager.getPassword(this.device, {
            onPrompt: () => this.updateConnectionStatus('reconnecting', undefined, 'Waiting for the user to enter the password…'),
        });
        if (!password) {
            throw new Error('Password or private key is required to connect to the device.');
        }

        return { password };
    }

    private getBastionConfig(): BastionConfig | undefined {
        const bastion = this.device.bastion;
        if (!bastion?.host?.trim() || !bastion.username?.trim()) {
            return undefined;
        }

        return {
            ...bastion,
            host: bastion.host.trim(),
            username: bastion.username.trim(),
            port: bastion.port ?? 22,
            hostFingerprint: bastion.hostFingerprint?.trim(),
            privateKeyPath: bastion.privateKeyPath?.trim(),
        };
    }

    private async getBastionAuthentication(
        bastion: BastionConfig
    ): Promise<Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>> {
        if (bastion.privateKeyPath) {
            const privateKey = await this.loadPrivateKey(bastion.privateKeyPath);
            const bastionDevice = this.getBastionDevice(bastion);
            const passphrase = await this.passwordManager.getPassphrase(bastionDevice, {
                onPrompt: () => this.updateConnectionStatus('reconnecting', undefined, 'Waiting for the user to enter the password…'),
            });
            return { privateKey, passphrase: passphrase || undefined };
        }

        const bastionDevice = this.getBastionDevice(bastion);
        const password = await this.passwordManager.getPassword(bastionDevice, {
            onPrompt: () => this.updateConnectionStatus('reconnecting', undefined, 'Waiting for the user to enter the password…'),
        });
        if (!password) {
            throw new Error('Password or private key is required to connect to the bastion host.');
        }

        return { password };
    }

    private getBastionDevice(bastion: BastionConfig): EmbeddedDevice {
        return {
            id: `${this.device.id}-bastion`,
            name: `${this.device.name} bastion`,
            host: bastion.host,
            username: bastion.username,
        } as EmbeddedDevice;
    }

    private async loadPrivateKey(filePath: string): Promise<Buffer> {
        const expanded = this.expandPath(filePath);
        const content = await fs.readFile(expanded);
        if (!content.length) {
            throw new Error('The private key file is empty.');
        }
        return content;
    }

    private expandPath(value: string): string {
        const envExpanded = value.replace(/\$\{env:([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
        const tildeExpanded = envExpanded.startsWith('~') ? path.join(os.homedir(), envExpanded.slice(1)) : envExpanded;
        return path.resolve(tildeExpanded);
    }

    private getExpectedFingerprint(endpoint: HostEndpoint): { display: string; hex: string } | undefined {
        const fingerprint = endpoint.fingerprint;
        if (!fingerprint) {
            return undefined;
        }

        return this.parseFingerprint(fingerprint);
    }

    private parseFingerprint(value: string): { display: string; hex: string } {
        const trimmed = value.trim();
        if (!trimmed) {
            throw new Error(`Device "${this.device.name}" is missing an SSH host key fingerprint.`);
        }

        const base64Candidate = trimmed.startsWith('SHA256:') ? trimmed.slice(7) : trimmed;
        const base64Pattern = /^[A-Za-z0-9+/=]+$/;
        if (base64Pattern.test(base64Candidate)) {
            try {
                const hex = Buffer.from(base64Candidate, 'base64').toString('hex').toLowerCase();
                if (!hex) {
                    throw new Error();
                }
                return { display: trimmed.startsWith('SHA256:') ? trimmed : `SHA256:${base64Candidate}`, hex };
            } catch {
                // fall through
            }
        }

        const hexCandidate = trimmed.replace(/:/g, '').toLowerCase();
        const isValidHex = /^[0-9a-f]+$/.test(hexCandidate) && hexCandidate.length === 64;
        if (isValidHex) {
            return { display: trimmed, hex: hexCandidate };
        }

        throw new Error(
            `Device "${this.device.name}" has an invalid host fingerprint. Provide the SHA256 fingerprint (for example, "SHA256:..." from ssh-keygen).`
        );
    }

    private verifyHostKey(key: string | Buffer, expected?: { display: string; hex: string }): boolean {
        const actual = this.computeHostKeyFingerprint(key);

        if (!expected) {
            return true;
        }

        const matches = actual.hex === expected.hex;
        if (!matches) {
            this.hostKeyFailure = { expected: expected.display, received: actual.display };
        }

        return matches;
    }

    private verifyBastionHostKey(key: string | Buffer, expected?: { display: string; hex: string }): boolean {
        const actual = this.computeHostKeyFingerprint(key);

        if (!expected) {
            return true;
        }

        const matches = actual.hex === expected.hex;
        if (!matches) {
            this.bastionHostKeyFailure = { expected: expected.display, received: actual.display };
        }

        return matches;
    }

    private computeHostKeyFingerprint(key: string | Buffer): { display: string; hex: string } {
        if (typeof key === 'string') {
            const normalized = key.replace(/:/g, '').toLowerCase();
            const display = `SHA256:${Buffer.from(normalized, 'hex').toString('base64')}`;
            return { display, hex: normalized };
        }

        const digest = createHash('sha256').update(key).digest();
        return {
            display: `SHA256:${digest.toString('base64')}`,
            hex: digest.toString('hex'),
        };
    }

    private getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sftpExplorer.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sftpExplorer.css')));
        const terminalIconUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'terminal.svg'))
        );
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet" />
    <title>SFTP Explorer</title>
</head>
<body>
    <div class="explorer" id="explorer">
        <header class="explorer__header">
            <h2>${this.escapeHtml(this.device.name)} — SFTP Explorer</h2>
            <div id="status" class="status"></div>
        </header>
        <div class="panes">
            <section class="pane pane--remote" id="remotePane" aria-label="Remote files">
                <div class="pane__controls">
                    <div class="actions">
                        <button id="remoteHome" class="action">HOME</button>
                        <button id="remoteUp" class="action">UP</button>
                        <button id="remoteRefresh" class="action">REFRESH</button>
                        <button id="remoteNewFolder" class="action">NEW FOLDER</button>
                        <button id="remoteNewFile" class="action">NEW FILE</button>
                        <button id="remoteToLocal" class="action" disabled title="Copy to right pane">→</button>
                    </div>
                    <div class="path-row">
                        <button
                            id="remoteOpenTerminal"
                            class="action action--icon"
                            title="Open Terminal here"
                            aria-label="Open Terminal here"
                        >
                            <img class="action__icon" src="${terminalIconUri}" alt="">
                        </button>
                        <input
                            class="path-input"
                            id="remotePath"
                            type="text"
                            spellcheck="false"
                            aria-label="Remote path"
                        />
                        <label class="sr-only" for="remotePresetSelect">SFTP preset paths</label>
                        <select class="path-select" id="remotePresetSelect" aria-label="SFTP preset paths">
                            <option value="">Select preset…</option>
                        </select>
                        <button id="remotePresetManage" class="action" type="button">PRESETS</button>
                    </div>
                </div>
                <div id="remoteList" class="list" role="tree"></div>
            </section>
            <section class="pane" id="rightPane" aria-label="Local files">
                <div class="pane__controls">
                    <div class="actions">
                        <label class="mode-picker">
                            <span class="sr-only">Right pane source</span>
                            <select id="rightMode">
                                <option value="local" selected>local</option>
                                <option value="remote">remote</option>
                            </select>
                        </label>
                        <button id="localHome" class="action">HOME</button>
                        <button id="localUp" class="action">UP</button>
                        <button id="localRefresh" class="action">REFRESH</button>
                        <button id="localNewFolder" class="action">NEW FOLDER</button>
                        <button id="localNewFile" class="action">NEW FILE</button>
                        <button id="localToRemote" class="action" disabled title="Copy to left pane">←</button>
                    </div>
                    <div class="path-row">
                        <button
                            id="localOpenTerminal"
                            class="action action--icon"
                            title="Open Terminal here"
                            aria-label="Open Terminal here"
                        >
                            <img class="action__icon" src="${terminalIconUri}" alt="">
                        </button>
                        <input
                            class="path-input"
                            id="localPath"
                            type="text"
                            spellcheck="false"
                            aria-label="Local path"
                        />
                        <label class="sr-only" for="rightPresetSelect">SFTP preset paths</label>
                        <select class="path-select" id="rightPresetSelect" aria-label="SFTP preset paths">
                            <option value="">Select preset…</option>
                        </select>
                        <button id="rightPresetManage" class="action" type="button">PRESETS</button>
                    </div>
                </div>
                <div id="localList" class="list" role="tree"></div>
            </section>
        </div>
        <div class="context-menu" id="contextMenu" role="menu" aria-hidden="true">
            <button class="context-menu__item" id="contextSelect" role="menuitem">Select</button>
            <button class="context-menu__item" id="contextRun" role="menuitem">Run</button>
            <button class="context-menu__item" id="contextViewContent" role="menuitem">View Content</button>
            <button class="context-menu__item" id="contextRename" role="menuitem">Rename</button>
            <button class="context-menu__item" id="contextDuplicate" role="menuitem">Duplicate</button>
            <button class="context-menu__item" id="contextPermissions" role="menuitem">Change Permissions</button>
            <button class="context-menu__item context-menu__item--danger" id="contextDelete" role="menuitem">Delete</button>
        </div>
        <div class="dialog dialog--hidden" id="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" aria-hidden="true">
            <div class="dialog__content">
                <header class="dialog__header">
                    <h3 class="dialog__title" id="confirmTitle">Confirm delete</h3>
                    <button class="dialog__close" id="confirmDismiss" aria-label="Cancel">✕</button>
                </header>
                <div class="dialog__body">
                    <div class="dialog__message" id="confirmMessage"></div>
                </div>
                <div class="dialog__actions">
                    <button class="action action--danger" id="confirmYes">Yes</button>
                    <button class="action action--secondary" id="confirmCancel">Cancel</button>
                </div>
            </div>
        </div>
        <div class="dialog dialog--hidden" id="permissionsDialog" role="dialog" aria-modal="true" aria-labelledby="permissionsTitle" aria-hidden="true">
            <div class="dialog__content">
                <header class="dialog__header">
                    <h3 class="dialog__title" id="permissionsTitle">Change permissions</h3>
                    <button class="dialog__close" id="permissionsDismiss" aria-label="Cancel">✕</button>
                </header>
                <div class="dialog__body">
                    <div class="dialog__target" id="permissionsTarget"></div>
                    <div class="permissions-grid" role="group" aria-label="Permissions">
                        <div class="permissions-grid__heading"></div>
                        <div class="permissions-grid__heading">Read</div>
                        <div class="permissions-grid__heading">Write</div>
                        <div class="permissions-grid__heading">Execute</div>
                        <div class="permissions-grid__label">Owner</div>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permOwnerRead" />
                            <span class="sr-only">Owner read</span>
                        </label>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permOwnerWrite" />
                            <span class="sr-only">Owner write</span>
                        </label>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permOwnerExec" />
                            <span class="sr-only">Owner execute</span>
                        </label>
                        <div class="permissions-grid__label">Group</div>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permGroupRead" />
                            <span class="sr-only">Group read</span>
                        </label>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permGroupWrite" />
                            <span class="sr-only">Group write</span>
                        </label>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permGroupExec" />
                            <span class="sr-only">Group execute</span>
                        </label>
                        <div class="permissions-grid__label">Others</div>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permOtherRead" />
                            <span class="sr-only">Others read</span>
                        </label>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permOtherWrite" />
                            <span class="sr-only">Others write</span>
                        </label>
                        <label class="permissions-grid__cell">
                            <input type="checkbox" id="permOtherExec" />
                            <span class="sr-only">Others execute</span>
                        </label>
                    </div>
                    <div class="dialog__fields">
                        <label class="dialog__field">
                            <span class="dialog__field-label">Owner</span>
                            <input id="permissionsOwner" type="text" />
                        </label>
                        <label class="dialog__field">
                            <span class="dialog__field-label">Group</span>
                            <input id="permissionsGroup" type="text" />
                        </label>
                    </div>
                    <div class="dialog__error" id="permissionsError" role="status" aria-live="polite"></div>
                </div>
                <footer class="dialog__actions">
                    <button class="action action--primary" id="permissionsSave">Save</button>
                    <button class="action" id="permissionsCancel">Cancel</button>
                </footer>
            </div>
        </div>
        <div class="dialog dialog--hidden" id="sftpPresetsDialog" role="dialog" aria-modal="true" aria-labelledby="sftpPresetsTitle" aria-hidden="true">
            <div class="dialog__content">
                <header class="dialog__header">
                    <h3 class="dialog__title" id="sftpPresetsTitle">SFTP presets</h3>
                    <button class="dialog__close" id="sftpPresetsDismiss" aria-label="Cancel">✕</button>
                </header>
                <div class="dialog__body">
                    <div class="preset-list" id="sftpPresetsList"></div>
                </div>
                <footer class="dialog__actions">
                    <button class="action action--primary" id="sftpPresetsSave">Save</button>
                    <button class="action action--secondary" id="sftpPresetsCancel">Cancel</button>
                </footer>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private escapeHtml(value: string): string {
        return value.replace(/[&<>\"]/g, (char) => {
            switch (char) {
                case '&':
                    return '&amp;';
                case '<':
                    return '&lt;';
                case '>':
                    return '&gt;';
                case '"':
                    return '&quot;';
                default:
                    return char;
            }
        });
    }
}

function getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 })
        .map(() => possible.charAt(Math.floor(Math.random() * possible.length)))
        .join('');
}
