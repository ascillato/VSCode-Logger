/**
 * @file extension.ts
 * @brief Activates the VSCode-Logger extension and manages device log panels.
 * @copyright Copyright (c) 2025 A. Scillato
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { EmbeddedDevice } from './deviceTree';
import { HighlightDefinition, SidebarViewProvider } from './sidebarView';
import { LogPanel } from './logPanel';
import { SshCommandRunner } from './sshCommandRunner';

// Map of deviceId to existing log panels so multiple clicks reuse tabs.
const panelMap: Map<string, LogPanel> = new Map();
let activePanel: LogPanel | undefined;
let sidebarProvider: SidebarViewProvider | undefined;
let highlights: HighlightDefinition[] = [];

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

    const getDevices = () => vscode.workspace.getConfiguration('embeddedLogger').get<EmbeddedDevice[]>('devices', []);

    sidebarProvider = new SidebarViewProvider(
        context,
        getDevices,
        (deviceId) => {
            const device = getDevices().find((item) => item.id === deviceId);
            if (device) {
                vscode.commands.executeCommand('embeddedLogger.openDevice', device);
            } else {
                vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
            }
        },
        (updatedHighlights) => {
            highlights = updatedHighlights.map((highlight, index) => ({
                ...highlight,
                id: highlight.id || index + 1,
            }));
            for (const panel of panelMap.values()) {
                panel.updateHighlights(highlights);
            }
        },
        () => highlights,
        async (deviceId, commandName, command) => {
            const device = getDevices().find((item) => item.id === deviceId);
            if (!device) {
                vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
                return;
            }

            try {
                await vscode.window.withProgress(
                    {
                        title: `Running "${commandName}" on ${device.name}`,
                        location: vscode.ProgressLocation.Notification,
                    },
                    async () => {
                        const runner = new SshCommandRunner(device, context);
                        const output = await runner.run({ name: commandName, command });
                        const trimmed = output.trim();
                        const message = trimmed || `Command "${commandName}" finished on ${device.name}.`;
                        vscode.window.showInformationMessage(message);
                    }
                );
            } catch (err: any) {
                vscode.window.showErrorMessage(err?.message ?? String(err));
            }
        }
    );

    context.subscriptions.push(vscode.window.registerWebviewViewProvider('embeddedLogger.devicesView', sidebarProvider));

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.addHighlightRow', () => {
            sidebarProvider?.addHighlightRow();
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
                },
                highlights
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
                },
                highlights
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
                sidebarProvider?.refreshDevices();
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
