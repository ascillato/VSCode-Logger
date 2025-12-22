/**
 * Provides the activity view that lists devices.
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { EmbeddedDevice } from './deviceTree';

interface SidebarMessage {
    type: 'openDevice';
    deviceId: string;
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

interface OpenSftpExplorerMessage {
    type: 'openSftpExplorer';
    deviceId: string;
}

interface OpenWebBrowserMessage {
    type: 'openWebBrowser';
    deviceId: string;
}

interface CopyDeviceNameMessage {
    type: 'copyDeviceName';
    deviceId: string;
    name: string;
}

interface CopyDeviceUrlMessage {
    type: 'copyDeviceUrl';
    deviceId: string;
    url: string;
}

type IncomingMessage =
    | SidebarMessage
    | RequestInitPayload
    | RunDeviceCommandMessage
    | OpenSshTerminalMessage
    | OpenSftpExplorerMessage
    | OpenWebBrowserMessage
    | CopyDeviceNameMessage
    | CopyDeviceUrlMessage;

/**
 * Webview provider for the Embedded Devices side panel.
 */
export class SidebarViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;

    /**
     * Creates the sidebar view provider.
     *
     * @param context The extension context for resolving resources.
     * @param getDevices Function to retrieve configured devices.
     * @param onOpenDevice Handler for opening a device log panel.
     * @param onRunDeviceCommand Handler for running a device command.
     * @param onOpenSshTerminal Handler for opening an SSH terminal.
     * @param onOpenSftpExplorer Handler for opening the SFTP explorer.
     * @param onOpenWebBrowser Handler for opening the device web URL.
     */
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly getDevices: () => EmbeddedDevice[],
        private readonly onOpenDevice: (deviceId: string) => void,
        private readonly onRunDeviceCommand: (deviceId: string, commandName: string, command: string) => void,
        private readonly onOpenSshTerminal: (deviceId: string) => void,
        private readonly onOpenSftpExplorer: (deviceId: string) => void,
        private readonly onOpenWebBrowser: (deviceId: string) => void
    ) {}

    /**
     * Resolves the sidebar webview and wires up message handlers.
     *
     * @param webviewView The webview view instance to populate.
     */
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
                case 'requestInit':
                    this.postInitialPayload();
                    break;
                case 'runDeviceCommand':
                    this.onRunDeviceCommand(message.deviceId, message.commandName, message.command);
                    break;
                case 'openSshTerminal':
                    this.onOpenSshTerminal(message.deviceId);
                    break;
                case 'openSftpExplorer':
                    this.onOpenSftpExplorer(message.deviceId);
                    break;
                case 'openWebBrowser':
                    this.onOpenWebBrowser(message.deviceId);
                    break;
                case 'copyDeviceName':
                    void this.copyToClipboard(message.name, 'Device name');
                    break;
                case 'copyDeviceUrl':
                    void this.copyToClipboard(message.url, 'Device URL');
                    break;
            }
        });

        this.postInitialPayload();
    }

    /**
     * Pushes updated device data to the webview.
     */
    refreshDevices() {
        if (!this.view) {
            return;
        }
        this.view.webview.postMessage({ type: 'devicesUpdated', devices: this.getDevicesForWebview() });
    }

    /**
     * Sends the initial device payload to the webview.
     */
    private postInitialPayload() {
        if (!this.view) {
            return;
        }
        this.view.webview.postMessage({ type: 'initDevices', devices: this.getDevicesForWebview() });
    }

    /**
     * Normalizes device data for webview consumption.
     *
     * @returns The device list with required defaults.
     */
    private getDevicesForWebview(): EmbeddedDevice[] {
        return this.getDevices().map((device) => ({
            ...device,
            enableSshTerminal: Boolean(device.enableSshTerminal),
            enableSftpExplorer: Boolean(device.enableSftpExplorer),
            enableWebBrowser: Boolean(device.enableWebBrowser),
            sshCommands: Array.isArray(device.sshCommands) ? device.sshCommands : [],
        }));
    }

    /**
     * Copies the given value to the clipboard and notifies the user.
     *
     * @param value The text to copy.
     * @param label The label shown in the confirmation message.
     */
    private async copyToClipboard(value: string, label: string) {
        await vscode.env.clipboard.writeText(value);
        await vscode.window.showInformationMessage(`${label} copied to clipboard.`);
    }

    /**
     * Builds the sidebar webview HTML.
     *
     * @param webview The webview used to resolve resource URIs.
     * @returns The HTML markup for the sidebar.
     */
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
    <div class="device-list" id="deviceList"></div>
    <div id="sidebarStatus" class="sidebar-status"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

/**
 * Generates a nonce for Content Security Policy use.
 *
 * @returns A random nonce string.
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
