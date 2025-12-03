/**
 * @file logPanel.ts
 * @brief Creates and manages the Webview panel used to stream device logs.
 * @copyright Copyright (c) 2025 A. Scillato
 */

import * as vscode from 'vscode';
import { EmbeddedDevice } from './deviceTree';
import { LogSession } from './logSession';
import * as path from 'path';
import { HighlightDefinition } from './sidebarView';

/**
 * @brief Saved filtering preferences for a device.
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
 * @brief Hosts the WebviewPanel for a device and wires it to the SSH log session.
 */
export class LogPanel {
    private readonly panel: vscode.WebviewPanel;
    private session?: LogSession;
    private readonly presetsKey: string;
    private readonly targetName: string;
    private readonly targetId: string;
    private readonly initialLines: string[] = [];
    private readonly sourcePath?: string;
    private readonly device?: EmbeddedDevice;
    private highlights: HighlightDefinition[];
    private readonly maxLogEntries: number;
    private disposed = false;

    /**
     * @brief Builds a log panel for the given device and prepares event wiring.
     *
     * @param context VS Code extension context used for resources and state.
     * @param device Device configuration associated with this panel.
     * @param onDispose Callback invoked when the panel is disposed.
     */
    constructor(
        private readonly context: vscode.ExtensionContext,
        target: LogPanelTarget,
        private readonly onDispose: () => void,
        initialHighlights: HighlightDefinition[] = []
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
        this.highlights = initialHighlights;
        const config = vscode.workspace.getConfiguration('embeddedLogger');
        const configuredLimit = config.get<number>('maxLinesPerTab', 100000);
        this.maxLogEntries = Math.max(1, configuredLimit || 100000);

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

        this.panel.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message.type !== 'string') {
                return;
            }
            switch (message.type) {
                case 'ready': {
                    await this.sendInitialData();
                    break;
                }
                case 'requestSavePreset': {
                    if (!this.isValidPresetPayload(message)) {
                        vscode.window.showErrorMessage('Invalid preset payload received from webview.');
                        return;
                    }
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
                    if (typeof message.name !== 'string' || !message.name) {
                        vscode.window.showErrorMessage('Invalid preset name received from webview.');
                        return;
                    }
                    await this.deletePreset(message.name);
                    break;
                }
                case 'exportLogs': {
                    if (!this.isStringArray(message.lines)) {
                        vscode.window.showErrorMessage('Export failed because the log payload was malformed.');
                        return;
                    }
                    await this.exportLogs(message.lines);
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
            }
        });

        this.panel.webview.html = this.getHtml();
    }

    /**
     * @brief Starts the underlying log session.
     */
    async start() {
        if (this.session) {
            await this.session.start();
            return;
        }
        this.sendInitialLines();
    }

    /**
     * @brief Creates a new log session wired to the current panel callbacks.
     */
    private createSession(): LogSession {
        if (!this.device) {
            throw new Error('Cannot create a log session without a device.');
        }

        return new LogSession(this.device, this.context, {
            onLine: (line) => this.panel.webview.postMessage({ type: 'logLine', line }),
            onError: (message) => this.panel.webview.postMessage({ type: 'error', message }),
            onStatus: (message) => this.panel.webview.postMessage({ type: 'status', message }),
            onClose: () => this.handleSessionClose(),
        });
    }

    /**
     * @brief Emits preloaded log lines for local files into the Webview.
     */
    private sendInitialLines() {
        this.panel.webview.postMessage({ type: 'initialLines', lines: this.initialLines });
        this.panel.webview.postMessage({
            type: 'status',
            message: `Loaded ${this.initialLines.length} lines.`,
        });
    }

    /**
     * @brief Reveals the panel if it is hidden or behind other tabs.
     */
    reveal() {
        this.panel.reveal();
    }

    /**
     * @brief Cleans up the panel and SSH session resources.
     */
    dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.session?.dispose();
        this.panel.dispose();
    }

    /**
     * @brief Posts the session closed status and marker line to the Webview.
     */
    private handleSessionClose() {
        const closedAt = Date.now();
        this.session = undefined;
        this.panel.webview.postMessage({
            type: 'sessionClosed',
            message: 'Session closed.',
            closedAt,
        });
    }

    /**
     * @brief Disposes the active session and notifies the Webview of the closure.
     */
    private disconnect() {
        if (!this.session) {
            return;
        }

        this.session.dispose();
        this.session = undefined;
        const closedAt = Date.now();
        this.panel.webview.postMessage({
            type: 'sessionClosed',
            message: 'Disconnected.',
            closedAt,
        });
    }

    /**
     * @brief Pushes highlight definitions to the webview for rendering.
     * @param values Highlight entries sourced from the sidebar view.
     */
    updateHighlights(values: HighlightDefinition[]) {
        this.highlights = values;
        this.panel.webview.postMessage({ type: 'highlightsUpdated', highlights: this.highlights });
    }

    /**
     * @brief Registers a listener for panel view state changes.
     * @param listener Callback invoked when the panel visibility changes.
     * @returns Disposable subscription handle.
     */
    onDidChangeViewState(listener: (e: vscode.WebviewPanelOnDidChangeViewStateEvent) => void): vscode.Disposable {
        return this.panel.onDidChangeViewState(listener);
    }

    /**
     * @brief Attempts to reconnect the SSH session when requested by the Webview.
     */
    private async reconnect() {
        if (!this.device || this.disposed) {
            return;
        }

        this.session?.dispose();
        this.session = this.createSession();
        await this.panel.webview.postMessage({ type: 'status', message: 'Reconnecting...' });

        try {
            await this.session.start();
        } catch (err: any) {
            await this.panel.webview.postMessage({
                type: 'error',
                message: err?.message ?? 'Failed to reconnect.',
            });
        }
    }

    /**
     * @brief Builds the HTML string loaded into the Webview.
     * @returns HTML markup with scripts, styles, and initial data payload.
     */
    private getHtml(): string {
        const webview = this.panel.webview;
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'loggerPanel.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'loggerPanel.css')));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet" />
    <title>${this.targetName} Logs</title>
</head>
<body>
    <div class="top-bar">
        <label>Min Level
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
        <label>Text Filter
            <input type="text" id="textFilter" placeholder="Filter substring" />
        </label>
        <label>Presets
            <select id="presetSelect">
                <option value="">(no preset)</option>
            </select>
        </label>
        <label>&nbsp;
            <button id="savePreset">Save Preset</button>
        </label>
        <label>&nbsp;
            <button id="deletePreset">Delete Preset</button>
        </label>
        <label>&nbsp;
            <button id="exportLogs">Export Logs</button>
        </label>
        <label>&nbsp;
            <button id="clearLogs">Clear Logs</button>
        </label>
        <label class="word-wrap-toggle">
            <span>Word Wrap</span>
            <input type="checkbox" id="wordWrapToggle" />
        </label>
        <label class="word-wrap-toggle" id="autoScrollContainer">
            <span>Auto Scroll</span>
            <input type="checkbox" id="autoScrollToggle" checked />
        </label>
        <label class="word-wrap-toggle" id="autoReconnectContainer">
            <span>Auto Reconnect</span>
            <input type="checkbox" id="autoReconnectToggle" checked />
        </label>
        <div class="search-bar">
            <label>Find
                <input type="text" id="searchInput" placeholder="Find in logs (Ctrl/Cmd+F)" />
            </label>
            <div class="search-controls">
                <button id="searchPrev" title="Previous match">Prev</button>
                <button id="searchNext" title="Next match">Next</button>
                <span id="searchCount">0 / 0</span>
            </div>
        </div>
        <div class="top-bar-spacer"></div>
        <div class="status-area">
            <span id="status"></span>
            <button id="reconnectButton" class="status-action" hidden>Reconnect</button>
        </div>
    </div>
    <div id="logContainer"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * @brief Retrieves saved presets from workspace state.
     * @returns The array of stored presets, or an empty array when none exist.
     */
    private getStoredPresets(): FilterPreset[] {
        return this.context.workspaceState.get<FilterPreset[]>(this.presetsKey, []);
    }

    /**
     * @brief Sends device metadata and stored presets to the Webview.
     */
    private async sendInitialData() {
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

    /**
     * @brief Saves or replaces a filter preset for the current device.
     * @param preset Preset data to persist.
     */
    private async savePreset(preset: FilterPreset) {
        const presets = this.getStoredPresets();
        const filtered = presets.filter((p) => p.name !== preset.name);
        filtered.push(preset);
        await this.context.workspaceState.update(this.presetsKey, filtered);
        this.panel.webview.postMessage({ type: 'presetsUpdated', presets: filtered });
        vscode.window.showInformationMessage(`Preset "${preset.name}" saved for ${this.targetName}.`);
    }

    /**
     * @brief Deletes a saved preset by name and notifies the Webview.
     * @param name Name of the preset to remove.
     */
    private async deletePreset(name: string) {
        const presets = this.getStoredPresets();
        const filtered = presets.filter((p) => p.name !== name);
        await this.context.workspaceState.update(this.presetsKey, filtered);
        this.panel.webview.postMessage({ type: 'presetsUpdated', presets: filtered });
        vscode.window.showInformationMessage(`Preset "${name}" removed for ${this.targetName}.`);
    }

    /**
     * @brief Exports the provided log lines to a user-specified file.
     * @param lines Collection of log lines to write.
     */
    private async exportLogs(lines: string[]) {
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
            vscode.window.showInformationMessage(`Exported ${lines.length} lines from ${this.targetName}.`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to export logs: ${err?.message ?? err}`);
        }
    }

    /**
     * @brief Type guard verifying preset payloads from the Webview.
     * @param message Arbitrary message payload.
     * @returns True when the payload has the expected shape.
     */
    private isValidPresetPayload(message: any): message is { minLevel: string; textFilter: string } {
        return typeof message?.minLevel === 'string' && typeof message?.textFilter === 'string';
    }

    /**
     * @brief Determines whether a value is an array of strings.
     * @param value Unknown value to check.
     * @returns True when every element is a string.
     */
    private isStringArray(value: unknown): value is string[] {
        return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    }
}

/**
 * @brief Generates a random nonce for script tags in the Webview.
 * @returns A 32-character nonce comprised of letters and numbers.
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
