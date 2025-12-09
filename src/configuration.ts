/**
 * @file configuration.ts
 * @brief Helpers for reading Embedded Device Logger configuration with defaults.
 */

import * as vscode from 'vscode';
import { EmbeddedDevice } from './deviceTree';

interface LoggerDefaults {
    defaultPort: number;
    defaultLogCommand: string;
    defaultEnableSshTerminal: boolean;
    defaultEnableSftpExplorer: boolean;
    defaultSshCommands: { name: string; command: string }[];
}

function getLoggerDefaults(config: vscode.WorkspaceConfiguration): LoggerDefaults {
    const defaultPort = config.get<number>('defaultPort', 22) || 22;
    const defaultLogCommand = config.get<string>('defaultLogCommand', 'tail -F /var/log/syslog') || 'tail -F /var/log/syslog';
    const defaultEnableSshTerminal = config.get<boolean>('defaultEnableSshTerminal', false) || false;
    const defaultEnableSftpExplorer = config.get<boolean>('defaultEnableSftpExplorer', false) || false;
    const defaultSshCommands = config.get<{ name: string; command: string }[]>('defaultSshCommands', []) || [];

    return {
        defaultPort,
        defaultLogCommand,
        defaultEnableSshTerminal,
        defaultEnableSftpExplorer,
        defaultSshCommands: Array.isArray(defaultSshCommands)
            ? defaultSshCommands.map((command) => ({ ...command }))
            : [],
    };
}

function applyDeviceDefaults(device: EmbeddedDevice, defaults: LoggerDefaults): EmbeddedDevice {
    return {
        ...device,
        port: device.port ?? defaults.defaultPort,
        logCommand: device.logCommand ?? defaults.defaultLogCommand,
        enableSshTerminal: device.enableSshTerminal ?? defaults.defaultEnableSshTerminal,
        enableSftpExplorer: device.enableSftpExplorer ?? defaults.defaultEnableSftpExplorer,
        sshCommands:
            device.sshCommands !== undefined
                ? device.sshCommands
                : defaults.defaultSshCommands.map((command) => ({ ...command })),
    };
}

export function getEmbeddedLoggerConfiguration() {
    const config = vscode.workspace.getConfiguration('embeddedLogger');
    const defaults = getLoggerDefaults(config);
    const devices = config.get<EmbeddedDevice[]>('devices', []);
    const resolvedDevices = devices.map((device) => applyDeviceDefaults(device, defaults));
    const maxLinesPerTab = Math.max(1, config.get<number>('maxLinesPerTab', 100000) || 100000);

    return { devices: resolvedDevices, maxLinesPerTab };
}
