import * as vscode from 'vscode';

export interface EmbeddedDevice {
    id: string;
    name: string;
    host: string;
    port?: number;
    username: string;
    password?: string; // legacy
    logCommand?: string;
}

/**
 * Tree provider that lists configured devices. Users configure the array in
 * `embeddedLogger.devices` in settings.json.
 */
export class DeviceTreeDataProvider implements vscode.TreeDataProvider<DeviceItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DeviceItem | undefined | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<DeviceItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DeviceItem): vscode.TreeItem {
        return element;
    }

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
            return Promise.resolve([item]);
        }

        const items = devices.map((device) => new DeviceItem(device));
        return Promise.resolve(items);
    }
}

class DeviceItem extends vscode.TreeItem {
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
