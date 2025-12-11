/**
 * @file deviceTree.ts
 * @brief Provides the device tree view for selecting embedded targets.
 * @copyright Copyright (c) 2025 A. Scillato
 */

import * as vscode from 'vscode';

/**
 * @brief Representation of a configured embedded device.
 */
export interface EmbeddedDevice {
    id: string;
    name: string;
    host: string;
    hostFingerprint?: string;
    secondaryHost?: string;
    secondaryHostFingerprint?: string;
    bastion?: BastionConfig;
    port?: number;
    username: string;
    password?: string; // legacy
    privateKeyPath?: string;
    privateKeyPassphrase?: string; // legacy
    logCommand?: string;
    enableSshTerminal?: boolean;
    enableSftpExplorer?: boolean;
    sshCommands?: { name: string; command: string }[];
}

export interface BastionConfig {
    host: string;
    hostFingerprint?: string;
    port?: number;
    username: string;
    password?: string; // legacy
    privateKeyPath?: string;
    privateKeyPassphrase?: string; // legacy
}

/**
 * @brief Tree provider that lists configured devices.
 *
 * Users configure the array in `embeddedLogger.devices` in settings.json and
 * each entry is presented as a selectable item that opens a log panel.
 */
export class DeviceTreeDataProvider implements vscode.TreeDataProvider<DeviceItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DeviceItem | undefined | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<DeviceItem | undefined | void> = this._onDidChangeTreeData.event;

    /**
     * @brief Creates a new provider bound to the extension context.
     * @param context VS Code extension context for storing provider state.
     */
    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * @brief Signals VS Code to refresh the tree view.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * @brief Returns the tree item used for rendering.
     * @param element Device tree item to render.
     * @returns The same tree item instance.
     */
    getTreeItem(element: DeviceItem): vscode.TreeItem {
        return element;
    }

    /**
     * @brief Retrieves the list of configured devices as tree items.
     * @returns A promise containing the device items or a placeholder when none exist.
     */
    getChildren(): Thenable<DeviceItem[]> {
        const config = vscode.workspace.getConfiguration('embeddedLogger');
        const devices = config.get<EmbeddedDevice[]>('devices', []);

        if (!devices || devices.length === 0) {
            const item = new vscode.TreeItem('No devices configured. Update "embeddedLogger.devices" in settings.');
            item.tooltip = 'Open settings to configure embedded devices.';
            item.command = {
                command: 'workbench.action.openSettings',
                title: 'Open Settings',
                arguments: ['embeddedLogger.devices'],
            };
            return Promise.resolve([item as unknown as DeviceItem]);
        }

        const items = devices.map((device) => new DeviceItem(device));
        return Promise.resolve(items);
    }
}

class DeviceItem extends vscode.TreeItem {
    /**
     * @brief Builds a leaf tree item for a device.
     * @param device Device configuration backing the item.
     */
    constructor(public readonly device: EmbeddedDevice) {
        super(device.name, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${device.name} (${device.host})`;
        this.description = device.host;
        this.command = {
            command: 'embeddedLogger.openDevice',
            title: 'Open Device Logs',
            arguments: [device],
        };
        this.contextValue = 'embeddedLoggerDevice';
    }
}
