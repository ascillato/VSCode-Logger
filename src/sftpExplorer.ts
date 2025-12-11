/**
 * @file sftpExplorer.ts
 * @brief Provides a Webview panel to browse and transfer files over SFTP.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { Client, ConnectConfig } from 'ssh2';
import { Readable, Writable } from 'stream';
import { EmbeddedDevice } from './deviceTree';
import { PasswordManager } from './passwordManager';

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

type ConfirmationResponse = { type: 'confirmationResult'; requestId: string; confirmed: boolean };
type InputResponse = { type: 'inputResult'; requestId: string; value?: string };

type WebviewResponse =
    | InitResponse
    | ListResponse
    | StatusMessage
    | ErrorMessage
    | ConfirmationResponse
    | InputResponse
    | ConnectionStatusMessage;

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
    | { type: 'requestConfirmation'; message: string; requestId: string }
    | { type: 'requestInput'; prompt: string; value?: string; requestId: string };

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
};

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

    private client?: ClientWithSftp;
    private sftp?: SftpClient;
    private sftpReady?: Promise<SftpClient>;
    private remoteHome?: string;
    private hostKeyFailure?: HostKeyMismatch;
    private remotePaths: { left?: string; right?: string } = {};
    private connectionState: ConnectionState = 'connected';
    private countdownTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;
    private readonly reconnectDelayMs = 5000;
    private hasEverConnected = false;
    private disposed = false;

    readonly onDidDispose = this.onDidDisposeEmitter.event;

    constructor(private readonly context: vscode.ExtensionContext, private readonly device: EmbeddedDevice) {
        this.passwordManager = new PasswordManager(context);
        this.localHome = os.homedir();

        this.panel = vscode.window.createWebviewPanel(
            'embeddedLoggerSftpExplorer',
            `${device.name} SFTP Explorer`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
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
    }

    async start(): Promise<void> {
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
        this.panel.dispose();
    }

    private async handleMessage(message: WebviewRequest): Promise<void> {
        try {
            switch (message.type) {
                case 'requestInit':
                    await this.postInitialState();
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
                case 'requestConfirmation': {
                    const result = await vscode.window.showWarningMessage(
                        message.message,
                        { modal: true },
                        'Yes',
                        'No'
                    );
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

        const payload: InitResponse = {
            type: 'init',
            remoteHome,
            localHome: this.localHome,
            remote: remoteSnapshot,
            local: localSnapshot,
        };

        this.remotePaths = { left: remoteSnapshot.path, right: remoteSnapshot.path };
        this.updateConnectionStatus('connected');
        this.postMessage(payload);
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
        if (!stats.isFile()) {
            throw new Error('Only file deletions are supported from the explorer.');
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

    private async renameEntry(location: 'remote' | 'local', targetPath: string, newName: string): Promise<string> {
        const normalizedTarget = this.normalizePath(location, targetPath);
        const stats = await this.getEntryStats(location, normalizedTarget);
        if (!stats.isFile()) {
            throw new Error('Only file renames are supported from the explorer.');
        }

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
        if (!stats.isFile()) {
            throw new Error('Only file duplication is supported.');
        }

        const parent = this.getParentDir(location, normalizedTarget);
        const baseName = path.basename(normalizedTarget);
        const duplicateName = await this.generateCopyName(location, parent, baseName);
        const destination = location === 'remote' ? path.posix.join(parent, duplicateName) : path.join(parent, duplicateName);

        if (location === 'remote') {
            await this.copyRemoteFile(normalizedTarget, destination);
            return parent;
        }

        await fs.copyFile(normalizedTarget, destination);
        return parent;
    }

    private async copyEntry(
        from: { location: 'remote' | 'local'; path: string },
        toDirectory: { location: 'remote' | 'local'; path: string }
    ): Promise<string> {
        const normalizedSource = this.normalizePath(from.location, from.path);
        const normalizedTargetDir = this.normalizePath(toDirectory.location, toDirectory.path);
        const sourceStats = await this.getEntryStats(from.location, normalizedSource);
        if (!sourceStats.isFile()) {
            throw new Error('Select a file to copy. Folder transfers are not supported.');
        }

        await this.assertDirectory(toDirectory.location, normalizedTargetDir);

        const destinationName = path.basename(normalizedSource);
        const destinationPath = toDirectory.location === 'remote'
            ? path.posix.join(this.normalizePath('remote', normalizedTargetDir), destinationName)
            : path.join(this.normalizePath('local', normalizedTargetDir), destinationName);

        const exists = await this.pathExists(toDirectory.location, destinationPath);
        if (exists) {
            throw new Error('A file with the same name already exists in the destination.');
        }

        if (from.location === 'remote' && toDirectory.location === 'remote') {
            await this.copyRemoteFile(normalizedSource, destinationPath);
            return normalizedTargetDir;
        }

        if (from.location === 'remote' && toDirectory.location === 'local') {
            await this.downloadFile(normalizedSource, destinationPath);
            return normalizedTargetDir;
        }

        if (from.location === 'local' && toDirectory.location === 'remote') {
            await this.uploadFile(normalizedSource, destinationPath);
            return normalizedTargetDir;
        }

        await fs.copyFile(normalizedSource, destinationPath);
        return normalizedTargetDir;
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

    private async assertDirectory(location: 'remote' | 'local', dirPath: string): Promise<void> {
        const stats = await this.getEntryStats(location, dirPath);
        if (!stats.isDirectory()) {
            throw new Error('Destination path must be a directory.');
        }
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

    private async copyRemoteFile(source: string, destination: string): Promise<void> {
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
    }

    private async downloadFile(remotePath: string, localPath: string): Promise<void> {
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
    }

    private async uploadFile(localPath: string, remotePath: string): Promise<void> {
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
        const auth = await this.getAuthentication();
        const expectedFingerprint = this.getExpectedFingerprint();
        this.hostKeyFailure = undefined;
        this.updateConnectionStatus('reconnecting', undefined, isReconnect ? undefined : 'Connecting…');

        return await new Promise<SftpClient>((resolve, reject) => {
            const client = new Client() as ClientWithSftp;
            this.client = client;

            const port = this.device.port ?? 22;
            const host = this.device.host.trim();
            const username = this.device.username.trim();

            client
                .on('ready', () => {
                    client.sftp((err: Error | undefined, sftp?: SftpClient) => {
                        if (err || !sftp) {
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
                    if (this.hostKeyFailure) {
                        const message = `Host key verification failed for ${host}:${port}. Expected ${this.hostKeyFailure.expected} but received ${this.hostKeyFailure.received}.`;
                        reject(new HostKeyMismatchError(message, this.hostKeyFailure.expected, this.hostKeyFailure.received));
                        return;
                    }
                    reject(new Error(`SSH error: ${err.message}`));
                })
                .on('close', () => {
                    this.handleDisconnect();
                })
                .connect({
                    host,
                    port,
                    username,
                    ...auth,
                    hostHash: 'sha256',
                    hostVerifier: (key) => this.verifyHostKey(key, expectedFingerprint),
                });
        });
    }

    private async getAuthentication(): Promise<Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>> {
        const privateKeyPath = this.device.privateKeyPath?.trim();
        if (privateKeyPath) {
            const privateKey = await this.loadPrivateKey(privateKeyPath);
            const passphrase = await this.passwordManager.getPassphrase(this.device);
            return { privateKey, passphrase: passphrase || undefined };
        }

        const password = await this.passwordManager.getPassword(this.device);
        if (!password) {
            throw new Error('Password or private key is required to connect to the device.');
        }

        return { password };
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

    private getExpectedFingerprint(): { display: string; hex: string } | undefined {
        const fingerprint = this.device.hostFingerprint?.trim();
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
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
                    <div class="path" id="remotePath"></div>
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
                    <div class="path" id="localPath"></div>
                </div>
                <div id="localList" class="list" role="tree"></div>
            </section>
        </div>
        <div class="context-menu" id="contextMenu" role="menu" aria-hidden="true">
            <button class="context-menu__item" id="contextRename" role="menuitem">Rename</button>
            <button class="context-menu__item" id="contextDuplicate" role="menuitem">Duplicate</button>
            <button class="context-menu__item context-menu__item--danger" id="contextDelete" role="menuitem">Delete</button>
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
