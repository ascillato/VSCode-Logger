/**
 * Webview panel that lets users manage embedded devices and defaults in a table-style UI.
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import type { EmbeddedDevice, SshCommandDefinition } from './deviceTree';
import { sanitizeSftpPresets } from './configuration';
import { normalizeStoredCommand, normalizeStoredScript } from './sshCommandExecution';

const defaultLogCommandValue = 'tail -F /var/log/syslog';
const importedSettingsKeys = [
  'embeddedLogger.defaultPort',
  'embeddedLogger.defaultLogCommand',
  'embeddedLogger.defaultEnableSshTerminal',
  'embeddedLogger.defaultEnableSftpExplorer',
  'embeddedLogger.defaultEnableWebBrowser',
  'embeddedLogger.defaultEnableEmbeddedWebBrowser',
  'embeddedLogger.defaultSshCommands',
  'embeddedLogger.maxLinesPerTab',
  'embeddedLogger.devices',
] as const;

type IncomingMessage =
  | { type: 'requestState' }
  | { type: 'save'; defaults: DefaultsPayload; groups: GroupPayload[]; devices: DevicePayload[] }
  | { type: 'editJson' }
  | { type: 'clearPasswords' }
  | { type: 'clearDevicePassword'; deviceId: string }
  | {
      type: 'exportSettings';
      defaults: DefaultsPayload;
      groups: GroupPayload[];
      devices: DevicePayload[];
    }
  | { type: 'importSettings' };

interface GroupPayload {
  name: string;
}

interface DefaultsPayload {
  defaultPort: number;
  defaultLogCommand: string;
  defaultEnableSshTerminal: boolean;
  defaultEnableSftpExplorer: boolean;
  defaultEnableWebBrowser: boolean;
  defaultEnableEmbeddedWebBrowser: boolean;
  defaultSshCommands: SshCommandDefinition[];
  maxLinesPerTab: number;
}

type TriStateSelection = 'default' | 'enabled' | 'disabled';

interface DevicePayload {
  id: string;
  group?: string;
  color?: string;
  name: string;
  host: string;
  hostFingerprint?: string;
  secondaryHost?: string;
  secondaryHostFingerprint?: string;
  port?: number | string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  logCommand?: string;
  enableSshTerminal?: boolean | TriStateSelection;
  enableSftpExplorer?: boolean | TriStateSelection;
  enableWebBrowser?: boolean | TriStateSelection;
  enableEmbeddedWebBrowser?: boolean | TriStateSelection;
  webBrowserUrl?: string;
  showDefaultSshCommands?: boolean;
  sshCommands?: SshCommandDefinition[];
  bastionHost?: string;
  bastionHostFingerprint?: string;
  bastionPort?: number | string;
  bastionUsername?: string;
  bastionPassword?: string;
  bastionPrivateKeyPath?: string;
  bastionPrivateKeyPassphrase?: string;
  sftpPresetsRemote?: string;
  sftpPresetsLocal?: string;
}

type ImportedSettingsKey = (typeof importedSettingsKeys)[number];

interface ExportedSettingsPayload {
  'embeddedLogger.defaultPort': number;
  'embeddedLogger.defaultLogCommand': string;
  'embeddedLogger.defaultEnableSshTerminal': boolean;
  'embeddedLogger.defaultEnableSftpExplorer': boolean;
  'embeddedLogger.defaultEnableWebBrowser': boolean;
  'embeddedLogger.defaultEnableEmbeddedWebBrowser': boolean;
  'embeddedLogger.defaultSshCommands': SshCommandDefinition[];
  'embeddedLogger.maxLinesPerTab': number;
  'embeddedLogger.groups': GroupPayload[];
  'embeddedLogger.devices': EmbeddedDevice[];
}

interface ImportedSettingsState {
  defaults: DefaultsPayload;
  groups: GroupPayload[];
  devices: EmbeddedDevice[];
}

export class DeviceManagerPanel {
  private static currentPanel: DeviceManagerPanel | undefined;
  private static readonly viewType = 'embeddedLogger.deviceManager';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sftpPresetLimit = 10;

  private constructor(
    private readonly extensionUri: vscode.Uri,
    panel: vscode.WebviewPanel
  ) {
    this.panel = panel;
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'resources', 'terminal.svg');
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: IncomingMessage) => {
        switch (message.type) {
          case 'requestState':
            this.postInitialState();
            break;
          case 'save':
            void this.saveConfiguration(message.defaults, message.groups, message.devices);
            break;
          case 'editJson':
            void vscode.commands.executeCommand('workbench.action.openSettingsJson');
            break;
          case 'clearPasswords':
            void vscode.commands.executeCommand('embeddedLogger.clearStoredPasswords');
            break;
          case 'clearDevicePassword':
            void vscode.commands.executeCommand(
              'embeddedLogger.clearStoredPasswords',
              message.deviceId
            );
            break;
          case 'exportSettings':
            void this.exportSettings(message.defaults, message.groups, message.devices);
            break;
          case 'importSettings':
            void this.importSettings();
            break;
          default:
            break;
        }
      },
      null,
      this.disposables
    );

    this.panel.webview.html = this.buildHtml(this.panel.webview);
  }

  static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (DeviceManagerPanel.currentPanel) {
      DeviceManagerPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DeviceManagerPanel.viewType,
      'Embedded Devices Manager',
      column ?? vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'resources'),
        ],
      }
    );

    DeviceManagerPanel.currentPanel = new DeviceManagerPanel(extensionUri, panel);
  }

  dispose(): void {
    DeviceManagerPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const item = this.disposables.pop();
      item?.dispose();
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'deviceManager.js'))
      .toString();
    const stylesUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'deviceManager.css'))
      .toString();
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${stylesUri}" />
    <title>Embedded Devices Manager</title>
  </head>
  <body>
    <main class="container">
      <header class="header">
        <div>
          <h1>Embedded Device Logger</h1>
          <p>Manage devices and default configuration.</p>
        </div>
        <div class="header-actions">
          <button class="button button-danger" id="clearPasswords">Remove Stored Passwords</button>
          <button
            class="button button-icon button-emoji"
            id="importSettings"
            title="Import Settings"
            aria-label="Import Settings"
          >
            📥
          </button>
          <button
            class="button button-icon button-emoji"
            id="exportSettings"
            title="Export Settings"
            aria-label="Export Settings"
          >
            📤
          </button>
          <button class="button" id="editJson">Edit in JSON</button>
          <button class="button button-icon" id="helpButton" title="View configuration example">?</button>
          <button class="button button-primary" id="saveChanges">Save changes</button>
        </div>
      </header>

      <div id="status" aria-live="polite"></div>

      <section class="card">
        <div class="card-header">
          <div class="card-header-text">
            <h2>Defaults</h2>
            <p>Default values for all devices. Each device can change it in devices table if desired.</p>
          </div>
        </div>
        <div class="divider" aria-hidden="true"></div>
        <div class="grid grid-3">
          <label class="field checkbox">
            <input type="checkbox" id="defaultEnableSshTerminal" />
            <span>Enable SSH terminal</span>
          </label>
          <label class="field checkbox">
            <input type="checkbox" id="defaultEnableSftpExplorer" />
            <span>Enable SFTP explorer</span>
          </label>
          <label class="field checkbox">
            <input type="checkbox" id="defaultEnableWebBrowser" />
            <span>Enable external web browser</span>
          </label>
          <label class="field checkbox">
            <input type="checkbox" id="defaultEnableEmbeddedWebBrowser" />
            <span>Enable embedded web browser</span>
          </label>
        </div>
        <div class="divider" aria-hidden="true"></div>
        <div class="grid grid-3">
          <label class="field">
            <span>Port</span>
            <input type="number" id="defaultPort" min="1" />
          </label>
          <label class="field">
            <span>Log command</span>
            <input type="text" id="defaultLogCommand" />
          </label>
          <label class="field">
            <span>Max lines per tab</span>
            <input type="number" id="maxLinesPerTab" min="1" />
          </label>
        </div>
        <div class="divider" aria-hidden="true"></div>
        <div class="field">
          <span>SSH commands</span>
          <div id="defaultSshCommands"></div>
        </div>
      </section>

      <br>

      <section class="card">
        <div class="card-header">
          <div class="card-header-text">
            <h2>Groups</h2>
            <p>Define optional groups to organize devices in the Embedded Devices view.</p>
          </div>
          <div class="card-header-actions">
            <button class="button" id="addGroup">Add group</button>
            <button class="button button-icon" id="moveSelectedGroupsUp" disabled>&uarr;</button>
            <button class="button button-icon" id="moveSelectedGroupsDown" disabled>&darr;</button>
            <button class="button button-danger" id="removeSelectedGroups" disabled>Remove</button>
          </div>
        </div>
        <div class="table-wrapper table-wrapper--groups">
          <table id="groupsTable">
            <thead>
              <tr>
                <th>Select</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody id="groupsBody"></tbody>
          </table>
        </div>
      </section>

      <br>

      <section class="card">
        <div class="card-header">
          <div class="card-header-text">
            <h2>Devices</h2>
            <p>Add or remove rows, then edit fields inline.</p>
          </div>
          <div class="card-header-actions">
            <button class="button" id="addDevice">Add device</button>
            <button
              class="button button-icon"
              id="moveSelectedUp"
              title="Move selected devices up in the list"
              aria-label="Move selected devices up"
              disabled
            >
              &uarr;
            </button>
            <button
              class="button button-icon"
              id="moveSelectedDown"
              title="Move selected devices down in the list"
              aria-label="Move selected devices down"
              disabled
            >
              &darr;
            </button>
            <button
              class="button"
              id="clearSelectedPasswords"
              title="Remove stored passwords and passphrases for selected devices"
              disabled
            >
              Reset password
            </button>
            <button class="button button-danger" id="removeSelectedDevices" disabled>Remove</button>
          </div>
        </div>
        <div class="table-wrapper">
          <table id="devicesTable">
            <colgroup id="devicesColGroup"></colgroup>
            <thead>
              <tr>
                <th>Select</th>
                <th>ID</th>
                <th>Group</th>
                <th>Color</th>
                <th>Name</th>
                <th>Host</th>
                <th>Port</th>
                <th>User</th>
                <th>Log command</th>
                <th>Host fingerprint</th>
                <th>Secondary host</th>
                <th>Secondary fingerprint</th>
                <th>SSH terminal</th>
                <th>SFTP</th>
                <th>SFTP presets (remote)</th>
                <th>SFTP presets (local)</th>
                <th>External Web Browser</th>
                <th>Embedded Web Browser</th>
                <th>Web URL</th>
                <th>Private key path</th>
                <th>Private key passphrase</th>
                <th>Password (write only)</th>
                <th>Show default SSH cmnds</th>
                <th>SSH commands</th>
                <th>Bastion host</th>
                <th>Bastion port</th>
                <th>Bastion user</th>
                <th>Bastion fingerprint</th>
                <th>Bastion key path</th>
                <th>Bastion key passphrase</th>
                <th>Bastion password (write only)</th>
              </tr>
            </thead>
            <tbody id="devicesBody"></tbody>
          </table>
        </div>
      </section>
    </main>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private postInitialState(): void {
    const config = vscode.workspace.getConfiguration('embeddedLogger');
    const devices = config.get<EmbeddedDevice[]>('devices', []);
    const groups = this.getGroupsFromConfiguration(config);
    const defaults = this.getDefaultsFromConfiguration(config);
    this.panel.webview.postMessage({
      type: 'init',
      ...this.buildWebviewState(defaults, groups, devices),
    });
  }

  private async saveConfiguration(
    defaults: DefaultsPayload,
    groups: GroupPayload[],
    devices: DevicePayload[]
  ): Promise<void> {
    try {
      const { config, target } = this.getUpdateConfiguration();

      const normalizedDefaults = this.normalizeDefaults(defaults);
      const normalizedGroups = this.normalizeGroups(groups);
      const normalizedDevices = devices.map((device) => this.normalizeDevice(device));
      let saveMessage = 'Saved settings.';

      const updates: Array<{
        run: () => Thenable<void>;
        tolerateUnregistered?: string;
      }> = [
        {
          run: () => config.update('defaultPort', normalizedDefaults.defaultPort, target),
        },
        {
          run: () =>
            config.update('defaultLogCommand', normalizedDefaults.defaultLogCommand, target),
        },
        {
          run: () =>
            config.update(
              'defaultEnableSshTerminal',
              normalizedDefaults.defaultEnableSshTerminal,
              target
            ),
        },
        {
          run: () =>
            config.update(
              'defaultEnableSftpExplorer',
              normalizedDefaults.defaultEnableSftpExplorer,
              target
            ),
        },
        {
          run: () =>
            config.update(
              'defaultEnableWebBrowser',
              normalizedDefaults.defaultEnableWebBrowser,
              target
            ),
        },
        {
          run: () =>
            config.update(
              'defaultEnableEmbeddedWebBrowser',
              normalizedDefaults.defaultEnableEmbeddedWebBrowser,
              target
            ),
          tolerateUnregistered: 'embeddedLogger.defaultEnableEmbeddedWebBrowser',
        },
        {
          run: () =>
            config.update('defaultSshCommands', normalizedDefaults.defaultSshCommands, target),
        },
        {
          run: () => config.update('maxLinesPerTab', normalizedDefaults.maxLinesPerTab, target),
        },
        {
          run: () => config.update('groups', normalizedGroups, target),
        },
        {
          run: () => config.update('devices', normalizedDevices, target),
        },
      ];

      for (const update of updates) {
        try {
          await update.run();
        } catch (error: unknown) {
          if (
            update.tolerateUnregistered &&
            this.isUnregisteredConfigurationError(error, update.tolerateUnregistered)
          ) {
            saveMessage =
              'Saved settings. Reload the window or extension host, then save again to persist the Embedded Web Browser default.';
            continue;
          }

          throw error;
        }
      }

      this.panel.webview.postMessage({
        type: 'saveResult',
        success: true,
        message: saveMessage,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.panel.webview.postMessage({ type: 'saveResult', success: false, message });
    }
  }

  private async exportSettings(
    defaults: DefaultsPayload,
    groups: GroupPayload[],
    devices: DevicePayload[]
  ): Promise<void> {
    try {
      const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri
        ? vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders[0].uri,
            'embedded-device-logger-settings.json'
          )
        : undefined;
      const exportUri = await vscode.window.showSaveDialog({
        saveLabel: 'Export settings',
        filters: { JSON: ['json'], All: ['*'] },
        defaultUri,
      });

      if (!exportUri) {
        this.panel.webview.postMessage({
          type: 'operationResult',
          message: 'Export canceled.',
          variant: 'info',
        });
        return;
      }

      const payload = this.buildExportPayload(defaults, groups, devices);
      const content = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');

      await vscode.workspace.fs.writeFile(exportUri, content);
      this.panel.webview.postMessage({
        type: 'operationResult',
        message: `Exported settings to ${exportUri.fsPath}.`,
        variant: 'success',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.panel.webview.postMessage({
        type: 'operationResult',
        message: `Failed to export settings: ${message}`,
        variant: 'error',
      });
    }
  }

  private async importSettings(): Promise<void> {
    try {
      const selection = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { JSON: ['json'], All: ['*'] },
        openLabel: 'Import settings',
      });

      if (!selection?.length) {
        this.panel.webview.postMessage({
          type: 'operationResult',
          message: 'Import canceled.',
          variant: 'info',
        });
        return;
      }

      const importUri = selection[0];
      const content = await vscode.workspace.fs.readFile(importUri);
      const parsed = JSON.parse(Buffer.from(content).toString('utf8')) as unknown;
      const imported = this.validateImportedSettings(parsed);

      this.panel.webview.postMessage({
        type: 'importResult',
        success: true,
        message: `Imported settings from ${importUri.fsPath}. Review and click Save changes to apply them.`,
        ...this.buildWebviewState(imported.defaults, imported.groups, imported.devices),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.panel.webview.postMessage({
        type: 'importResult',
        success: false,
        message: `Failed to import settings: ${message}`,
      });
    }
  }

  private isUnregisteredConfigurationError(error: unknown, settingKey: string): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(`${settingKey} is not a registered configuration`);
  }

  private getUpdateConfiguration(): {
    config: vscode.WorkspaceConfiguration;
    target: vscode.ConfigurationTarget;
  } {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const settingsToInspect = [
      'defaultPort',
      'defaultLogCommand',
      'defaultEnableSshTerminal',
      'defaultEnableSftpExplorer',
      'defaultEnableWebBrowser',
      'defaultEnableEmbeddedWebBrowser',
      'defaultSshCommands',
      'maxLinesPerTab',
      'groups',
      'devices',
    ] as const;

    for (const folder of workspaceFolders) {
      const folderConfig = vscode.workspace.getConfiguration('embeddedLogger', folder.uri);
      const hasFolderScopedSetting = settingsToInspect.some((setting) => {
        const inspection = folderConfig.inspect<unknown>(setting);
        return inspection?.workspaceFolderValue !== undefined;
      });

      if (hasFolderScopedSetting) {
        return { config: folderConfig, target: vscode.ConfigurationTarget.WorkspaceFolder };
      }
    }

    const workspaceConfig = vscode.workspace.getConfiguration('embeddedLogger');
    const workspaceHasSetting = settingsToInspect.some((setting) => {
      const inspection = workspaceConfig.inspect<unknown>(setting);
      return inspection?.workspaceValue !== undefined;
    });

    if (workspaceHasSetting) {
      return { config: workspaceConfig, target: vscode.ConfigurationTarget.Workspace };
    }

    const globalHasSetting = settingsToInspect.some((setting) => {
      const inspection = workspaceConfig.inspect<unknown>(setting);
      return inspection?.globalValue !== undefined;
    });

    if (globalHasSetting) {
      return { config: workspaceConfig, target: vscode.ConfigurationTarget.Global };
    }

    if (workspaceFolders.length > 0 || vscode.workspace.workspaceFile) {
      return { config: workspaceConfig, target: vscode.ConfigurationTarget.Workspace };
    }

    return { config: workspaceConfig, target: vscode.ConfigurationTarget.Global };
  }

  private normalizeDefaults(defaults: DefaultsPayload): {
    defaultPort: number;
    defaultLogCommand: string;
    defaultEnableSshTerminal: boolean;
    defaultEnableSftpExplorer: boolean;
    defaultEnableWebBrowser: boolean;
    defaultEnableEmbeddedWebBrowser: boolean;
    defaultSshCommands: SshCommandDefinition[];
    maxLinesPerTab: number;
  } {
    const defaultPort = this.toNumberOrDefault(defaults.defaultPort, 22);
    const maxLinesPerTab = this.toNumberOrDefault(defaults.maxLinesPerTab, 100000);
    const defaultLogCommand = (defaults.defaultLogCommand ?? '').trim() || defaultLogCommandValue;
    const defaultEnableSshTerminal = Boolean(defaults.defaultEnableSshTerminal);
    const defaultEnableSftpExplorer = Boolean(defaults.defaultEnableSftpExplorer);
    const defaultEnableWebBrowser = Boolean(defaults.defaultEnableWebBrowser);
    const defaultEnableEmbeddedWebBrowser = Boolean(defaults.defaultEnableEmbeddedWebBrowser);
    const defaultSshCommands = this.normalizeSshCommands(defaults.defaultSshCommands);

    return {
      defaultPort,
      defaultLogCommand,
      defaultEnableSshTerminal,
      defaultEnableSftpExplorer,
      defaultEnableWebBrowser,
      defaultEnableEmbeddedWebBrowser,
      defaultSshCommands,
      maxLinesPerTab,
    };
  }

  private getDefaultsFromConfiguration(config: vscode.WorkspaceConfiguration): DefaultsPayload {
    return {
      defaultPort: config.get<number>('defaultPort', 22) ?? 22,
      defaultLogCommand:
        config.get<string>('defaultLogCommand', defaultLogCommandValue) ?? defaultLogCommandValue,
      defaultEnableSshTerminal: config.get<boolean>('defaultEnableSshTerminal', true) ?? true,
      defaultEnableSftpExplorer: config.get<boolean>('defaultEnableSftpExplorer', true) ?? true,
      defaultEnableWebBrowser: config.get<boolean>('defaultEnableWebBrowser', false) ?? false,
      defaultEnableEmbeddedWebBrowser:
        config.get<boolean>('defaultEnableEmbeddedWebBrowser', false) ?? false,
      defaultSshCommands: config.get<SshCommandDefinition[]>('defaultSshCommands', []) ?? [],
      maxLinesPerTab: config.get<number>('maxLinesPerTab', 100000) ?? 100000,
    };
  }

  private buildWebviewState(
    defaults: DefaultsPayload,
    groups: GroupPayload[],
    devices: EmbeddedDevice[]
  ): ImportedSettingsState {
    return {
      defaults,
      groups,
      devices: devices.map((device) => ({
        ...device,
        sftpPresetsRemote: sanitizeSftpPresets(device.sftpPresetsRemote),
        sftpPresetsLocal: sanitizeSftpPresets(device.sftpPresetsLocal),
      })),
    };
  }

  private buildExportPayload(
    defaults: DefaultsPayload,
    groups: GroupPayload[],
    devices: DevicePayload[]
  ): ExportedSettingsPayload {
    const normalizedDefaults = this.normalizeDefaults(defaults);
    const normalizedGroups = this.normalizeGroups(groups);
    const normalizedDevices = devices.map((device) => this.normalizeDevice(device));

    return {
      'embeddedLogger.defaultPort': normalizedDefaults.defaultPort,
      'embeddedLogger.defaultLogCommand': normalizedDefaults.defaultLogCommand,
      'embeddedLogger.defaultEnableSshTerminal': normalizedDefaults.defaultEnableSshTerminal,
      'embeddedLogger.defaultEnableSftpExplorer': normalizedDefaults.defaultEnableSftpExplorer,
      'embeddedLogger.defaultEnableWebBrowser': normalizedDefaults.defaultEnableWebBrowser,
      'embeddedLogger.defaultEnableEmbeddedWebBrowser':
        normalizedDefaults.defaultEnableEmbeddedWebBrowser,
      'embeddedLogger.defaultSshCommands': normalizedDefaults.defaultSshCommands,
      'embeddedLogger.maxLinesPerTab': normalizedDefaults.maxLinesPerTab,
      'embeddedLogger.groups': normalizedGroups,
      'embeddedLogger.devices': normalizedDevices,
    };
  }

  private validateImportedSettings(raw: unknown): ImportedSettingsState {
    const data = this.asRecord(raw, 'The imported settings file must contain a JSON object.');
    const missingKeys = importedSettingsKeys.filter((key) => !(key in data));

    if (missingKeys.length > 0) {
      throw new Error(`Imported settings are missing required key(s): ${missingKeys.join(', ')}.`);
    }

    const defaults = this.normalizeDefaults({
      defaultPort: this.readRequiredPositiveNumber(data, 'embeddedLogger.defaultPort'),
      defaultLogCommand: this.requireStringValue(
        data['embeddedLogger.defaultLogCommand'],
        'embeddedLogger.defaultLogCommand'
      ),
      defaultEnableSshTerminal: this.readRequiredBoolean(
        data,
        'embeddedLogger.defaultEnableSshTerminal'
      ),
      defaultEnableSftpExplorer: this.readRequiredBoolean(
        data,
        'embeddedLogger.defaultEnableSftpExplorer'
      ),
      defaultEnableWebBrowser: this.readRequiredBoolean(
        data,
        'embeddedLogger.defaultEnableWebBrowser'
      ),
      defaultEnableEmbeddedWebBrowser: this.readRequiredBoolean(
        data,
        'embeddedLogger.defaultEnableEmbeddedWebBrowser'
      ),
      defaultSshCommands: this.validateSshCommands(
        data['embeddedLogger.defaultSshCommands'],
        'embeddedLogger.defaultSshCommands'
      ),
      maxLinesPerTab: this.readRequiredPositiveNumber(data, 'embeddedLogger.maxLinesPerTab'),
    });

    const rawDevices = data['embeddedLogger.devices'];
    if (!Array.isArray(rawDevices)) {
      throw new Error('embeddedLogger.devices must be an array.');
    }

    return {
      defaults,
      groups:
        data['embeddedLogger.groups'] === undefined
          ? []
          : this.validateGroups(data['embeddedLogger.groups'], 'embeddedLogger.groups'),
      devices: rawDevices.map((device, index) => this.validateImportedDevice(device, index)),
    };
  }

  private normalizeDevice(device: DevicePayload): EmbeddedDevice {
    const sshCommands = this.normalizeSshCommands(device.sshCommands);
    const bastion = this.buildBastion(device);
    const enableSshTerminal = this.toOptionalTriState(device.enableSshTerminal);
    const enableSftpExplorer = this.toOptionalTriState(device.enableSftpExplorer);
    const enableWebBrowser = this.toOptionalTriState(device.enableWebBrowser);
    const enableEmbeddedWebBrowser = this.toOptionalTriState(device.enableEmbeddedWebBrowser);
    const showDefaultSshCommands = device.showDefaultSshCommands ?? true;

    const normalized: EmbeddedDevice = {
      id: (device.id ?? '').trim(),
      group: device.group?.trim() || undefined,
      color: device.color?.trim() || undefined,
      name: (device.name ?? '').trim(),
      host: (device.host ?? '').trim(),
      hostFingerprint: device.hostFingerprint?.trim() || undefined,
      secondaryHost: device.secondaryHost?.trim() || undefined,
      secondaryHostFingerprint: device.secondaryHostFingerprint?.trim() || undefined,
      port: this.toOptionalNumber(device.port),
      username: (device.username ?? '').trim(),
      password: device.password?.trim() || undefined,
      privateKeyPath: device.privateKeyPath?.trim() || undefined,
      privateKeyPassphrase: device.privateKeyPassphrase?.trim() || undefined,
      logCommand: device.logCommand?.trim() || undefined,
      webBrowserUrl: device.webBrowserUrl?.trim() || undefined,
      bastion,
    };

    const sftpPresetsRemote = this.parsePresetText(device.sftpPresetsRemote);
    const sftpPresetsLocal = this.parsePresetText(device.sftpPresetsLocal);

    if (enableSshTerminal !== undefined) {
      normalized.enableSshTerminal = enableSshTerminal;
    }

    if (enableSftpExplorer !== undefined) {
      normalized.enableSftpExplorer = enableSftpExplorer;
    }

    if (enableWebBrowser !== undefined) {
      normalized.enableWebBrowser = enableWebBrowser;
    }

    if (enableEmbeddedWebBrowser !== undefined) {
      normalized.enableEmbeddedWebBrowser = enableEmbeddedWebBrowser;
    }

    if (!showDefaultSshCommands) {
      normalized.showDefaultSshCommands = false;
    }

    if (sshCommands.length > 0) {
      normalized.sshCommands = sshCommands;
    }

    if (sftpPresetsRemote.length > 0) {
      normalized.sftpPresetsRemote = sftpPresetsRemote;
    }

    if (sftpPresetsLocal.length > 0) {
      normalized.sftpPresetsLocal = sftpPresetsLocal;
    }

    return normalized;
  }

  private validateImportedDevice(value: unknown, index: number): EmbeddedDevice {
    const keyPrefix = `embeddedLogger.devices[${index}]`;
    const device = this.asRecord(value, `${keyPrefix} must be an object.`);
    const sshCommands = this.validateOptionalSshCommands(
      device.sshCommands,
      `${keyPrefix}.sshCommands`
    );
    const bastion = this.validateOptionalBastion(device.bastion, `${keyPrefix}.bastion`);
    const sftpPresetsRemote = this.validateOptionalPresetArray(
      device.sftpPresetsRemote,
      `${keyPrefix}.sftpPresetsRemote`
    );
    const sftpPresetsLocal = this.validateOptionalPresetArray(
      device.sftpPresetsLocal,
      `${keyPrefix}.sftpPresetsLocal`
    );

    const normalized: EmbeddedDevice = {
      id: this.readRequiredPropertyString(device, 'id', keyPrefix),
      group: this.readOptionalString(device.group, `${keyPrefix}.group`),
      color: this.readOptionalString(device.color, `${keyPrefix}.color`),
      name: this.readRequiredPropertyString(device, 'name', keyPrefix),
      host: this.readRequiredPropertyString(device, 'host', keyPrefix),
      hostFingerprint: this.readOptionalString(
        device.hostFingerprint,
        `${keyPrefix}.hostFingerprint`
      ),
      secondaryHost: this.readOptionalString(device.secondaryHost, `${keyPrefix}.secondaryHost`),
      secondaryHostFingerprint: this.readOptionalString(
        device.secondaryHostFingerprint,
        `${keyPrefix}.secondaryHostFingerprint`
      ),
      port: this.readOptionalPositiveNumber(device.port, `${keyPrefix}.port`),
      username: this.readRequiredPropertyString(device, 'username', keyPrefix),
      password: this.readOptionalString(device.password, `${keyPrefix}.password`),
      privateKeyPath: this.readOptionalString(device.privateKeyPath, `${keyPrefix}.privateKeyPath`),
      privateKeyPassphrase: this.readOptionalString(
        device.privateKeyPassphrase,
        `${keyPrefix}.privateKeyPassphrase`
      ),
      logCommand: this.readOptionalString(device.logCommand, `${keyPrefix}.logCommand`),
      enableSshTerminal: this.readOptionalBoolean(
        device.enableSshTerminal,
        `${keyPrefix}.enableSshTerminal`
      ),
      enableSftpExplorer: this.readOptionalBoolean(
        device.enableSftpExplorer,
        `${keyPrefix}.enableSftpExplorer`
      ),
      enableWebBrowser: this.readOptionalBoolean(
        device.enableWebBrowser,
        `${keyPrefix}.enableWebBrowser`
      ),
      enableEmbeddedWebBrowser: this.readOptionalBoolean(
        device.enableEmbeddedWebBrowser,
        `${keyPrefix}.enableEmbeddedWebBrowser`
      ),
      webBrowserUrl: this.readOptionalString(device.webBrowserUrl, `${keyPrefix}.webBrowserUrl`),
      showDefaultSshCommands:
        this.readOptionalBoolean(
          device.showDefaultSshCommands,
          `${keyPrefix}.showDefaultSshCommands`
        ) ?? true,
      bastion,
    };

    if (normalized.showDefaultSshCommands === true) {
      delete normalized.showDefaultSshCommands;
    }

    if (sshCommands.length > 0) {
      normalized.sshCommands = sshCommands;
    }

    if (sftpPresetsRemote.length > 0) {
      normalized.sftpPresetsRemote = sftpPresetsRemote;
    }

    if (sftpPresetsLocal.length > 0) {
      normalized.sftpPresetsLocal = sftpPresetsLocal;
    }

    return normalized;
  }

  private parsePresetText(value: string | undefined): string[] {
    if (!value) {
      return [];
    }
    const entries = value
      .split(/\r?\n/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.slice(0, this.sftpPresetLimit);
  }

  private validateOptionalPresetArray(value: unknown, key: string): string[] {
    if (value === undefined) {
      return [];
    }

    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new Error(`${key} must be an array of strings.`);
    }

    return sanitizeSftpPresets(value);
  }

  private validateOptionalBastion(value: unknown, key: string): EmbeddedDevice['bastion'] {
    if (value === undefined) {
      return undefined;
    }

    const bastion = this.asRecord(value, `${key} must be an object.`);

    return {
      host: this.readRequiredPropertyString(bastion, 'host', key),
      hostFingerprint: this.readOptionalString(bastion.hostFingerprint, `${key}.hostFingerprint`),
      port: this.readOptionalPositiveNumber(bastion.port, `${key}.port`),
      username: this.readRequiredPropertyString(bastion, 'username', key),
      password: this.readOptionalString(bastion.password, `${key}.password`),
      privateKeyPath: this.readOptionalString(bastion.privateKeyPath, `${key}.privateKeyPath`),
      privateKeyPassphrase: this.readOptionalString(
        bastion.privateKeyPassphrase,
        `${key}.privateKeyPassphrase`
      ),
    };
  }

  private validateOptionalSshCommands(value: unknown, key: string): SshCommandDefinition[] {
    if (value === undefined) {
      return [];
    }

    return this.validateSshCommands(value, key);
  }

  private validateSshCommands(value: unknown, key: string): SshCommandDefinition[] {
    if (!Array.isArray(value)) {
      throw new Error(
        `${key} must be an array of {name, command?, openSshPanel?, rerunOnReconnection?, copyAndRunScript?, script?} entries.`
      );
    }

    return value.map((entry, index) => {
      const command = this.asRecord(entry, `${key}[${index}] must be an object.`);
      const normalized: SshCommandDefinition = {
        name: this.readRequiredPropertyString(command, 'name', `${key}[${index}]`),
      };
      const commandValue = this.readOptionalString(command.command, `${key}[${index}].command`);
      const copyAndRunScript = this.readOptionalBoolean(
        command.copyAndRunScript,
        `${key}[${index}].copyAndRunScript`
      );
      const script = this.readOptionalString(command.script, `${key}[${index}].script`, true);

      if (copyAndRunScript && !script?.trim()) {
        throw new Error(`${key}[${index}].script is required when copyAndRunScript is enabled.`);
      }

      if (!commandValue && !(copyAndRunScript && script?.trim())) {
        throw new Error(
          `${key}[${index}] must define a command or enable copyAndRunScript with a script.`
        );
      }

      if (commandValue) {
        normalized.command = commandValue;
      }

      const openSshPanel = this.readOptionalBoolean(
        command.openSshPanel,
        `${key}[${index}].openSshPanel`
      );
      if (openSshPanel) {
        normalized.openSshPanel = true;
      }

      const rerunOnReconnection = this.readOptionalBoolean(
        command.rerunOnReconnection,
        `${key}[${index}].rerunOnReconnection`
      );
      if (openSshPanel && rerunOnReconnection) {
        normalized.rerunOnReconnection = true;
      }

      if (copyAndRunScript && script?.trim()) {
        normalized.copyAndRunScript = true;
      }

      if (script?.trim()) {
        normalized.script = script.replace(/\r\n/g, '\n');
      }

      return normalized;
    });
  }

  private getGroupsFromConfiguration(config: vscode.WorkspaceConfiguration): GroupPayload[] {
    return this.normalizeGroups(config.get<GroupPayload[]>('groups', []) ?? []);
  }

  private normalizeGroups(value: GroupPayload[] | undefined): GroupPayload[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((group) => ({ name: (group?.name ?? '').trim() }))
      .filter((group) => group.name.length > 0);
  }

  private validateGroups(value: unknown, key: string): GroupPayload[] {
    if (!Array.isArray(value)) {
      throw new Error(`${key} must be an array of group objects.`);
    }

    return value.map((group, index) => {
      const record = this.asRecord(group, `${key}[${index}] must be an object.`);
      return { name: this.readRequiredPropertyString(record, 'name', `${key}[${index}]`) };
    });
  }

  private asRecord(value: unknown, message: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(message);
    }

    return value as Record<string, unknown>;
  }

  private readRequiredPropertyString(
    value: Record<string, unknown>,
    key: string,
    prefix?: string
  ): string {
    return this.requireStringValue(value[key], prefix ? `${prefix}.${key}` : key);
  }

  private requireStringValue(value: unknown, key: string, allowBlank = false): string {
    if (typeof value !== 'string') {
      throw new Error(`${key} must be a string.`);
    }

    const trimmed = value.trim();
    if (!allowBlank && !trimmed) {
      throw new Error(`${key} is required.`);
    }

    return trimmed;
  }

  private readOptionalString(value: unknown, key: string, allowBlank = false): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new Error(`${key} must be a string.`);
    }

    if (allowBlank) {
      return value;
    }

    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private readRequiredBoolean(
    value: Record<ImportedSettingsKey, unknown>,
    key: ImportedSettingsKey
  ): boolean {
    return this.requireBooleanValue(value[key], key);
  }

  private readOptionalBoolean(value: unknown, key: string): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }

    return this.requireBooleanValue(value, key);
  }

  private requireBooleanValue(value: unknown, key: string): boolean {
    if (typeof value !== 'boolean') {
      throw new Error(`${key} must be a boolean.`);
    }

    return value;
  }

  private readRequiredPositiveNumber(
    value: Record<ImportedSettingsKey, unknown>,
    key: ImportedSettingsKey
  ): number {
    return this.requirePositiveNumber(value[key], key);
  }

  private readOptionalPositiveNumber(value: unknown, key: string): number | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return this.requirePositiveNumber(value, key);
  }

  private requirePositiveNumber(value: unknown, key: string): number {
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`${key} must be a number greater than or equal to 1.`);
    }

    return parsed;
  }

  private buildBastion(device: DevicePayload): EmbeddedDevice['bastion'] {
    const hasBastion =
      device.bastionHost ||
      device.bastionHostFingerprint ||
      device.bastionPort ||
      device.bastionUsername ||
      device.bastionPassword ||
      device.bastionPrivateKeyPath ||
      device.bastionPrivateKeyPassphrase;

    if (!hasBastion) {
      return undefined;
    }

    return {
      host: (device.bastionHost ?? '').trim(),
      hostFingerprint: device.bastionHostFingerprint?.trim() || undefined,
      port: this.toOptionalNumber(device.bastionPort),
      username: (device.bastionUsername ?? '').trim(),
      password: device.bastionPassword?.trim() || undefined,
      privateKeyPath: device.bastionPrivateKeyPath?.trim() || undefined,
      privateKeyPassphrase: device.bastionPrivateKeyPassphrase?.trim() || undefined,
    };
  }

  private normalizeSshCommands(
    value: SshCommandDefinition[] | string | undefined
  ): SshCommandDefinition[] {
    if (!value || (typeof value === 'string' && !value.trim())) {
      return [];
    }

    let parsed: unknown = value;

    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error(
          'SSH commands must be valid JSON (array of {name, command?, openSshPanel?, rerunOnReconnection?, copyAndRunScript?, script?}).'
        );
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error('SSH commands must be an array.');
    }

    return parsed
      .filter(isSshCommand)
      .map((item, index) => {
        const script = normalizeStoredScript(item.script);
        if (item.copyAndRunScript === true && !script) {
          throw new Error(
            `SSH command at index ${index} has copyAndRunScript enabled but no script.`
          );
        }

        return {
          name: item.name.trim(),
          command: normalizeStoredCommand(item.command),
          openSshPanel: item.openSshPanel === true ? true : undefined,
          rerunOnReconnection:
            item.openSshPanel === true && item.rerunOnReconnection === true ? true : undefined,
          copyAndRunScript: item.copyAndRunScript === true && script ? true : undefined,
          script,
        };
      })
      .filter(
        (item) =>
          item.name.length > 0 &&
          Boolean(item.command || (item.copyAndRunScript === true && item.script))
      );
  }

  private toOptionalNumber(value: number | string | undefined): number | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }

  private toOptionalTriState(value: boolean | TriStateSelection | undefined): boolean | undefined {
    if (value === 'enabled' || value === true) {
      return true;
    }
    if (value === 'disabled' || value === false) {
      return false;
    }
    return undefined;
  }

  private toNumberOrDefault(value: number | string | undefined, fallback: number): number {
    const num = this.toOptionalNumber(value);
    return num ?? fallback;
  }
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 16 })
    .map(() => possible.charAt(Math.floor(Math.random() * possible.length)))
    .join('');
}

function isSshCommand(value: unknown): value is SshCommandDefinition {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<SshCommandDefinition>;
  return (
    typeof candidate.name === 'string' &&
    (candidate.command === undefined || typeof candidate.command === 'string') &&
    (candidate.script === undefined || typeof candidate.script === 'string')
  );
}
