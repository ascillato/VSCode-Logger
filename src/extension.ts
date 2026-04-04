/**
 * Activates the VSCode-Logger extension and manages device log panels.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { EmbeddedDevice, SshCommandDefinition } from './deviceTree';
import { SidebarViewProvider } from './sidebarView';
import { LogPanel } from './logPanel';
import { SshCommandRunner } from './sshCommandRunner';
import { SshTerminalSession } from './sshTerminal';
import { SftpExplorerPanel } from './sftpExplorer';
import {
  getEmbeddedLoggerConfiguration,
  getEmbeddedLoggerDeviceConfigurationScopes,
  getEmbeddedLoggerGroups,
  mergeSftpPresets,
  sanitizeSftpPresets,
} from './configuration';
import { PasswordManager } from './passwordManager';
import { DeviceManagerPanel } from './deviceManagerPanel';

// Map of deviceId to existing log panels so multiple clicks reuse tabs.
const panelMap: Map<string, LogPanel> = new Map();
const sftpPanels: Set<SftpExplorerPanel> = new Set();
let activePanel: LogPanel | undefined;
let sidebarProvider: SidebarViewProvider | undefined;

export interface ExtensionTestApi {
  openSftpExplorerForTest(device: EmbeddedDevice): Promise<SftpExplorerPanel | undefined>;
  getSftpPanels(): SftpExplorerPanel[];
}

/**
 * Validates the SSH-related fields for a configured device.
 *
 * @param device The device configuration to validate.
 * @returns A user-facing error message when invalid, otherwise undefined.
 */
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
 * Migrates passwords into VS Code SecretStorage.
 *
 * Users might still have passwords stored in their settings for convenience. This
 * function copies those values into SecretStorage so future connections can
 * retrieve them securely without modifying the user's settings.json.
 *
 * @param context The extension context used to access SecretStorage.
 * @param devices The list of configured devices whose passwords need migration.
 * @param passwordManager The password manager used to store secrets.
 */
async function migrateLegacyPasswords(
  context: vscode.ExtensionContext,
  devices: EmbeddedDevice[],
  passwordManager: PasswordManager
): Promise<void> {
  const secrets = context.secrets;
  const hasLegacyPasswords = devices.some(
    (device) => device.password !== undefined || device.bastion?.password !== undefined
  );
  const hasLegacyPassphrases = devices.some(
    (device) =>
      device.privateKeyPassphrase !== undefined ||
      device.bastion?.privateKeyPassphrase !== undefined
  );

  const sanitizeDevices = (entries: EmbeddedDevice[]): EmbeddedDevice[] =>
    entries.map((device) => {
      const { password: _password, privateKeyPassphrase: _passphrase, bastion, ...rest } = device;
      const sanitizedBastion = bastion
        ? (({
            password: _bastionPassword,
            privateKeyPassphrase: _bastionPassphrase,
            ...bastionRest
          }): EmbeddedDevice['bastion'] => {
            void _bastionPassword;
            void _bastionPassphrase;
            return bastionRest;
          })(bastion)
        : undefined;

      void _password;
      void _passphrase;

      return {
        ...rest,
        bastion: sanitizedBastion,
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
      console.log(
        `Migrated bastion private key passphrase for device ${device.id} into secret storage.`
      );
    }
  }

  if (!hasLegacyPasswords && !hasLegacyPassphrases) {
    return;
  }

  const warningMessage =
    'Credentials were migrated to Secret Storage, but the "password" or "privateKeyPassphrase" fields could not be removed. ' +
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
      await folderConfig.update(
        'devices',
        sanitizeDevices(folderValue),
        vscode.ConfigurationTarget.WorkspaceFolder
      );
    } catch (err: unknown) {
      console.error('Failed to remove passwords from workspace folder settings.', err);
      vscode.window.showWarningMessage(warningMessage);
      return;
    }
  }

  const workspaceValue = inspection?.workspaceValue;
  if (workspaceValue && workspaceValue.some((device) => device.password !== undefined)) {
    removalAttempted = true;

    try {
      await config.update(
        'devices',
        sanitizeDevices(workspaceValue),
        vscode.ConfigurationTarget.Workspace
      );
    } catch (err: unknown) {
      console.error('Failed to remove passwords from workspace settings.', err);
      vscode.window.showWarningMessage(warningMessage);
      return;
    }
  }

  const globalValue = inspection?.globalValue;
  if (globalValue && globalValue.some((device) => device.password !== undefined)) {
    removalAttempted = true;

    try {
      await config.update(
        'devices',
        sanitizeDevices(globalValue),
        vscode.ConfigurationTarget.Global
      );
    } catch (err: unknown) {
      console.error('Failed to remove passwords from user settings.', err);
      vscode.window.showWarningMessage(warningMessage);
      return;
    }
  }

  if (!removalAttempted) {
    vscode.window.showWarningMessage(warningMessage);
  }
}

function getLegacySftpPresetKey(deviceId: string, location: 'remote' | 'local'): string {
  return location === 'remote'
    ? `embeddedLogger.sftpPresets.${deviceId}`
    : `embeddedLogger.sftpPresets.local.${deviceId}`;
}

async function migrateLegacySftpPresets(context: vscode.ExtensionContext): Promise<void> {
  const scopes = getEmbeddedLoggerDeviceConfigurationScopes();
  if (!scopes.length) {
    return;
  }

  let warningShown = false;

  for (const scope of scopes) {
    const deviceIdsToCleanup = new Set<string>();
    let scopeChanged = false;

    const migratedDevices = scope.devices.map((device) => {
      const deviceId = device.id.trim();
      if (!deviceId) {
        return device;
      }

      const legacyRemote = sanitizeSftpPresets(
        context.workspaceState.get<string[]>(getLegacySftpPresetKey(deviceId, 'remote'), [])
      );
      const legacyLocal = sanitizeSftpPresets(
        context.workspaceState.get<string[]>(getLegacySftpPresetKey(deviceId, 'local'), [])
      );

      if (!legacyRemote.length && !legacyLocal.length) {
        return device;
      }

      deviceIdsToCleanup.add(deviceId);

      const nextRemote = mergeSftpPresets(device.sftpPresetsRemote, legacyRemote);
      const nextLocal = mergeSftpPresets(device.sftpPresetsLocal, legacyLocal);
      const currentRemote = sanitizeSftpPresets(device.sftpPresetsRemote);
      const currentLocal = sanitizeSftpPresets(device.sftpPresetsLocal);

      const remoteChanged =
        currentRemote.length !== nextRemote.length ||
        currentRemote.some((entry, index) => entry !== nextRemote[index]);
      const localChanged =
        currentLocal.length !== nextLocal.length ||
        currentLocal.some((entry, index) => entry !== nextLocal[index]);

      if (!remoteChanged && !localChanged) {
        return device;
      }

      scopeChanged = true;

      const updatedDevice: EmbeddedDevice = { ...device };
      if (nextRemote.length > 0) {
        updatedDevice.sftpPresetsRemote = nextRemote;
      } else {
        delete updatedDevice.sftpPresetsRemote;
      }
      if (nextLocal.length > 0) {
        updatedDevice.sftpPresetsLocal = nextLocal;
      } else {
        delete updatedDevice.sftpPresetsLocal;
      }

      return updatedDevice;
    });

    if (!deviceIdsToCleanup.size) {
      continue;
    }

    try {
      if (scopeChanged) {
        await scope.config.update('devices', migratedDevices, scope.target);
      }

      for (const deviceId of deviceIdsToCleanup) {
        await context.workspaceState.update(getLegacySftpPresetKey(deviceId, 'remote'), undefined);
        await context.workspaceState.update(getLegacySftpPresetKey(deviceId, 'local'), undefined);
      }
    } catch (err: unknown) {
      console.error('Failed to migrate SFTP presets into embeddedLogger.devices.', err);
      if (!warningShown) {
        warningShown = true;
        vscode.window.showWarningMessage(
          'Failed to migrate SFTP presets into embeddedLogger.devices. Existing presets remain in extension storage.'
        );
      }
    }
  }
}

/**
 * Activates the extension and registers UI components.
 *
 * The activation routine migrates passwords, registers the device tree
 * view, and handles configuration changes that affect the device list.
 *
 * @param context VS Code extension context provided on activation.
 */
export async function activate(context: vscode.ExtensionContext): Promise<ExtensionTestApi | void> {
  const isTestMode = context.extensionMode === vscode.ExtensionMode.Test;
  const passwordManager = new PasswordManager(context);
  await migrateLegacySftpPresets(context);
  const { devices } = getEmbeddedLoggerConfiguration();

  await migrateLegacyPasswords(context, devices, passwordManager);

  const getDevices = (): EmbeddedDevice[] => getEmbeddedLoggerConfiguration().devices;
  const findDevice = (deviceId: string): EmbeddedDevice | undefined =>
    getDevices().find((item) => item.id === deviceId);
  const clearStoredCredentialsForDevice = async (deviceId: string): Promise<void> => {
    await passwordManager.clearPassword(deviceId);
    await passwordManager.clearPassword(`${deviceId}-bastion`);
  };
  const parseDeviceIdTarget = (target?: unknown): string | undefined => {
    if (typeof target === 'string') {
      const deviceId = target.trim();
      return deviceId || undefined;
    }
    if (target && typeof target === 'object' && 'id' in target) {
      const candidate = (target as { id?: unknown }).id;
      if (typeof candidate === 'string') {
        const deviceId = candidate.trim();
        return deviceId || undefined;
      }
    }
    return undefined;
  };

  const resolveDeviceWebUri = (device: EmbeddedDevice): vscode.Uri | undefined => {
    const target = device.webBrowserUrl?.trim() || device.host?.trim();
    if (!target) {
      vscode.window.showErrorMessage('No host found for the selected device.');
      return undefined;
    }

    const normalizedUrl = /^https?:\/\//i.test(target) ? target : `http://${target}`;
    try {
      const uri = vscode.Uri.parse(normalizedUrl, true);
      if (uri.scheme !== 'http' && uri.scheme !== 'https') {
        vscode.window.showErrorMessage('Web browser URLs must start with http:// or https://.');
        return undefined;
      }
      return uri;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Invalid web URL for ${device.name}: ${message}`);
      return undefined;
    }
  };

  const openWebBrowser = async (device: EmbeddedDevice | undefined): Promise<void> => {
    if (!device) {
      vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
      return;
    }

    if (!vscode.workspace.isTrusted) {
      vscode.window.showErrorMessage(
        'Workspace trust is required before opening device resources.'
      );
      return;
    }

    const uri = resolveDeviceWebUri(device);
    if (!uri) {
      return;
    }

    try {
      await vscode.env.openExternal(uri);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to open ${uri.toString(true)}: ${message}`);
    }
  };

  const openEmbeddedWebBrowser = async (device: EmbeddedDevice | undefined): Promise<void> => {
    if (!device) {
      vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
      return;
    }

    if (!vscode.workspace.isTrusted) {
      vscode.window.showErrorMessage(
        'Workspace trust is required before opening device resources.'
      );
      return;
    }

    const uri = resolveDeviceWebUri(device);
    if (!uri) {
      return;
    }

    try {
      const commands = await vscode.commands.getCommands(true);
      const commandId = commands.includes('workbench.action.browser.open')
        ? 'workbench.action.browser.open'
        : commands.includes('simpleBrowser.show')
          ? 'simpleBrowser.show'
          : undefined;

      if (!commandId) {
        vscode.window.showErrorMessage('VS Code embedded browser support is unavailable.');
        return;
      }

      await vscode.commands.executeCommand(commandId, uri.toString(true));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to open ${uri.toString(true)}: ${message}`);
    }
  };

  const openSftpExplorer = async (
    device: EmbeddedDevice | undefined
  ): Promise<SftpExplorerPanel | undefined> => {
    if (!device) {
      vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
      return undefined;
    }

    if (!isTestMode && !vscode.workspace.isTrusted) {
      vscode.window.showErrorMessage('Workspace trust is required before connecting to devices.');
      return undefined;
    }

    const validationError = validateSshDevice(device);
    if (validationError) {
      vscode.window.showErrorMessage(validationError);
      return undefined;
    }

    let panel: SftpExplorerPanel | undefined;
    try {
      panel = new SftpExplorerPanel(context, device);
      const createdPanel = panel;
      sftpPanels.add(createdPanel);
      createdPanel.onDidDispose(() => sftpPanels.delete(createdPanel));
      await panel.start();
      return panel;
    } catch (err: unknown) {
      if (panel) {
        sftpPanels.delete(panel);
      }
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(message);
    }
    return undefined;
  };

  const openSshTerminal = (
    device: EmbeddedDevice | undefined,
    commandDefinition?: Pick<
      SshCommandDefinition,
      'command' | 'copyAndRunScript' | 'script' | 'name'
    >,
    commandName?: string,
    rerunInitialCommandOnReconnect = false
  ): void => {
    if (!device) {
      vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
      return;
    }

    if (!isTestMode && !vscode.workspace.isTrusted) {
      vscode.window.showErrorMessage('Workspace trust is required before connecting to devices.');
      return;
    }

    const error = validateSshDevice(device);
    if (error) {
      vscode.window.showErrorMessage(error);
      return;
    }

    const normalizedInitialCommand = commandDefinition?.command?.trim();
    if (normalizedInitialCommand && /\r|\n/.test(normalizedInitialCommand)) {
      vscode.window.showErrorMessage(
        'SSH command must not contain control characters or new lines.'
      );
      return;
    }

    const terminalName = commandName ? `${device.name} SSH: ${commandName}` : `${device.name} SSH`;
    const terminal = vscode.window.createTerminal({
      name: terminalName,
      pty: new SshTerminalSession(
        device,
        context,
        undefined,
        normalizedInitialCommand,
        rerunInitialCommandOnReconnect,
        commandDefinition?.copyAndRunScript === true ? commandDefinition.script : undefined
      ),
    });
    terminal.show(true);
  };

  sidebarProvider = new SidebarViewProvider(
    context,
    getDevices,
    () => getEmbeddedLoggerGroups(),
    (deviceId) => {
      const device = findDevice(deviceId);
      if (device) {
        void vscode.commands.executeCommand('embeddedLogger.openDevice', device);
      } else {
        vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
      }
    },
    (
      deviceId,
      commandName,
      command,
      openSshPanel,
      rerunOnReconnection,
      copyAndRunScript,
      script
    ) => {
      const device = findDevice(deviceId);
      if (!device) {
        vscode.window.showErrorMessage('Device not found. Check embeddedLogger.devices.');
        return;
      }

      const commandDefinition: SshCommandDefinition = {
        name: commandName,
        command,
        openSshPanel: openSshPanel === true ? true : undefined,
        rerunOnReconnection:
          openSshPanel === true && rerunOnReconnection === true ? true : undefined,
        copyAndRunScript:
          copyAndRunScript === true && typeof script === 'string' && script.trim()
            ? true
            : undefined,
        script,
      };

      if (openSshPanel) {
        openSshTerminal(device, commandDefinition, commandName, rerunOnReconnection === true);
        return;
      }

      void (async (): Promise<void> => {
        try {
          await vscode.window.withProgress(
            {
              title: `Running "${commandName}" on ${device.name}`,
              location: vscode.ProgressLocation.Notification,
            },
            async () => {
              const runner = new SshCommandRunner(device, context);
              const output = await runner.run(commandDefinition);
              const trimmed = output.trim();
              const message = trimmed || `Command "${commandName}" finished on ${device.name}.`;
              vscode.window.showInformationMessage(message);
            }
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(message);
        }
      })();
    },
    (deviceId) => {
      const device = findDevice(deviceId);
      openSshTerminal(device);
    },
    (deviceId) => {
      const device = findDevice(deviceId);
      void openSftpExplorer(device);
    },
    (deviceId) => {
      const device = findDevice(deviceId);
      void openWebBrowser(device);
    },
    (deviceId) => {
      const device = findDevice(deviceId);
      void openEmbeddedWebBrowser(device);
    }
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('embeddedLogger.devicesView', sidebarProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('embeddedLogger.editDevicesConfig', () => {
      DeviceManagerPanel.createOrShow(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'embeddedLogger.openSftpExplorer',
      async (device?: EmbeddedDevice) => {
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
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'embeddedLogger.openWebBrowser',
      async (device?: EmbeddedDevice) => {
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
          { placeHolder: 'Select a device to open in the external web browser' }
        );

        if (selection?.device) {
          await openWebBrowser(selection.device);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'embeddedLogger.openEmbeddedWebBrowser',
      async (device?: EmbeddedDevice) => {
        if (device) {
          await openEmbeddedWebBrowser(device);
          return;
        }

        const devices = getDevices();
        if (!devices.length) {
          vscode.window.showErrorMessage('No devices configured. Check embeddedLogger.devices.');
          return;
        }

        const selection = await vscode.window.showQuickPick(
          devices.map((item) => ({ label: item.name, description: item.host, device: item })),
          { placeHolder: 'Select a device to open in the embedded web browser' }
        );

        if (selection?.device) {
          await openEmbeddedWebBrowser(selection.device);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'embeddedLogger.clearStoredPasswords',
      async (targetDevice?: unknown) => {
        const targetDeviceId = parseDeviceIdTarget(targetDevice);
        if (targetDeviceId) {
          await clearStoredCredentialsForDevice(targetDeviceId);
          const targetDeviceConfig = findDevice(targetDeviceId);
          const deviceLabel = targetDeviceConfig?.name ?? targetDeviceId;
          vscode.window.showInformationMessage(
            `Stored passwords and passphrases have been removed for ${deviceLabel}.`
          );
          return;
        }

        const devices = getDevices();

        if (!devices || devices.length === 0) {
          vscode.window.showInformationMessage('No devices configured to clear passwords for.');
          return;
        }

        for (const device of devices) {
          await clearStoredCredentialsForDevice(device.id);
        }

        vscode.window.showInformationMessage(
          'Stored passwords and passphrases have been removed for configured devices.'
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('embeddedLogger.openLocalLogFile', async (): Promise<void> => {
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to read log file: ${message}`);
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
      await panel.start();
    })
  );

  // Command used by tree items to open a device panel.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'embeddedLogger.openDevice',
      async (device: EmbeddedDevice): Promise<void> => {
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

        const panel = new LogPanel(context, { type: 'remote', device }, () => {
          panelMap.delete(device.id);
          if (activePanel === panel) {
            activePanel = undefined;
          }
        });
        panel.onDidChangeViewState((event) => {
          if (event.webviewPanel.active) {
            activePanel = panel;
          } else if (activePanel === panel) {
            activePanel = undefined;
          }
        });
        activePanel = panel;
        panelMap.set(device.id, panel);
        await panel.start();
      }
    )
  );

  // Refresh the tree when configuration changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('embeddedLogger')) {
        sidebarProvider?.refreshDevices();
      }
    })
  );

  if (isTestMode) {
    return {
      openSftpExplorerForTest: async (device: EmbeddedDevice) => openSftpExplorer(device),
      getSftpPanels: () => Array.from(sftpPanels),
    };
  }
}

/**
 * Disposes all active log panels when the extension deactivates.
 */
export function deactivate(): void {
  for (const panel of panelMap.values()) {
    panel.dispose();
  }
  panelMap.clear();

  for (const explorer of sftpPanels.values()) {
    explorer.dispose();
  }
  sftpPanels.clear();
}
