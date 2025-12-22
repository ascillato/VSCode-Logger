/**
 * Helpers for reading Embedded Device Logger configuration with defaults.
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import { EmbeddedDevice } from './deviceTree';

interface LoggerDefaults {
    defaultPort: number;
    defaultLogCommand: string;
    defaultEnableSshTerminal: boolean;
    defaultEnableSftpExplorer: boolean;
    defaultEnableWebBrowser: boolean;
    defaultSshCommands: { name: string; command: string }[];
}

/**
 * Reads the default logger settings from workspace configuration.
 *
 * @param config The Embedded Logger workspace configuration.
 * @returns The normalized default settings.
 */
function getLoggerDefaults(config: vscode.WorkspaceConfiguration): LoggerDefaults {
    const defaultPort = config.get<number>('defaultPort', 22) || 22;
    const defaultLogCommand = config.get<string>('defaultLogCommand', 'tail -F /var/log/syslog') || 'tail -F /var/log/syslog';
    const defaultEnableSshTerminal = config.get<boolean>('defaultEnableSshTerminal', true) ?? true;
    const defaultEnableSftpExplorer = config.get<boolean>('defaultEnableSftpExplorer', true) ?? true;
    const defaultEnableWebBrowser = config.get<boolean>('defaultEnableWebBrowser', false) ?? false;
    const defaultSshCommands = config.get<{ name: string; command: string }[]>('defaultSshCommands', []) || [];

    return {
        defaultPort,
        defaultLogCommand,
        defaultEnableSshTerminal,
        defaultEnableSftpExplorer,
        defaultEnableWebBrowser,
        defaultSshCommands: Array.isArray(defaultSshCommands)
            ? defaultSshCommands.map((command) => ({ ...command }))
            : [],
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
        webBrowserUrl: device.webBrowserUrl?.trim() || undefined,
        sshCommands:
            device.sshCommands !== undefined
                ? device.sshCommands
                : defaults.defaultSshCommands.map((command) => ({ ...command })),
    };
}

/**
 * Returns the full Embedded Logger configuration with defaults applied.
 *
 * @returns The resolved devices list and tab line limit.
 */
export function getEmbeddedLoggerConfiguration() {
    const config = vscode.workspace.getConfiguration('embeddedLogger');
    const defaults = getLoggerDefaults(config);
    const devices = config.get<EmbeddedDevice[]>('devices', []);
    const resolvedDevices = devices.map((device) => applyDeviceDefaults(device, defaults));
    const maxLinesPerTab = Math.max(1, config.get<number>('maxLinesPerTab', 100000) || 100000);

    return { devices: resolvedDevices, maxLinesPerTab };
}
