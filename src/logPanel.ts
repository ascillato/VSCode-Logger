/**
 * Creates and manages the Webview panel used to stream device logs.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import type { EmbeddedDevice } from './deviceTree';
import { LogSession } from './logSession';
import * as fs from 'fs';
import * as path from 'path';
import type { HighlightDefinition } from './highlights';
import { getEmbeddedLoggerConfiguration } from './configuration';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestSavePreset'; minLevel: string; textFilter: string }
  | { type: 'deletePreset'; name: string }
  | { type: 'exportLogs'; lines: string[] }
  | { type: 'highlightsChanged'; highlights: HighlightDefinition[] }
  | { type: 'openSourceFile' }
  | { type: 'refreshSourceFile' }
  | { type: 'requestReconnect' }
  | { type: 'requestDisconnect' }
  | { type: 'startAutoSave' }
  | { type: 'stopAutoSave'; message?: string };

/**
 * Saved filtering preferences for a device.
 */
interface FilterPreset {
  name: string;
  minLevel: string;
  textFilter: string;
}

type RemoteLogTarget = {
  type: 'remote';
  device: EmbeddedDevice;
};

type LocalLogTarget = {
  type: 'local';
  id: string;
  name: string;
  lines: string[];
  filePath: string;
};

type LogPanelTarget = RemoteLogTarget | LocalLogTarget;

/**
 * Hosts the WebviewPanel for a device and wires it to the SSH log session.
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
  private autoSaveStream?: fs.WriteStream;
  private autoSavePath?: string;
  private readonly webviewReady: Promise<void>;
  private resolveWebviewReady?: () => void;
  private disposed = false;

  /**
   * Builds a log panel for the given device and prepares event wiring.
   *
   * @param context VS Code extension context used for resources and state.
   * @param target Log panel target describing the remote device or local file.
   * @param onDispose Callback invoked when the panel is disposed.
   */
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
    this.highlights = this.getStoredHighlights();
    this.maxLogEntries = getEmbeddedLoggerConfiguration().maxLinesPerTab;

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

    this.panel.webview.html = this.getHtml();
  }

  private parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    const message = raw as Record<string, unknown>;
    switch (message.type) {
      case 'ready':
        return { type: 'ready' };
      case 'requestSavePreset':
        if (this.isValidPresetPayload(message)) {
          return {
            type: 'requestSavePreset',
            minLevel: message.minLevel,
            textFilter: message.textFilter,
          };
        }
        return undefined;
      case 'deletePreset':
        return typeof message.name === 'string' && message.name
          ? { type: 'deletePreset', name: message.name }
          : undefined;
      case 'exportLogs':
        return this.isStringArray(message.lines)
          ? { type: 'exportLogs', lines: message.lines }
          : undefined;
      case 'highlightsChanged':
        return this.isValidHighlightPayload(message.highlights)
          ? { type: 'highlightsChanged', highlights: message.highlights }
          : undefined;
      case 'openSourceFile':
        return { type: 'openSourceFile' };
      case 'refreshSourceFile':
        return { type: 'refreshSourceFile' };
      case 'requestReconnect':
        return { type: 'requestReconnect' };
      case 'requestDisconnect':
        return { type: 'requestDisconnect' };
      case 'startAutoSave':
        return { type: 'startAutoSave' };
      case 'stopAutoSave':
        return typeof message.message === 'string'
          ? { type: 'stopAutoSave', message: message.message }
          : { type: 'stopAutoSave' };
      default:
        return undefined;
    }
  }

  private async handleWebviewMessage(raw: unknown): Promise<void> {
    const message = this.parseWebviewMessage(raw);
    if (!message) {
      return;
    }

    switch (message.type) {
      case 'ready': {
        if (this.resolveWebviewReady) {
          this.resolveWebviewReady();
          this.resolveWebviewReady = undefined;
        }
        await this.sendInitialData();
        break;
      }
      case 'requestSavePreset': {
        const name = await vscode.window.showInputBox({
          prompt: 'Preset name',
          ignoreFocusOut: true,
        });
        if (name) {
          const preset: FilterPreset = {
            name,
            minLevel: message.minLevel,
            textFilter: message.textFilter,
          };
          await this.savePreset(preset);
        }
        break;
      }
      case 'deletePreset': {
        await this.deletePreset(message.name);
        break;
      }
      case 'exportLogs': {
        await this.exportLogs(message.lines);
        break;
      }
      case 'highlightsChanged': {
        await this.saveHighlights(message.highlights);
        break;
      }
      case 'openSourceFile': {
        await this.openSourceFile();
        break;
      }
      case 'refreshSourceFile': {
        await this.refreshFromSource();
        break;
      }
      case 'requestReconnect': {
        await this.reconnect();
        break;
      }
      case 'requestDisconnect': {
        this.disconnect();
        break;
      }
      case 'startAutoSave': {
        await this.startAutoSave();
        break;
      }
      case 'stopAutoSave': {
        await this.stopAutoSave({ message: message.message ?? '' });
        break;
      }
    }
  }

  /**
   * Starts the underlying log session.
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
   * Creates a new log session wired to the current panel callbacks.
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

  private async handleHostKeyMismatch(details: {
    expected: string;
    received: string;
  }): Promise<void> {
    await this.panel.webview.postMessage({ type: 'hostKeyMismatch', ...details });
    void vscode.window.showErrorMessage(
      `Host key verification failed for ${this.targetName}. Expected ${details.expected} but received ${details.received}. Update the fingerprint in settings to reconnect.`
    );
  }

  /**
   * Forwards an incoming log line to the Webview and any active auto-save stream.
   * @param line Raw log line emitted by the SSH session.
   */
  private handleIncomingLine(line: string): void {
    this.writeAutoSaveLine(line);
    this.panel.webview.postMessage({ type: 'logLine', line });
  }

  /**
   * Attempts to write a log line to the active auto-save stream.
   * @param line Log line to persist.
   */
  private writeAutoSaveLine(line: string): void {
    if (!this.autoSaveStream) {
      return;
    }

    try {
      this.autoSaveStream.write(`${line}\n`);
    } catch (err: unknown) {
      const message = this.getErrorMessage(err);
      this.panel.webview.postMessage({
        type: 'autoSaveError',
        message: message ? `Auto-save failed: ${message}` : 'Auto-save failed.',
      });
      void this.stopAutoSave({ silent: true });
    }
  }

  /**
   * Emits preloaded log lines for local files into the Webview.
   */
  private sendInitialLines(): void {
    this.panel.webview.postMessage({ type: 'initialLines', lines: this.initialLines });
    this.panel.webview.postMessage({
      type: 'status',
      message: `Loaded ${this.initialLines.length} lines.`,
    });
  }

  /**
   * Reveals the panel if it is hidden or behind other tabs.
   */
  reveal(): void {
    this.panel.reveal();
  }

  /**
   * Cleans up the panel and SSH session resources.
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

  /**
   * Posts the session closed status and marker line to the Webview.
   */
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

  /**
   * Disposes the active session and notifies the Webview of the closure.
   */
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

  /**
   * Registers a listener for panel view state changes.
   * @param listener Callback invoked when the panel visibility changes.
   * @returns Disposable subscription handle.
   */
  onDidChangeViewState(
    listener: (e: vscode.WebviewPanelOnDidChangeViewStateEvent) => void
  ): vscode.Disposable {
    return this.panel.onDidChangeViewState(listener);
  }

  /**
   * Attempts to reconnect the SSH session when requested by the Webview.
   */
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
   * Prompts the user for an auto-save destination and starts persisting incoming lines.
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
      await this.stopAutoSave({ silent: true });
      this.autoSavePath = selectedUri.fsPath;
      this.autoSaveStream = fs.createWriteStream(this.autoSavePath, { flags: 'a' });
      this.autoSaveStream.on('error', (err) => {
        void this.handleAutoSaveStreamError(err);
      });

      await this.panel.webview.postMessage({
        type: 'autoSaveStarted',
        filePath: this.autoSavePath,
        fileName: path.basename(this.autoSavePath),
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

  private async handleAutoSaveStreamError(err: unknown): Promise<void> {
    const message = this.getErrorMessage(err);
    await this.panel.webview.postMessage({
      type: 'autoSaveError',
      message: message ? `Auto-save failed: ${message}` : 'Auto-save failed.',
    });
    void this.stopAutoSave({ silent: true });
  }

  /**
   * Stops any active auto-save stream and notifies the Webview unless silenced.
   * @param options Optional flags to silence notifications or override the status message.
   */
  private async stopAutoSave(options: { silent?: boolean; message?: string } = {}): Promise<void> {
    const { silent = false, message } = options;
    const hadAutoSave = !!(this.autoSaveStream || this.autoSavePath);

    if (this.autoSaveStream) {
      await new Promise<void>((resolve) => {
        const stream = this.autoSaveStream;
        if (!stream) {
          resolve();
          return;
        }

        if (stream.closed) {
          resolve();
          return;
        }

        // 'close' listener takes no args, so wrap resolve() in a zero-arg callback
        stream.once('close', () => resolve());
        stream.end();
      });
      this.autoSaveStream = undefined;
    }

    this.autoSavePath = undefined;

    if (!silent && hadAutoSave) {
      await this.panel.webview.postMessage({
        type: 'autoSaveStopped',
        message: typeof message === 'string' ? message : '',
      });
    }
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

  /**
   * Builds a default URI for the auto-save dialog using the workspace folder when available.
   * @returns VS Code URI pointing to a suggested log file path.
   */
  private getDefaultAutoSaveUri(): vscode.Uri {
    const defaultFileName = `${this.targetName.replace(/\s+/g, '_').toLowerCase()}-logs.txt`;
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) {
      return vscode.Uri.file(path.join(process.cwd(), defaultFileName));
    }

    return vscode.Uri.file(path.join(workspaceUri.fsPath, defaultFileName));
  }

  /**
   * Builds the HTML string loaded into the Webview.
   * @returns HTML markup with scripts, styles, and initial data payload.
   */
  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'loggerPanel.js'))
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'loggerPanel.css'))
    );
    const scriptUriString = scriptUri.toString(true);
    const styleUriString = styleUri.toString(true);
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUriString}" rel="stylesheet" />
    <title>${this.targetName} Logs</title>
</head>
<body>
    <div class="top-bar">
        <label class="stacked-field">Min Level
            <select id="minLevel">
                <option selected>ALL</option>
                <option>DEBUG</option>
                <option>INFO</option>
                <option>NOTICE</option>
                <option>WARNING</option>
                <option>ERR</option>
                <option>CRIT</option>
                <option>ALERT</option>
                <option>EMERG</option>
            </select>
        </label>
        <label class="stacked-field">Text Filter
            <input type="text" id="textFilter" placeholder="Filter substring" />
        </label>
        <label class="stacked-field">Filtering Presets
            <select id="presetSelect">
                <option value="">(no preset)</option>
            </select>
        </label>
        <div class="toolbar-actions">
            <div class="toolbar-actions__item">
                <button id="savePreset" class="toolbar-button toolbar-button--icon" type="button" title="Save preset" aria-label="Save preset">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M17 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm3-10H5V5h10v4Z" />
                        </svg>
                    </span>
                    <span class="sr-only">Save preset</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="deletePreset" class="toolbar-button toolbar-button--icon" type="button" title="Delete preset" aria-label="Delete preset">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 5h12l-1 12H7L6 8Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z" />
                        </svg>
                    </span>
                    <span class="sr-only">Delete preset</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="exportLogs" class="toolbar-button toolbar-button--icon" type="button" title="Export logs" aria-label="Export logs">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">➜]</span>
                    <span class="sr-only">Export logs</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="editLogFile" class="toolbar-button toolbar-button--icon hidden" type="button" title="Edit log file" aria-label="Edit log file">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">📝</span>
                    <span class="sr-only">Edit log file</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="refreshLogFile" class="toolbar-button toolbar-button--icon hidden" type="button" title="Refresh log file" aria-label="Refresh log file">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">⟳</span>
                    <span class="sr-only">Refresh log file</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="autoSaveToggle" class="toolbar-button toolbar-button--icon" type="button" title="Start auto-save" aria-label="Start auto-save">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🗄️</span>
                    <span class="sr-only">Start auto-save</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="clearLogs" class="toolbar-button toolbar-button--icon" type="button" title="Clear logs" aria-label="Clear logs">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🧹</span>
                    <span class="sr-only">Clear logs</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="highlightToggle" class="toolbar-button" type="button">Highlight</button>
            </div>
        </div>
        <div class="toggle-actions">
            <div class="toggle-actions__item">
                <button id="wordWrapToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="Word wrap" title="Word wrap">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M4 6h16v2H4V6Zm0 5h10v2H4v-2Zm0 5h8v2H4v-2Zm12 0h2v-2h-2v-2h-2v6h4v-2Z" />
                        </svg>
                    </span>
                    <span class="sr-only">Word wrap</span>
                </button>
            </div>
            <div class="toggle-actions__item" id="autoScrollContainer">
                <button id="autoScrollToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="Auto-scroll" title="Auto-scroll">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">⏭️</span>
                    <span class="sr-only">Auto-scroll</span>
                </button>
            </div>
            <div class="toggle-actions__item" id="autoReconnectContainer">
                <button id="autoReconnectToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="Auto-reconnect" title="Auto-reconnect">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🔁</span>
                    <span class="sr-only">Auto-reconnect</span>
                </button>
            </div>
        </div>
        <div class="search-bar">
            <label class="stacked-field">Find
                <input type="text" id="searchInput" placeholder="Find in logs (Ctrl/Cmd+F)" />
            </label>
            <button id="searchClear" class="toolbar-button toolbar-button--icon" title="Clear search" aria-label="Clear search">&times;</button>
            <div class="search-controls">
                <button id="searchPrev" class="toolbar-button" title="Previous match">Prev</button>
                <button id="searchNext" class="toolbar-button" title="Next match">Next</button>
                <span id="searchCount">0 / 0</span>
            </div>
        </div>
        <div class="top-bar-spacer"></div>
        <div class="status-area">
            <span id="status"></span>
            <button id="reconnectButton" class="toolbar-button status-action" hidden>Reconnect</button>
        </div>
    </div>
    <div id="highlightPopover" class="highlight-popover hidden" role="dialog" aria-label="Highlight keywords">
        <div class="highlight-header">
            <span class="highlight-title">Highlights</span>
            <div class="highlight-actions">
                <button id="highlightAdd" class="toolbar-button">add</button>
                <button id="highlightClear" class="toolbar-button">remove all</button>
            </div>
        </div>
        <div id="highlightStatus" class="highlight-status"></div>
        <div id="highlightRows" class="highlight-rows"></div>
    </div>
    <div id="highlightBackdrop" class="highlight-backdrop hidden" aria-hidden="true"></div>
    <div id="logContainer">
        <div id="lineLimitNotice" class="line-limit-notice hidden">Configured display line limit reached. Older lines are being replaced with newer entries.</div>
        <div id="logContent"></div>
    </div>
    <script nonce="${nonce}" src="${scriptUriString}"></script>
</body>
</html>`;
  }

  /**
   * Retrieves saved presets from workspace state.
   * @returns The array of stored presets, or an empty array when none exist.
   */
  private getStoredPresets(): FilterPreset[] {
    return this.context.workspaceState.get<FilterPreset[]>(this.presetsKey, []);
  }

  /**
   * Sends device metadata and stored presets to the Webview.
   */
  private async sendInitialData(): Promise<void> {
    const presets = this.getStoredPresets();
    await this.panel.webview.postMessage({
      type: 'initData',
      deviceId: this.targetId,
      presets,
      highlights: this.highlights,
      isLive: !!this.session,
      maxEntries: this.maxLogEntries,
    });
  }

  private getStoredHighlights(): HighlightDefinition[] {
    return this.context.workspaceState.get<HighlightDefinition[]>(this.highlightsKey, []);
  }

  private async saveHighlights(values: HighlightDefinition[]): Promise<void> {
    const sanitized = values
      .filter((highlight) => typeof highlight?.key === 'string')
      .slice(0, 10)
      .map((highlight, index) => ({
        id: highlight.id || index + 1,
        key: highlight.key,
        baseColor: highlight.baseColor,
        color: highlight.color,
        backgroundColor: highlight.backgroundColor,
      }));

    this.highlights = sanitized;
    await this.context.workspaceState.update(this.highlightsKey, sanitized);
  }

  /**
   * Saves or replaces a filter preset for the current device.
   * @param preset Preset data to persist.
   */
  private async savePreset(preset: FilterPreset): Promise<void> {
    const presets = this.getStoredPresets();
    const filtered = presets.filter((p) => p.name !== preset.name);
    filtered.push(preset);
    await this.context.workspaceState.update(this.presetsKey, filtered);
    this.panel.webview.postMessage({ type: 'presetsUpdated', presets: filtered });
    vscode.window.showInformationMessage(`Preset "${preset.name}" saved for ${this.targetName}.`);
  }

  /**
   * Deletes a saved preset by name and notifies the Webview.
   * @param name Name of the preset to remove.
   */
  private async deletePreset(name: string): Promise<void> {
    const presets = this.getStoredPresets();
    const filtered = presets.filter((p) => p.name !== name);
    await this.context.workspaceState.update(this.presetsKey, filtered);
    this.panel.webview.postMessage({ type: 'presetsUpdated', presets: filtered });
    vscode.window.showInformationMessage(`Preset "${name}" removed for ${this.targetName}.`);
  }

  /**
   * Exports the provided log lines to a user-specified file.
   * @param lines Collection of log lines to write.
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

  /**
   * Opens the source log file in a standard VS Code editor tab.
   */
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

  /**
   * Reloads the source log file and replaces the Webview contents.
   */
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

  /**
   * Type guard verifying preset payloads from the Webview.
   * @param message Arbitrary message payload.
   * @returns True when the payload has the expected shape.
   */
  private isValidPresetPayload(
    message: unknown
  ): message is { minLevel: string; textFilter: string } {
    const candidate = message as { minLevel?: unknown; textFilter?: unknown };
    return typeof candidate?.minLevel === 'string' && typeof candidate?.textFilter === 'string';
  }

  private isValidHighlightPayload(value: unknown): value is HighlightDefinition[] {
    return (
      Array.isArray(value) &&
      value.every((highlight: unknown) => {
        if (!highlight || typeof highlight !== 'object') {
          return false;
        }
        const candidate = highlight as Partial<HighlightDefinition>;
        return (
          typeof candidate.key === 'string' &&
          typeof candidate.baseColor === 'string' &&
          typeof candidate.color === 'string' &&
          typeof candidate.backgroundColor === 'string'
        );
      })
    );
  }

  private getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  }

  /**
   * Determines whether a value is an array of strings.
   * @param value Unknown value to check.
   * @returns True when every element is a string.
   */
  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }
}

/**
 * Generates a random nonce for script tags in the Webview.
 * @returns A 32-character nonce comprised of letters and numbers.
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
