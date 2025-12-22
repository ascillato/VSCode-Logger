/**
 * @file extension.ts
 * @brief Activates the VSCode-Logger extension and manages device log panels.
 * @copyright Copyright (c) 2025 A. Scillato
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { EmbeddedDevice } from './deviceTree';
import { SidebarViewProvider } from './sidebarView';
import { LogPanel } from './logPanel';
import { SshCommandRunner } from './sshCommandRunner';
import { SshTerminalSession } from './sshTerminal';
import { SftpExplorerPanel } from './sftpExplorer';
import { getEmbeddedLoggerConfiguration } from './configuration';
import { PasswordManager } from './passwordManager';

// Map of deviceId to existing log panels so multiple clicks reuse tabs.
const panelMap: Map<string, LogPanel> = new Map();
const sftpPanels: Set<SftpExplorerPanel> = new Set();
let activePanel: LogPanel | undefined;
let sidebarProvider: SidebarViewProvider | undefined;

function validateSshDevice(device: EmbeddedDevice): string | undefined {
    const host = device.host?.trim();
    const username = device.username?.trim();
    if (!host) {
        return `Device "${device.name}" is missing a host.`;
    }
    if (!username) {
        return `Device "${device.name}" is missing a username.`;
    }
    if (device.port !== undefined && (!Number.isInteger(device.port) || device.port <= 0)) {
        return `Device "${device.name}" has an invalid port.`;
    }
    return undefined;
}

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
async function migrateLegacyPasswords(
    context: vscode.ExtensionContext,
    devices: EmbeddedDevice[],
    passwordManager: PasswordManager
) {
    const secrets = context.secrets;
    const hasLegacyPasswords = devices.some(
        (device) => device.password !== undefined || device.bastion?.password !== undefined
    );
    const hasLegacyPassphrases = devices.some(
        (device) => device.privateKeyPassphrase !== undefined || device.bastion?.privateKeyPassphrase !== undefined
    );

    const sanitizeDevices = (entries: EmbeddedDevice[]) =>
        entries.map((device) => {
            const { password: _password, privateKeyPassphrase: _passphrase, bastion, ...rest } = device;
            return {
                ...rest,
                bastion: bastion
                    ? (() => {
                          const { password: _bastionPassword, privateKeyPassphrase: _bastionPassphrase, ...bastionRest } =
                              bastion;
                          return bastionRest;
                      })()
                    : undefined,
            };
        });

    for (const device of devices) {
        if (device.password !== undefined) {
            await passwordManager.storePassword(device, device.password);
            await secrets.delete(`embeddedLogger.password.${device.id}`);
            console.log(`Migrated password for device ${device.id} into secret storage.`);
        }

        if (device.privateKeyPassphrase !== undefined) {
            await passwordManager.storePassphrase(device, device.privateKeyPassphrase);
            await secrets.delete(`embeddedLogger.passphrase.${device.id}`);
            console.log(`Migrated private key passphrase for device ${device.id} into secret storage.`);
        }

        if (device.bastion?.password !== undefined && device.bastion.host && device.bastion.username) {
            const bastionDevice: EmbeddedDevice = {
                id: `${device.id}-bastion`,
                name: `${device.name} bastion`,
                host: device.bastion.host,
                username: device.bastion.username,
            };
            await passwordManager.storePassword(bastionDevice, device.bastion.password);
            await secrets.delete(`embeddedLogger.password.${bastionDevice.id}`);
            console.log(`Migrated bastion password for device ${device.id} into secret storage.`);
        }

        if (
            device.bastion?.privateKeyPassphrase !== undefined &&
            device.bastion.host &&
            device.bastion.username
        ) {
            const bastionDevice: EmbeddedDevice = {
                id: `${device.id}-bastion`,
                name: `${device.name} bastion`,
                host: device.bastion.host,
                username: device.bastion.username,
            };
            await passwordManager.storePassphrase(bastionDevice, device.bastion.privateKeyPassphrase);
            await secrets.delete(`embeddedLogger.passphrase.${bastionDevice.id}`);
            console.log(`Migrated bastion private key passphrase for device ${device.id} into secret storage.`);
        }
    }

    if (!hasLegacyPasswords && !hasLegacyPassphrases) {
        return;
    }

    const warningMessage =
        'Credentials were migrated to Secret Storage, but the legacy "password" or "privateKeyPassphrase" fields could not be removed. ' +
        'Please delete them from embeddedLogger.devices in your settings.';

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const config = vscode.workspace.getConfiguration('embeddedLogger');
    const inspection = config.inspect<EmbeddedDevice[]>('devices');
    let removalAttempted = false;

    for (const folder of workspaceFolders) {
        const folderConfig = vscode.workspace.getConfiguration('embeddedLogger', folder.uri);
        const folderInspection = folderConfig.inspect<EmbeddedDevice[]>('devices');
        const folderValue = folderInspection?.workspaceFolderValue;

        if (!folderValue || !folderValue.some((device) => device.password !== undefined)) {
            continue;
        }

        removalAttempted = true;

        try {
            await folderConfig.update('devices', sanitizeDevices(folderValue), vscode.ConfigurationTarget.WorkspaceFolder);
        } catch (err: any) {
            console.error('Failed to remove legacy passwords from workspace folder settings.', err);
            vscode.window.showWarningMessage(warningMessage);
            return;
        }
    }

    const workspaceValue = inspection?.workspaceValue;
    if (workspaceValue && workspaceValue.some((device) => device.password !== undefined)) {
        removalAttempted = true;

        try {
            await config.update('devices', sanitizeDevices(workspaceValue), vscode.ConfigurationTarget.Workspace);
        } catch (err: any) {
            console.error('Failed to remove legacy passwords from workspace settings.', err);
            vscode.window.showWarningMessage(warningMessage);
            return;
        }
    }

    const globalValue = inspection?.globalValue;
    if (globalValue && globalValue.some((device) => device.password !== undefined)) {
        removalAttempted = true;

        try {
            await config.update('devices', sanitizeDevices(globalValue), vscode.ConfigurationTarget.Global);
        } catch (err: any) {
            console.error('Failed to remove legacy passwords from user settings.', err);
            vscode.window.showWarningMessage(warningMessage);
            return;
        }
    }

    if (!removalAttempted) {
        vscode.window.showWarningMessage(warningMessage);
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
    const passwordManager = new PasswordManager(context);
    const { devices } = getEmbeddedLoggerConfiguration();

    await migrateLegacyPasswords(context, devices, passwordManager);

    const getDevices = () => getEmbeddedLoggerConfiguration().devices;

    const openWebBrowser = async (device: EmbeddedDevice | undefined) => {
        if (!device) {
            vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
            return;
        }

        if (!vscode.workspace.isTrusted) {
            vscode.window.showErrorMessage('Workspace trust is required before opening device resources.');
            return;
        }

        const target = device.webBrowserUrl?.trim() || device.host?.trim();
        if (!target) {
            vscode.window.showErrorMessage('No host found for the selected device.');
            return;
        }

        const normalizedUrl = /^https?:\/\//i.test(target) ? target : `http://${target}`;
        let uri: vscode.Uri;
        try {
            uri = vscode.Uri.parse(normalizedUrl, true);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Invalid web URL for ${device.name}: ${err?.message ?? String(err)}`);
            return;
        }

        if (uri.scheme !== 'http' && uri.scheme !== 'https') {
            vscode.window.showErrorMessage('Web browser URLs must start with http:// or https://.');
            return;
        }

        try {
            await vscode.env.openExternal(uri);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open ${uri.toString(true)}: ${err?.message ?? String(err)}`);
        }
    };

    const openSftpExplorer = async (device: EmbeddedDevice | undefined) => {
        if (!device) {
            vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
            return;
        }

        if (!vscode.workspace.isTrusted) {
            vscode.window.showErrorMessage('Workspace trust is required before connecting to devices.');
            return;
        }

        const validationError = validateSshDevice(device);
        if (validationError) {
            vscode.window.showErrorMessage(validationError);
            return;
        }

        let panel: SftpExplorerPanel | undefined;
        try {
            panel = new SftpExplorerPanel(context, device);
            const createdPanel = panel;
            sftpPanels.add(createdPanel);
            createdPanel.onDidDispose(() => sftpPanels.delete(createdPanel));
            await panel.start();
        } catch (err: any) {
            if (panel) {
                sftpPanels.delete(panel);
            }
            vscode.window.showErrorMessage(err?.message ?? String(err));
        }
    };

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
        },
        async (deviceId) => {
            const device = getDevices().find((item) => item.id === deviceId);
            if (!device) {
                vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
                return;
            }

            if (!vscode.workspace.isTrusted) {
                vscode.window.showErrorMessage('Workspace trust is required before connecting to devices.');
                return;
            }

            const error = validateSshDevice(device);
            if (error) {
                vscode.window.showErrorMessage(error);
                return;
            }

            const terminal = vscode.window.createTerminal({
                name: `${device.name} SSH`,
                pty: new SshTerminalSession(device, context),
            });
            terminal.show(true);
        },
        (deviceId) => openSftpExplorer(getDevices().find((item) => item.id === deviceId)),
        (deviceId) => openWebBrowser(getDevices().find((item) => item.id === deviceId))
    );

    context.subscriptions.push(vscode.window.registerWebviewViewProvider('embeddedLogger.devicesView', sidebarProvider));

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.editDevicesConfig', async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'embeddedLogger');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.openSftpExplorer', async (device?: EmbeddedDevice) => {
            if (device) {
                await openSftpExplorer(device);
                return;
            }

            const devices = getDevices();
            if (!devices.length) {
                vscode.window.showErrorMessage('No devices configured. Check embeddedLogger.devices.');
                return;
            }

            const selection = await vscode.window.showQuickPick(
                devices.map((item) => ({ label: item.name, description: item.host, device: item })),
                { placeHolder: 'Select a device to open the SFTP explorer' }
            );

            if (selection?.device) {
                await openSftpExplorer(selection.device);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.openWebBrowser', async (device?: EmbeddedDevice) => {
            if (device) {
                await openWebBrowser(device);
                return;
            }

            const devices = getDevices();
            if (!devices.length) {
                vscode.window.showErrorMessage('No devices configured. Check embeddedLogger.devices.');
                return;
            }

            const selection = await vscode.window.showQuickPick(
                devices.map((item) => ({ label: item.name, description: item.host, device: item })),
                { placeHolder: 'Select a device to open in the web browser' }
            );

            if (selection?.device) {
                await openWebBrowser(selection.device);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('embeddedLogger.clearStoredPasswords', async () => {
            const devices = getDevices();

            if (!devices || devices.length === 0) {
                vscode.window.showInformationMessage('No devices configured to clear passwords for.');
                return;
            }

            for (const device of devices) {
                await passwordManager.clearPassword(device.id);
            }

            vscode.window.showInformationMessage('Stored passwords and passphrases have been removed for configured devices.');
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
            if (e.affectsConfiguration('embeddedLogger')) {
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

    for (const explorer of sftpPanels.values()) {
        explorer.dispose();
    }
    sftpPanels.clear();
}
