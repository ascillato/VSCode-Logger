import * as vscode from 'vscode';
import { DeviceTreeDataProvider, EmbeddedDevice } from './deviceTree';
import { LogPanel } from './logPanel';

// Map of deviceId to existing log panels so multiple clicks reuse tabs.
const panelMap: Map<string, LogPanel> = new Map();

/**
 * Migrates plain-text passwords in settings into VS Code SecretStorage.
 * The user can keep passwords in settings for convenience, but the canonical copy
 * should live in SecretStorage. We do not modify the user's settings.json; we only
 * store the password securely and ignore the plain-text property afterwards.
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

export function deactivate() {
    for (const panel of panelMap.values()) {
        panel.dispose();
    }
    panelMap.clear();
}
