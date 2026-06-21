/**
 * Helpers for reading Embedded Device Logger configuration with defaults.
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import type { EmbeddedDevice, EmbeddedDeviceGroup, SshCommandDefinition } from './deviceTree';
import { ensureUniqueDeviceIds } from './deviceIdentity';
import { normalizeStoredCommand, normalizeStoredScript } from './sshCommandExecution';

const sftpPresetLimit = 10;

interface LoggerDefaults {
  defaultPort: number;
  defaultLogCommand: string;
  defaultEnableSshTerminal: boolean;
  defaultEnableSftpExplorer: boolean;
  defaultEnableWebBrowser: boolean;
  defaultEnableEmbeddedWebBrowser: boolean;
  defaultSshCommands: SshCommandDefinition[];
}

function normalizeDevicePingIntervalSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

export interface EmbeddedLoggerDeviceConfigurationScope {
  config: vscode.WorkspaceConfiguration;
  target: vscode.ConfigurationTarget;
  devices: EmbeddedDevice[];
}

function normalizeEmbeddedLoggerGroups(value: unknown): EmbeddedDeviceGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((group) => ({ name: (group as EmbeddedDeviceGroup | undefined)?.name?.trim() ?? '' }))
    .filter((group) => group.name.length > 0);
}

function isEmbeddedDeviceArray(value: unknown): value is EmbeddedDevice[] {
  return Array.isArray(value);
}

function getDeviceId(device: Pick<EmbeddedDevice, 'id'>): string {
  return device.id.trim();
}

function normalizeSshCommands(value: unknown): SshCommandDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: SshCommandDefinition[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const command = entry as Partial<SshCommandDefinition>;
    const name = typeof command.name === 'string' ? command.name.trim() : '';
    const shellCommand = normalizeStoredCommand(command.command);
    const copyAndRunScript = command.copyAndRunScript === true;
    const script = normalizeStoredScript(command.script);

    if (!name) {
      continue;
    }

    if (!shellCommand && !(copyAndRunScript && script)) {
      continue;
    }

    normalized.push({
      name,
      command: shellCommand,
      openSshPanel: command.openSshPanel === true ? true : undefined,
      rerunOnReconnection:
        command.openSshPanel === true && command.rerunOnReconnection === true ? true : undefined,
      copyAndRunScript: copyAndRunScript && script ? true : undefined,
      script,
    });
  }

  return normalized;
}

function getConfiguredDeviceScopes(): EmbeddedLoggerDeviceConfigurationScope[] {
  const scopes: EmbeddedLoggerDeviceConfigurationScope[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  for (const folder of workspaceFolders) {
    const config = vscode.workspace.getConfiguration('embeddedLogger', folder.uri);
    const inspection = config.inspect<EmbeddedDevice[]>('devices');
    if (isEmbeddedDeviceArray(inspection?.workspaceFolderValue)) {
      scopes.push({
        config,
        target: vscode.ConfigurationTarget.WorkspaceFolder,
        devices: ensureUniqueDeviceIds(inspection.workspaceFolderValue),
      });
    }
  }

  const config = vscode.workspace.getConfiguration('embeddedLogger');
  const inspection = config.inspect<EmbeddedDevice[]>('devices');

  if (isEmbeddedDeviceArray(inspection?.workspaceValue)) {
    scopes.push({
      config,
      target: vscode.ConfigurationTarget.Workspace,
      devices: ensureUniqueDeviceIds(inspection.workspaceValue),
    });
  }

  if (isEmbeddedDeviceArray(inspection?.globalValue)) {
    scopes.push({
      config,
      target: vscode.ConfigurationTarget.Global,
      devices: ensureUniqueDeviceIds(inspection.globalValue),
    });
  }

  return scopes;
}

/**
 * Reads the default logger settings from workspace configuration.
 *
 * @param config The Embedded Logger workspace configuration.
 * @returns The normalized default settings.
 */
function getLoggerDefaults(config: vscode.WorkspaceConfiguration): LoggerDefaults {
  const defaultPort = config.get<number>('defaultPort', 22) || 22;
  const defaultLogCommand =
    config.get<string>('defaultLogCommand', 'tail -F /var/log/syslog') || 'tail -F /var/log/syslog';
  const defaultEnableSshTerminal = config.get<boolean>('defaultEnableSshTerminal', true) ?? true;
  const defaultEnableSftpExplorer = config.get<boolean>('defaultEnableSftpExplorer', true) ?? true;
  const defaultEnableWebBrowser = config.get<boolean>('defaultEnableWebBrowser', true) ?? true;
  const defaultEnableEmbeddedWebBrowser =
    config.get<boolean>('defaultEnableEmbeddedWebBrowser', true) ?? true;
  const defaultSshCommands = config.get<SshCommandDefinition[]>('defaultSshCommands', []) || [];

  return {
    defaultPort,
    defaultLogCommand,
    defaultEnableSshTerminal,
    defaultEnableSftpExplorer,
    defaultEnableWebBrowser,
    defaultEnableEmbeddedWebBrowser,
    defaultSshCommands: normalizeSshCommands(defaultSshCommands),
  };
}

/**
 * Applies global defaults to a device definition.
 *
 * @param device The device configuration to normalize.
 * @param defaults The default settings to apply.
 * @returns The device configuration with defaults applied.
 */
function applyDeviceDefaults(device: EmbeddedDevice, defaults: LoggerDefaults): EmbeddedDevice {
  const deviceSshCommands = normalizeSshCommands(device.sshCommands);
  const showDefaultSshCommands = device.showDefaultSshCommands ?? true;
  const sshCommands = showDefaultSshCommands
    ? [
        ...defaults.defaultSshCommands.map((command) => ({ ...command })),
        ...deviceSshCommands.map((command) => ({ ...command })),
      ]
    : deviceSshCommands.map((command) => ({ ...command }));

  return {
    ...device,
    port: device.port ?? defaults.defaultPort,
    bastion: device.bastion
      ? {
          ...device.bastion,
          port: device.bastion.port ?? defaults.defaultPort,
        }
      : undefined,
    logCommand: device.logCommand ?? defaults.defaultLogCommand,
    enableSshTerminal: device.enableSshTerminal ?? defaults.defaultEnableSshTerminal,
    enableSftpExplorer: device.enableSftpExplorer ?? defaults.defaultEnableSftpExplorer,
    enableWebBrowser: device.enableWebBrowser ?? defaults.defaultEnableWebBrowser,
    enableEmbeddedWebBrowser:
      device.enableEmbeddedWebBrowser ?? defaults.defaultEnableEmbeddedWebBrowser,
    webBrowserUrl: device.webBrowserUrl?.trim() || undefined,
    sftpPresetsRemote: sanitizeSftpPresets(device.sftpPresetsRemote),
    sftpPresetsLocal: sanitizeSftpPresets(device.sftpPresetsLocal),
    showDefaultSshCommands,
    sshCommands,
  };
}

export function sanitizeSftpPresets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
    .slice(0, sftpPresetLimit);
}

export function mergeSftpPresets(current: unknown, legacy: unknown): string[] {
  const merged = [...sanitizeSftpPresets(current)];

  for (const entry of sanitizeSftpPresets(legacy)) {
    if (merged.includes(entry)) {
      continue;
    }
    merged.push(entry);
    if (merged.length >= sftpPresetLimit) {
      break;
    }
  }

  return merged;
}

export function getEmbeddedLoggerDeviceConfigurationScopes(): EmbeddedLoggerDeviceConfigurationScope[] {
  return getConfiguredDeviceScopes();
}

export function getEmbeddedLoggerGroups(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('embeddedLogger')
): EmbeddedDeviceGroup[] {
  return normalizeEmbeddedLoggerGroups(config.get<EmbeddedDeviceGroup[]>('groups', []));
}

export async function updateEmbeddedLoggerDeviceConfiguration(
  deviceId: string,
  updateDevice: (device: EmbeddedDevice) => EmbeddedDevice
): Promise<EmbeddedDevice | undefined> {
  const normalizedId = deviceId.trim();
  if (!normalizedId) {
    return undefined;
  }

  for (const scope of getConfiguredDeviceScopes()) {
    let updatedDevice: EmbeddedDevice | undefined;
    let found = false;

    const updatedDevices = scope.devices.map((device) => {
      if (getDeviceId(device) !== normalizedId) {
        return device;
      }

      found = true;
      updatedDevice = updateDevice(device);
      return updatedDevice;
    });

    if (!found) {
      continue;
    }

    await scope.config.update('devices', updatedDevices, scope.target);
    return updatedDevice;
  }

  return undefined;
}

/**
 * Returns the full Embedded Logger configuration with defaults applied.
 *
 * @returns The resolved devices list and tab line limit.
 */
export function getEmbeddedLoggerConfiguration(): {
  devices: EmbeddedDevice[];
  maxLinesPerTab: number;
  enableDevicePing: boolean;
  devicePingIntervalSeconds?: number;
} {
  const config = vscode.workspace.getConfiguration('embeddedLogger');
  const defaults = getLoggerDefaults(config);
  const devices = ensureUniqueDeviceIds(config.get<EmbeddedDevice[]>('devices', []));
  const resolvedDevices = devices.map((device) => applyDeviceDefaults(device, defaults));
  const maxLinesPerTab = Math.max(1, config.get<number>('maxLinesPerTab', 100000) || 100000);
  const enableDevicePing = config.get<boolean>('enableDevicePing', true) ?? true;
  const devicePingIntervalSeconds = normalizeDevicePingIntervalSeconds(
    config.get<number | null>('devicePingIntervalSeconds', null)
  );

  return { devices: resolvedDevices, maxLinesPerTab, enableDevicePing, devicePingIntervalSeconds };
}
