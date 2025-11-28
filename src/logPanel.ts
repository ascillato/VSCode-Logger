import * as vscode from 'vscode';
import { EmbeddedDevice } from './deviceTree';
import { LogSession } from './logSession';
import * as path from 'path';

interface FilterPreset {
    name: string;
    minLevel: string;
    textFilter: string;
}

/**
 * Hosts the WebviewPanel for a device and wires it to the SSH log session.
 */
export class LogPanel {
    private readonly panel: vscode.WebviewPanel;
    private readonly session: LogSession;
    private readonly presetsKey: string;
    private disposed = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly device: EmbeddedDevice,
        private readonly onDispose: () => void
    ) {
        this.presetsKey = `embeddedLogger.presets.${device.id}`;

        this.panel = vscode.window.createWebviewPanel(
            'embeddedLogger.logPanel',
            `${device.name} Logs`,
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
                this.session.dispose();
                this.onDispose();
                this.disposed = true;
            }
        });

        this.session = new LogSession(device, context, {
            onLine: (line) => this.panel.webview.postMessage({ type: 'logLine', line }),
            onError: (message) => this.panel.webview.postMessage({ type: 'error', message }),
            onStatus: (message) => this.panel.webview.postMessage({ type: 'status', message }),
            onClose: () => this.panel.webview.postMessage({ type: 'status', message: 'Session closed.' }),
        });

        this.panel.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message.type !== 'string') {
                return;
            }
            switch (message.type) {
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
            }
        });

        this.panel.webview.html = this.getHtml();
        this.initializePresets();
    }

    async start() {
        await this.session.start();
    }

    reveal() {
        this.panel.reveal();
    }

    dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.session.dispose();
        this.panel.dispose();
    }

    private getHtml(): string {
        const webview = this.panel.webview;
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'loggerPanel.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'loggerPanel.css')));
        const nonce = getNonce();
        const initialData = {
            deviceId: this.device.id,
            presets: this.getStoredPresets(),
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet" />
    <title>${this.device.name} Logs</title>
</head>
<body>
    <div class="top-bar">
        <label>Min Level
            <select id="minLevel">
                <option>ALL</option>
                <option>DEBUG</option>
                <option selected>INFO</option>
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
        <button id="savePreset">Save Preset</button>
        <button id="deletePreset">Delete Preset</button>
        <button id="exportLogs">Export Logs</button>
        <span id="status"></span>
    </div>
    <div id="logContainer"></div>
    <script nonce="${nonce}">
        const initialData = ${JSON.stringify(initialData)};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private getStoredPresets(): FilterPreset[] {
        return this.context.workspaceState.get<FilterPreset[]>(this.presetsKey, []);
    }

    private async initializePresets() {
        const presets = this.getStoredPresets();
        await this.panel.webview.postMessage({ type: 'initPresets', presets });
    }

    private async savePreset(preset: FilterPreset) {
        const presets = this.getStoredPresets();
        const filtered = presets.filter((p) => p.name !== preset.name);
        filtered.push(preset);
        await this.context.workspaceState.update(this.presetsKey, filtered);
        this.panel.webview.postMessage({ type: 'presetsUpdated', presets: filtered });
        vscode.window.showInformationMessage(`Preset "${preset.name}" saved for ${this.device.name}.`);
    }

    private async deletePreset(name: string) {
        const presets = this.getStoredPresets();
        const filtered = presets.filter((p) => p.name !== name);
        await this.context.workspaceState.update(this.presetsKey, filtered);
        this.panel.webview.postMessage({ type: 'presetsUpdated', presets: filtered });
        vscode.window.showInformationMessage(`Preset "${name}" removed for ${this.device.name}.`);
    }

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
            vscode.window.showInformationMessage(`Exported ${lines.length} lines from ${this.device.name}.`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to export logs: ${err?.message ?? err}`);
        }
    }

    private isValidPresetPayload(message: any): message is { minLevel: string; textFilter: string } {
        return typeof message?.minLevel === 'string' && typeof message?.textFilter === 'string';
    }

    private isStringArray(value: unknown): value is string[] {
        return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
