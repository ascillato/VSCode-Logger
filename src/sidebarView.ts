/**
 * @file sidebarView.ts
 * @brief Provides the activity view that lists devices and manages highlight keys.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { EmbeddedDevice } from './deviceTree';

export interface HighlightDefinition {
    id: number;
    key: string;
    baseColor: string;
    color: string;
    backgroundColor: string;
}

interface SidebarMessage {
    type: 'openDevice';
    deviceId: string;
}

interface HighlightUpdateMessage {
    type: 'highlightsChanged';
    highlights: HighlightDefinition[];
}

interface AddRowRequest {
    type: 'addRow';
}

interface RequestFocus {
    type: 'requestFocus';
}

interface RequestInitPayload {
    type: 'requestInit';
}

interface RunDeviceCommandMessage {
    type: 'runDeviceCommand';
    deviceId: string;
    commandName: string;
    command: string;
}

interface OpenSshTerminalMessage {
    type: 'openSshTerminal';
    deviceId: string;
}

type IncomingMessage =
    | SidebarMessage
    | HighlightUpdateMessage
    | AddRowRequest
    | RequestFocus
    | RequestInitPayload
    | RunDeviceCommandMessage
    | OpenSshTerminalMessage;

export class SidebarViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private pendingAdd = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly getDevices: () => EmbeddedDevice[],
        private readonly onOpenDevice: (deviceId: string) => void,
        private readonly onHighlightsChanged: (highlights: HighlightDefinition[]) => void,
        private readonly getHighlights: () => HighlightDefinition[],
        private readonly onRunDeviceCommand: (deviceId: string, commandName: string, command: string) => void,
        private readonly onOpenSshTerminal: (deviceId: string) => void
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
                vscode.Uri.file(path.join(this.context.extensionPath, 'resources')),
            ],
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((message: IncomingMessage) => {
            switch (message.type) {
                case 'openDevice':
                    this.onOpenDevice(message.deviceId);
                    break;
                case 'highlightsChanged':
                    this.onHighlightsChanged(message.highlights || []);
                    break;
                case 'requestFocus':
                    vscode.commands.executeCommand('embeddedLogger.devicesView.focus');
                    break;
                case 'requestInit':
                    this.postInitialPayload();
                    break;
                case 'addRow':
                    this.addHighlightRow();
                    break;
                case 'runDeviceCommand':
                    this.onRunDeviceCommand(message.deviceId, message.commandName, message.command);
                    break;
                case 'openSshTerminal':
                    this.onOpenSshTerminal(message.deviceId);
                    break;
            }
        });

        this.postInitialPayload();
    }

    addHighlightRow() {
        if (!this.view) {
            this.pendingAdd = true;
            vscode.commands.executeCommand('embeddedLogger.devicesView.focus');
            return;
        }

        if (this.pendingAdd) {
            this.pendingAdd = false;
        }

        this.view.show?.(true);
        this.view.webview.postMessage({ type: 'addHighlightRow' });
    }

    refreshDevices() {
        if (!this.view) {
            return;
        }
        this.view.webview.postMessage({ type: 'devicesUpdated', devices: this.getDevices() });
    }

    syncHighlights() {
        if (!this.view) {
            return;
        }
        this.view.webview.postMessage({ type: 'applyHighlights', highlights: this.getHighlights() });
    }

    private postInitialPayload() {
        if (!this.view) {
            return;
        }
        this.view.webview.postMessage({ type: 'initDevices', devices: this.getDevices() });
        this.view.webview.postMessage({ type: 'applyHighlights', highlights: this.getHighlights() });
        if (this.pendingAdd) {
            this.addHighlightRow();
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sidebarView.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sidebarView.css')));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet" />
    <title>Embedded Logger Devices</title>
</head>
<body>
    <div id="highlightRows" class="highlight-rows"></div>
    <div class="device-list" id="deviceList"></div>
    <div id="sidebarStatus" class="sidebar-status"></div>
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
