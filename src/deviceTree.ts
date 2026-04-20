/**
 * Provides the device tree view for selecting embedded targets.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import { getDeviceColorIcon } from './deviceColor';
import { getEmbeddedLoggerGroups } from './configuration';
import { formatLocalizedString, getLocalizedStrings } from './localization';

/**
 * Representation of a configured embedded device.
 */
export interface SshCommandDefinition {
  name: string;
  command?: string;
  openSshPanel?: boolean;
  rerunOnReconnection?: boolean;
  copyAndRunScript?: boolean;
  script?: string;
}

export interface EmbeddedDevice {
  id: string;
  group?: string;
  name: string;
  host: string;
  color?: string;
  hostFingerprint?: string;
  secondaryHost?: string;
  secondaryHostFingerprint?: string;
  bastion?: BastionConfig;
  port?: number;
  username: string;
  password?: string; // write only
  privateKeyPath?: string;
  privateKeyPassphrase?: string; // write only
  logCommand?: string;
  enableSshTerminal?: boolean;
  enableSftpExplorer?: boolean;
  enableWebBrowser?: boolean;
  enableEmbeddedWebBrowser?: boolean;
  webBrowserUrl?: string;
  sftpPresetsRemote?: string[];
  sftpPresetsLocal?: string[];
  showDefaultSshCommands?: boolean;
  sshCommands?: SshCommandDefinition[];
}

export interface EmbeddedDeviceGroup {
  name: string;
}

export interface BastionConfig {
  host: string;
  hostFingerprint?: string;
  port?: number;
  username: string;
  password?: string; // write only
  privateKeyPath?: string;
  privateKeyPassphrase?: string; // write only
}

/**
 * Tree provider that lists configured devices.
 *
 * Users configure the array in `embeddedLogger.devices` in settings.json and
 * each entry is presented as a selectable item that opens a log panel.
 */
export class DeviceTreeDataProvider implements vscode.TreeDataProvider<DeviceTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DeviceTreeItem | undefined | void> =
    new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<DeviceTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  /**
   * Creates a new provider bound to the extension context.
   *
   * @param context VS Code extension context for storing provider state.
   */
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Signals VS Code to refresh the tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Returns the tree item used for rendering.
   *
   * @param element Device tree item to render.
   * @returns The same tree item instance.
   */
  getTreeItem(element: DeviceTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Retrieves the list of configured devices as tree items.
   *
   * @returns A promise containing the device items or a placeholder when none exist.
   */
  getChildren(element?: DeviceTreeItem): Thenable<DeviceTreeItem[]> {
    const config = vscode.workspace.getConfiguration('embeddedLogger');
    const devices = config.get<EmbeddedDevice[]>('devices', []);
    const groups = getEmbeddedLoggerGroups(config);

    if (element instanceof GroupItem) {
      const groupedDevices = devices.filter(
        (device) => (device.group ?? '').trim() === element.groupName
      );
      return Promise.resolve(groupedDevices.map((device) => new DeviceItem(device)));
    }

    if ((!devices || devices.length === 0) && groups.length === 0) {
      const strings = getLocalizedStrings().deviceTree;
      const item = new vscode.TreeItem(strings.noDevicesConfigured);
      item.tooltip = strings.openSettingsToConfigure;
      item.command = {
        command: 'workbench.action.openSettings',
        title: strings.openSettings,
        arguments: ['embeddedLogger.devices'],
      };
      return Promise.resolve([item as unknown as DeviceTreeItem]);
    }

    const groupedItems = groups.map((group) => new GroupItem(group.name));
    const ungroupedDevices = devices.filter((device) => {
      const groupName = (device.group ?? '').trim();
      return !groupName || !groups.some((group) => group.name === groupName);
    });
    const items = [...groupedItems, ...ungroupedDevices.map((device) => new DeviceItem(device))];
    return Promise.resolve(items);
  }
}

type DeviceTreeItem = DeviceItem | GroupItem;

class DeviceItem extends vscode.TreeItem {
  /**
   * Builds a leaf tree item for a device.
   *
   * @param device Device configuration backing the item.
   */
  constructor(public readonly device: EmbeddedDevice) {
    super(device.name, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `${device.name} (${device.host})`;
    this.description = device.host;
    this.iconPath = getDeviceColorIcon(device.color);
    this.command = {
      command: 'embeddedLogger.openDevice',
      title: getLocalizedStrings().deviceTree.openDeviceLogs,
      arguments: [device],
    };
    this.contextValue = 'embeddedLoggerDevice';
  }
}

class GroupItem extends vscode.TreeItem {
  constructor(public readonly groupName: string) {
    super(groupName, vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = formatLocalizedString(getLocalizedStrings().deviceTree.groupTooltip, {
      name: groupName,
    });
    this.iconPath = new vscode.ThemeIcon('package');
    this.contextValue = 'embeddedLoggerDeviceGroup';
  }
}
