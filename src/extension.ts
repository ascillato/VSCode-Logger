/**
 * @file extension.ts
 * @brief Activates the VSCode-Logger extension and manages device log panels.
 * @copyright Copyright (c) 2025 A. Scillato
 */

import * as vscode from 'vscode';
import { DeviceTreeDataProvider, EmbeddedDevice } from './deviceTree';
import { LogPanel } from './logPanel';

// Map of deviceId to existing log panels so multiple clicks reuse tabs.
const panelMap: Map<string, LogPanel> = new Map();

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
                return;
            }

            const panel = new LogPanel(context, device, () => {
                panelMap.delete(device.id);
            });
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
