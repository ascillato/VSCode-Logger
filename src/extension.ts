/**
 * @file extension.ts
 * @brief Activates the VSCode-Logger extension and manages device log panels.
 * @copyright Copyright (c) 2025 A. Scillato
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DeviceTreeDataProvider, EmbeddedDevice } from './deviceTree';
import { LogPanel } from './logPanel';

// Map of deviceId to existing log panels so multiple clicks reuse tabs.
const panelMap: Map<string, LogPanel> = new Map();
let activePanel: LogPanel | undefined;

/**
 * @brief Migrates legacy passwords into VS Code SecretStorage.
 *
 * Users might still have passwords stored in their settings for convenience. This
 * function copies those values into SecretStorage so future connections can
 * retrieve them securely without modifying the user's settings.json.
 *
 * @param context The extension context used to access SecretStorage.
 * @param devices The list of configured devices whose passwords need migration.
 */
async function migrateLegacyPasswords(context: vscode.ExtensionContext, devices: EmbeddedDevice[]) {
    const secrets = context.secrets;
    for (const device of devices) {
        const key = `embeddedLogger.password.${device.id}`;
        const existing = await secrets.get(key);
        if (!existing && device.password) {
            await secrets.store(key, device.password);
            console.log(`Migrated password for device ${device.id} into secret storage.`);
        }
    }
}

/**
 * @brief Activates the extension and registers UI components.
 *
 * The activation routine migrates legacy passwords, registers the device tree
 * view, and handles configuration changes that affect the device list.
 *
 * @param context VS Code extension context provided on activation.
 */
export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('embeddedLogger');
    const devices = config.get<EmbeddedDevice[]>('devices', []);

    await migrateLegacyPasswords(context, devices);

    const treeDataProvider = new DeviceTreeDataProvider(context);
    const treeView = vscode.window.createTreeView('embeddedLogger.devicesView', {
        treeDataProvider,
    });

    context.subscriptions.push(treeView);

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.addHighlightRow', () => {
            if (activePanel) {
                activePanel.addHighlightRow();
                return;
            }

            vscode.window.showInformationMessage('Open a log panel to add highlight keys.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.editDevicesConfig', async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'embeddedLogger.devices');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.clearStoredPasswords', async () => {
            const config = vscode.workspace.getConfiguration('embeddedLogger');
            const devices = config.get<EmbeddedDevice[]>('devices', []);

            if (!devices || devices.length === 0) {
                vscode.window.showInformationMessage('No devices configured to clear passwords for.');
                return;
            }

            for (const device of devices) {
                const key = `embeddedLogger.password.${device.id}`;
                await context.secrets.delete(key);
            }

            vscode.window.showInformationMessage('Stored passwords have been removed for configured devices.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.openLocalLogFile', async () => {
            const selection = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { Logs: ['log', 'txt'], All: ['*'] },
                openLabel: 'Open log file',
            });

            if (!selection || selection.length === 0) {
                return;
            }

            const uri = selection[0];
            let content: Uint8Array;
            try {
                content = await vscode.workspace.fs.readFile(uri);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to read log file: ${err?.message ?? err}`);
                return;
            }

            const decoded = Buffer.from(content).toString('utf8');
            const lines = decoded.split(/\r?\n/);
            if (lines.length > 0 && lines[lines.length - 1] === '') {
                lines.pop();
            }

            const panelId = `local:${uri.fsPath}`;
            const existing = panelMap.get(panelId);
            if (existing) {
                existing.reveal();
                activePanel = existing;
                return;
            }

            const panelName = `${path.basename(uri.fsPath)} (Local)`;
            const panel = new LogPanel(
                context,
                { type: 'local', id: panelId, name: panelName, lines, filePath: uri.fsPath },
                () => {
                    panelMap.delete(panelId);
                    if (activePanel === panel) {
                        activePanel = undefined;
                    }
                }
            );
            panel.onDidChangeViewState((event) => {
                if (event.webviewPanel.active) {
                    activePanel = panel;
                } else if (activePanel === panel) {
                    activePanel = undefined;
                }
            });
            activePanel = panel;
            panelMap.set(panelId, panel);
            panel.start();
        })
    );

    // Command used by tree items to open a device panel.
    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.openDevice', async (device: EmbeddedDevice) => {
            if (!device) {
                vscode.window.showErrorMessage('No device information supplied.');
                return;
            }

            const existing = panelMap.get(device.id);
            if (existing) {
                existing.reveal();
                activePanel = existing;
                return;
            }

            const panel = new LogPanel(
                context,
                { type: 'remote', device },
                () => {
                    panelMap.delete(device.id);
                    if (activePanel === panel) {
                        activePanel = undefined;
                    }
                }
            );
            panel.onDidChangeViewState((event) => {
                if (event.webviewPanel.active) {
                    activePanel = panel;
                } else if (activePanel === panel) {
                    activePanel = undefined;
                }
            });
            activePanel = panel;
            panelMap.set(device.id, panel);
            panel.start();
        })
    );

    // Refresh the tree when configuration changes.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('embeddedLogger.devices')) {
                treeDataProvider.refresh();
            }
        })
    );
}

/**
 * @brief Disposes all active log panels when the extension deactivates.
 */
export function deactivate() {
    for (const panel of panelMap.values()) {
        panel.dispose();
    }
    panelMap.clear();
}
