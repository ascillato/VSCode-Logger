/**
 * Hosts the log panel Webview and coordinates streaming, presets, and highlights.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { EmbeddedDevice } from '../deviceTree';
import { LogSession } from '../logSession';
import type { HighlightDefinition } from '../highlights';
import { getEmbeddedLoggerConfiguration } from '../configuration';
import { AutoSaveManager } from './autoSaveManager';
import { buildLogPanelHtml } from './html';
import { parseWebviewMessage } from './messageParser';
import { WorkspaceStateStore } from './stateStore';
import type { FilterPreset, LogPanelTarget } from './types';

/**
 * Lifecycle manager for a single log panel instance.
 */
export class LogPanel {
  private readonly panel: vscode.WebviewPanel;
  private session?: LogSession;
  private readonly presetsKey: string;
  private readonly highlightsKey: string;
  private readonly targetName: string;
  private readonly targetId: string;
  private readonly initialLines: string[] = [];
  private readonly sourcePath?: string;
  private readonly device?: EmbeddedDevice;
  private highlights: HighlightDefinition[];
  private readonly maxLogEntries: number;
  private readonly webviewReady: Promise<void>;
  private readonly stateStore: WorkspaceStateStore;
  private readonly autoSaveManager: AutoSaveManager;
  private resolveWebviewReady?: () => void;
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    target: LogPanelTarget,
    private readonly onDispose: () => void
  ) {
    if (target.type === 'remote') {
      this.device = target.device;
      this.targetName = target.device.name;
      this.targetId = target.device.id;
    } else {
      this.targetName = target.name;
      this.targetId = target.id;
      this.initialLines = target.lines;
      this.sourcePath = target.filePath;
    }

    this.presetsKey = `embeddedLogger.presets.${this.targetId}`;
    this.highlightsKey = `embeddedLogger.highlights.${this.targetId}`;
    this.stateStore = new WorkspaceStateStore(this.context, this.presetsKey, this.highlightsKey);
    this.highlights = this.stateStore.getStoredHighlights();
    this.maxLogEntries = getEmbeddedLoggerConfiguration().maxLinesPerTab;
    this.autoSaveManager = new AutoSaveManager();

    this.panel = vscode.window.createWebviewPanel(
      'embeddedLogger.logPanel',
      `${this.targetName} Logs`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'media')),
          vscode.Uri.file(path.join(context.extensionPath, 'resources')),
        ],
      }
    );

    this.panel.onDidDispose(() => {
      if (!this.disposed) {
        this.session?.dispose();
        this.onDispose();
        this.disposed = true;
      }
    });

    if (this.device) {
      this.session = this.createSession();
    }

    this.webviewReady = new Promise((resolve) => {
      this.resolveWebviewReady = resolve;
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      void this.handleWebviewMessage(message);
    });

    this.panel.webview.html = buildLogPanelHtml(this.context, this.panel.webview, this.targetName);
  }

  /**
   * Starts the log session (for remote targets) or loads initial lines (for files) once ready.
   */
  async start(): Promise<void> {
    await this.webviewReady;
    if (this.session) {
      await this.session.start();
      return;
    }
    this.sendInitialLines();
  }

  /**
   * Brings the panel to the foreground.
   */
  reveal(): void {
    this.panel.reveal();
  }

  /**
   * Disposes the panel, session, and auto-save resources.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    void this.stopAutoSave({ silent: true });
    this.session?.dispose();
    this.panel.dispose();
  }

  onDidChangeViewState(
    listener: (e: vscode.WebviewPanelOnDidChangeViewStateEvent) => void
  ): vscode.Disposable {
    return this.panel.onDidChangeViewState(listener);
  }

  /**
   * Routes validated Webview messages to handlers for presets, exports, highlights, and session control.
   */
  private async handleWebviewMessage(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (!message) {
      return;
    }

    switch (message.type) {
      case 'ready':
        this.resolveWebviewReady?.();
        this.resolveWebviewReady = undefined;
        await this.sendInitialData();
        break;
      case 'requestSavePreset':
        await this.savePresetFromWebview(message);
        break;
      case 'deletePreset':
        await this.deletePreset(message.name);
        break;
      case 'exportLogs':
        await this.exportLogs(message.lines);
        break;
      case 'highlightsChanged':
        await this.saveHighlights(message.highlights);
        break;
      case 'openSourceFile':
        await this.openSourceFile();
        break;
      case 'refreshSourceFile':
        await this.refreshFromSource();
        break;
      case 'requestReconnect':
        await this.reconnect();
        break;
      case 'requestDisconnect':
        this.disconnect();
        break;
      case 'startAutoSave':
        await this.startAutoSave();
        break;
      case 'stopAutoSave':
        await this.stopAutoSave({ message: message.message ?? '' });
        break;
    }
  }

  /**
   * Builds a LogSession for the current device with Webview-facing callbacks.
   */
  private createSession(): LogSession {
    if (!this.device) {
      throw new Error('Cannot create a log session without a device.');
    }

    return new LogSession(this.device, this.context, {
      onLine: (line: string): void => this.handleIncomingLine(line),
      onError: (message: string): void => {
        void this.panel.webview.postMessage({ type: 'error', message });
      },
      onStatus: (message: string): void => {
        void this.panel.webview.postMessage({ type: 'status', message });
      },
      onClose: (): void => this.handleSessionClose(),
      onHostKeyMismatch: (details): void => {
        void this.handleHostKeyMismatch(details);
      },
    });
  }

  private async sendInitialData(): Promise<void> {
    const presets = this.stateStore.getStoredPresets();
    await this.panel.webview.postMessage({
      type: 'initData',
      deviceId: this.targetId,
      presets,
      highlights: this.highlights,
      isLive: !!this.session,
      maxEntries: this.maxLogEntries,
    });
  }

  /**
   * Sends initial log lines and status for imported files.
   */
  private sendInitialLines(): void {
    this.panel.webview.postMessage({ type: 'initialLines', lines: this.initialLines });
    this.panel.webview.postMessage({
      type: 'status',
      message: `Loaded ${this.initialLines.length} lines.`,
    });
  }

  private async savePresetFromWebview(message: {
    minLevel: string;
    textFilter: string;
  }): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Preset name',
      ignoreFocusOut: true,
    });
    if (!name) {
      return;
    }

    const preset: FilterPreset = {
      name,
      minLevel: message.minLevel,
      textFilter: message.textFilter,
    };
    const presets = await this.stateStore.savePreset(preset);
    this.panel.webview.postMessage({ type: 'presetsUpdated', presets });
    vscode.window.showInformationMessage(`Preset "${preset.name}" saved for ${this.targetName}.`);
  }

  private async deletePreset(name: string): Promise<void> {
    const presets = await this.stateStore.deletePreset(name);
    this.panel.webview.postMessage({ type: 'presetsUpdated', presets });
    vscode.window.showInformationMessage(`Preset "${name}" removed for ${this.targetName}.`);
  }

  /**
   * Prompts the user for an export destination and writes the provided lines.
   */
  private async exportLogs(lines: string[]): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      filters: { Logs: ['log', 'txt'] },
      saveLabel: 'Export logs',
    });
    if (!uri) {
      return;
    }
    const content = Buffer.from(lines.join('\n'), 'utf8');
    try {
      await vscode.workspace.fs.writeFile(uri, content);
      vscode.window.showInformationMessage(
        `Exported ${lines.length} lines from ${this.targetName}.`
      );
    } catch (err: unknown) {
      const message = this.getErrorMessage(err);
      vscode.window.showErrorMessage(
        message ? `Failed to export logs: ${message}` : 'Failed to export logs.'
      );
    }
  }

  private async saveHighlights(values: HighlightDefinition[]): Promise<void> {
    const stored = await this.stateStore.saveHighlights(values);
    this.highlights = stored;
  }

  private async openSourceFile(): Promise<void> {
    if (!this.sourcePath) {
      vscode.window.showErrorMessage('Edit is only available for imported log files.');
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(this.sourcePath));
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (err: unknown) {
      const message = this.getErrorMessage(err);
      vscode.window.showErrorMessage(
        message ? `Failed to open log file: ${message}` : 'Failed to open log file.'
      );
    }
  }

  private async refreshFromSource(): Promise<void> {
    if (!this.sourcePath) {
      vscode.window.showErrorMessage('Refresh is only available for imported log files.');
      return;
    }

    let content: Uint8Array;
    try {
      content = await vscode.workspace.fs.readFile(vscode.Uri.file(this.sourcePath));
    } catch (err: unknown) {
      const message = this.getErrorMessage(err);
      vscode.window.showErrorMessage(
        message ? `Failed to read log file: ${message}` : 'Failed to read log file.'
      );
      return;
    }

    const decoded = Buffer.from(content).toString('utf8');
    const lines = decoded.split(/\r?\n/);
    this.initialLines.length = 0;
    this.initialLines.push(...lines);

    await this.panel.webview.postMessage({
      type: 'replaceLines',
      lines,
      message: `Reloaded ${lines.length} lines from ${path.basename(this.sourcePath)}.`,
    });
  }

  private handleIncomingLine(line: string): void {
    this.writeAutoSaveLine(line);
    this.panel.webview.postMessage({ type: 'logLine', line });
  }

  private writeAutoSaveLine(line: string): void {
    this.autoSaveManager.writeLine(
      line,
      (message) => {
        this.panel.webview.postMessage({
          type: 'autoSaveError',
          message,
        });
      },
      () => void this.stopAutoSave({ silent: true })
    );
  }

  private handleSessionClose(): void {
    const closedAt = Date.now();
    this.session = undefined;
    this.appendSessionClosedMarker(closedAt);
    this.panel.webview.postMessage({
      type: 'sessionClosed',
      message: 'Session closed.',
      closedAt,
    });
  }

  private disconnect(): void {
    if (!this.session) {
      return;
    }

    this.session.dispose();
    this.session = undefined;
    const closedAt = Date.now();
    this.appendSessionClosedMarker(closedAt);
    void this.stopAutoSave({ message: '' });
    this.panel.webview.postMessage({
      type: 'sessionClosed',
      message: 'Disconnected.',
      closedAt,
    });
  }

  private async reconnect(): Promise<void> {
    if (!this.device || this.disposed) {
      return;
    }

    this.session?.dispose();
    this.session = this.createSession();
    await this.panel.webview.postMessage({ type: 'status', message: 'Reconnecting...' });

    try {
      await this.session.start();
    } catch (err: unknown) {
      const message = this.getErrorMessage(err);
      await this.panel.webview.postMessage({
        type: 'error',
        message: message || 'Failed to reconnect.',
      });
    }
  }

  /**
   * Prompts for a destination and begins streaming incoming logs to disk.
   */
  private async startAutoSave(): Promise<void> {
    if (!this.session) {
      await this.panel.webview.postMessage({
        type: 'autoSaveStopped',
        message: '',
      });
      return;
    }

    const defaultUri = this.getDefaultAutoSaveUri();
    const selectedUri = await vscode.window.showSaveDialog({
      title: 'Select log file to auto-save SSH output',
      defaultUri,
      filters: {
        Logs: ['log', 'txt'],
        'All Files': ['*'],
      },
    });

    if (!selectedUri) {
      await this.panel.webview.postMessage({
        type: 'autoSaveStopped',
        message: 'Auto-save cancelled.',
      });
      return;
    }

    try {
      await this.autoSaveManager.start(
        selectedUri.fsPath,
        (message) => {
          void this.panel.webview.postMessage({
            type: 'autoSaveError',
            message: message ? `Auto-save failed: ${message}` : 'Auto-save failed.',
          });
        },
        () => void this.stopAutoSave({ silent: true })
      );
      await this.panel.webview.postMessage({
        type: 'autoSaveStarted',
        filePath: selectedUri.fsPath,
        fileName: path.basename(selectedUri.fsPath),
      });
    } catch (err: unknown) {
      const message = this.getErrorMessage(err);
      await this.panel.webview.postMessage({
        type: 'autoSaveError',
        message: message ? `Auto-save failed: ${message}` : 'Auto-save failed.',
      });
      void this.stopAutoSave({ silent: true });
    }
  }

  /**
   * Stops auto-save and notifies the Webview unless silenced.
   */
  private async stopAutoSave(options: { silent?: boolean; message?: string } = {}): Promise<void> {
    const { silent = false, message } = options;
    const notify = await this.autoSaveManager.stop({ silent, message });
    if (!notify) {
      return;
    }

    await this.panel.webview.postMessage({
      type: 'autoSaveStopped',
      message: typeof message === 'string' ? message : '',
    });
  }

  private appendSessionClosedMarker(closedAt: number): void {
    const timestamp = this.formatTimestamp(closedAt);
    this.writeAutoSaveLine('');
    this.writeAutoSaveLine(`--- SSH session closed on ${timestamp}`);
    this.writeAutoSaveLine('');
  }

  private formatTimestamp(value: number): string {
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.valueOf())) {
      return new Date().toLocaleString();
    }
    return timestamp.toLocaleString();
  }

  private getDefaultAutoSaveUri(): vscode.Uri {
    const defaultFileName = `${this.targetName.replace(/\s+/g, '_').toLowerCase()}-logs.txt`;
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) {
      return vscode.Uri.file(path.join(process.cwd(), defaultFileName));
    }

    return vscode.Uri.file(path.join(workspaceUri.fsPath, defaultFileName));
  }

  /**
   * Relays host key mismatch details to the Webview and shows an error prompt.
   */
  private async handleHostKeyMismatch(details: {
    expected: string;
    received: string;
  }): Promise<void> {
    await this.panel.webview.postMessage({ type: 'hostKeyMismatch', ...details });
    void vscode.window.showErrorMessage(
      `Host key verification failed for ${this.targetName}. Expected ${details.expected} but received ${details.received}. Update the fingerprint in settings to reconnect.`
    );
  }

  private getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  }
}
