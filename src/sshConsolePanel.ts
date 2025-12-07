import * as vscode from 'vscode';
import * as path from 'path';
import { Client, ClientChannel } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';

interface SshConsoleMessage {
    type: 'ready' | 'input' | 'disconnect' | 'reconnect' | 'setAutoReconnect';
    text?: string;
    autoReconnect?: boolean;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

type StatusVariant = 'default' | 'closed';

export class SshConsolePanel implements vscode.Disposable {
    private static panels = new Map<string, SshConsolePanel>();

    static createOrShow(device: EmbeddedDevice, context: vscode.ExtensionContext): SshConsolePanel {
        const existing = this.panels.get(device.id);
        if (existing) {
            existing.reveal();
            return existing;
        }

        const panel = new SshConsolePanel(device, context);
        this.panels.set(device.id, panel);
        panel.panel.onDidDispose(() => this.panels.delete(device.id));
        return panel;
    }

    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly reconnectDelayMs = 5000;
    private autoReconnect = true;
    private client: Client | undefined;
    private shell: ClientChannel | undefined;
    private reconnectTimer: NodeJS.Timeout | undefined;
    private disposed = false;
    private connectionState: ConnectionState = 'disconnected';
    private suppressAutoReconnect = false;

    private constructor(private readonly device: EmbeddedDevice, private readonly context: vscode.ExtensionContext) {
        const panel = vscode.window.createWebviewPanel(
            'embeddedLogger.sshConsole',
            `${device.name} SSH`,
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

        this.panel = panel;
        this.panel.webview.html = this.getHtml(this.panel.webview, context);
        this.panel.webview.onDidReceiveMessage((message: SshConsoleMessage) => {
            switch (message.type) {
                case 'ready':
                    this.postInit();
                    this.connect();
                    break;
                case 'input':
                    if (message.text) {
                        this.shell?.write(message.text.endsWith('\n') ? message.text : `${message.text}\n`);
                    }
                    break;
                case 'disconnect':
                    this.disconnect(true);
                    break;
                case 'reconnect':
                    this.suppressAutoReconnect = false;
                    this.connect();
                    break;
                case 'setAutoReconnect':
                    if (typeof message.autoReconnect === 'boolean') {
                        this.autoReconnect = message.autoReconnect;
                        if (!this.autoReconnect) {
                            this.cancelReconnect();
                        } else if (this.connectionState === 'disconnected' && !this.suppressAutoReconnect) {
                            this.scheduleReconnect();
                        }
                    }
                    break;
            }
        });

        this.disposables.push(
            this.panel.onDidDispose(() => {
                this.dispose();
            })
        );
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.cancelReconnect();
        this.shell?.end();
        this.client?.end();
        this.disposables.forEach((d) => d.dispose());
    }

    private reveal() {
        this.panel.reveal(vscode.ViewColumn.Active);
    }

    private async connect(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.cancelReconnect();
        this.shell?.end();
        this.client?.end();
        this.shell = undefined;
        this.client = undefined;
        this.connectionState = 'connecting';
        this.updateStatus('Connecting…', 'default');
        this.postConnectionState();

        try {
            if (!vscode.workspace.isTrusted) {
                throw new Error('Workspace trust is required before connecting to devices.');
            }

            const validationError = this.validateDeviceConfiguration();
            if (validationError) {
                throw new Error(validationError);
            }

            const password = await this.getPassword();
            if (!password) {
                throw new Error('Password is required to connect to the device.');
            }

            await this.establishConnection(password);
        } catch (err: any) {
            const message = err?.message ?? String(err);
            vscode.window.showErrorMessage(message);
            this.handleDisconnect(`SSH session closed on ${new Date().toLocaleString()}`, true);
        }
    }

    private async establishConnection(password: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const client = new Client();
            this.client = client;
            const port = this.device.port ?? 22;
            const host = this.device.host.trim();
            const username = this.device.username.trim();

            client
                .on('ready', () => {
                    const cols = 120;
                    const rows = 40;
                    client.shell({ term: 'xterm-color', cols, rows }, (err, stream) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        this.shell = stream;
                        this.connectionState = 'connected';
                        this.updateStatus(`Connected to ${this.device.name}`, 'default');
                        this.postConnectionState();

                        stream
                            .on('data', (data: Buffer) => {
                                this.postData(data.toString());
                            })
                            .on('close', () => {
                                this.handleDisconnect(`SSH session closed on ${new Date().toLocaleString()}`);
                            });

                        stream.stderr.on('data', (data: Buffer) => {
                            this.postData(data.toString());
                        });

                        resolve();
                    });
                })
                .on('error', (err) => {
                    reject(new Error(`SSH error: ${err.message}`));
                })
                .on('close', () => {
                    this.handleDisconnect(`SSH session closed on ${new Date().toLocaleString()}`);
                })
                .connect({
                    host,
                    port,
                    username,
                    password,
                });
        });
    }

    private disconnect(manual = false) {
        this.suppressAutoReconnect = manual || this.suppressAutoReconnect;
        this.connectionState = 'disconnected';
        this.postConnectionState();
        this.updateStatus(`SSH session closed on ${new Date().toLocaleString()}`, 'closed');
        this.cancelReconnect();
        this.shell?.end();
        this.client?.end();
        this.shell = undefined;
        this.client = undefined;
        if (!manual && this.autoReconnect && !this.suppressAutoReconnect) {
            this.scheduleReconnect();
        }
    }

    private handleDisconnect(message: string, suppressReconnect = false) {
        this.connectionState = 'disconnected';
        this.suppressAutoReconnect = suppressReconnect || this.suppressAutoReconnect;
        this.updateStatus(message, 'closed');
        this.postConnectionState();
        this.cancelReconnect();
        if (this.autoReconnect && !this.suppressAutoReconnect && !this.disposed) {
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        this.cancelReconnect();
        if (this.disposed) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, this.reconnectDelayMs);
        this.panel.webview.postMessage({ type: 'autoReconnectScheduled' });
    }

    private cancelReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private postInit() {
        this.panel.webview.postMessage({
            type: 'init',
            deviceName: this.device.name,
            autoReconnect: this.autoReconnect,
            state: this.connectionState,
        });
    }

    private postData(data: string) {
        this.panel.webview.postMessage({ type: 'data', data });
    }

    private postConnectionState() {
        this.panel.webview.postMessage({ type: 'state', state: this.connectionState });
    }

    private updateStatus(text: string, variant: StatusVariant) {
        this.panel.webview.postMessage({
            type: 'status',
            text,
            variant,
        });
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
        return undefined;
    }

    private async getPassword(): Promise<string | undefined> {
        const key = `embeddedLogger.password.${this.device.id}`;
        const stored = await this.context.secrets.get(key);
        if (stored) {
            return stored;
        }

        const input = await vscode.window.showInputBox({
            prompt: `Enter SSH password for ${this.device.name}`,
            password: true,
            ignoreFocusOut: true,
        });

        if (input) {
            await this.context.secrets.store(key, input);
        }

        return input;
    }

    private getHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'sshConsole.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'sshConsole.css')));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet" />
    <title>SSH Console</title>
</head>
<body>
    <div class="console-container">
        <div class="console-header">
            <div class="status-group">
                <span id="statusText" class="status status-default">Connecting…</span>
                <button id="connectionButton" class="action-button">Disconnect</button>
            </div>
            <label class="auto-reconnect">
                <input type="checkbox" id="autoReconnect" checked />
                Auto-reconnect
            </label>
        </div>
        <div id="consoleFrame" class="console-frame state-disconnected">
            <pre id="terminalOutput" class="terminal-output"></pre>
            <div class="input-row">
                <input id="terminalInput" class="terminal-input" type="text" autocomplete="off" placeholder="Type a command and press Enter" />
                <button id="sendInput" class="action-button">Send</button>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
