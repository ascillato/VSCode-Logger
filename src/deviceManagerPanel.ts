/**
 * Webview panel that lets users manage embedded devices and defaults in a table-style UI.
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import type { EmbeddedDevice } from './deviceTree';

type IncomingMessage =
  | { type: 'requestState' }
  | { type: 'save'; defaults: DefaultsPayload; devices: DevicePayload[] }
  | { type: 'editJson' }
  | { type: 'clearPasswords' };

interface SshCommand {
  name: string;
  command: string;
}

interface DefaultsPayload {
  defaultPort: number;
  defaultLogCommand: string;
  defaultEnableSshTerminal: boolean;
  defaultEnableSftpExplorer: boolean;
  defaultEnableWebBrowser: boolean;
  defaultSshCommands: SshCommand[];
  maxLinesPerTab: number;
}

interface DevicePayload {
  id: string;
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
  enableSshTerminal?: boolean;
  enableSftpExplorer?: boolean;
  enableWebBrowser?: boolean;
  webBrowserUrl?: string;
  sshCommands?: SshCommand[];
  bastionHost?: string;
  bastionHostFingerprint?: string;
  bastionPort?: number | string;
  bastionUsername?: string;
  bastionPassword?: string;
  bastionPrivateKeyPath?: string;
  bastionPrivateKeyPassphrase?: string;
}

export class DeviceManagerPanel {
  private static currentPanel: DeviceManagerPanel | undefined;
  private static readonly viewType = 'embeddedLogger.deviceManager';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

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
            void this.saveConfiguration(message.defaults, message.devices);
            break;
          case 'editJson':
            void vscode.commands.executeCommand('workbench.action.openSettingsJson');
            break;
          case 'clearPasswords':
            void vscode.commands.executeCommand('embeddedLogger.clearStoredPasswords');
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
          <button class="button" id="editJson">Edit in JSON</button>
          <button class="button button-icon" id="helpButton" title="View configuration example">?</button>
          <button class="button button-primary" id="saveChanges">Save changes</button>
        </div>
      </header>

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
            <span>Enable web browser</span>
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

      <section class="card">
        <div class="card-header">
          <div class="card-header-text">
            <h2>Devices</h2>
            <p>Add or remove rows, then edit fields inline.</p>
          </div>
          <div class="card-header-actions">
            <button class="button" id="addDevice">Add device</button>
          </div>
        </div>
        <div class="table-wrapper">
          <table id="devicesTable">
            <colgroup id="devicesColGroup"></colgroup>
            <thead>
              <tr>
                <th>ID</th>
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
                <th>Web</th>
                <th>Web URL</th>
                <th>Private key path</th>
                <th>Private key passphrase</th>
                <th>Password (legacy)</th>
                <th>SSH commands</th>
                <th>Bastion host</th>
                <th>Bastion port</th>
                <th>Bastion user</th>
                <th>Bastion fingerprint</th>
                <th>Bastion key path</th>
                <th>Bastion key passphrase</th>
                <th>Bastion password (legacy)</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="devicesBody"></tbody>
          </table>
        </div>
      </section>
      <div id="status" aria-live="polite"></div>
    </main>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private postInitialState(): void {
    const config = vscode.workspace.getConfiguration('embeddedLogger');
    const devices = config.get<EmbeddedDevice[]>('devices', []);
    const defaults = {
      defaultPort: config.get<number>('defaultPort', 22) ?? 22,
      defaultLogCommand:
        config.get<string>('defaultLogCommand', 'tail -F /var/log/syslog') ??
        'tail -F /var/log/syslog',
      defaultEnableSshTerminal: config.get<boolean>('defaultEnableSshTerminal', true) ?? true,
      defaultEnableSftpExplorer: config.get<boolean>('defaultEnableSftpExplorer', true) ?? true,
      defaultEnableWebBrowser: config.get<boolean>('defaultEnableWebBrowser', false) ?? false,
      defaultSshCommands: config.get<SshCommand[]>('defaultSshCommands', []) ?? [],
      maxLinesPerTab: config.get<number>('maxLinesPerTab', 100000) ?? 100000,
    };

    this.panel.webview.postMessage({ type: 'init', devices, defaults });
  }

  private async saveConfiguration(
    defaults: DefaultsPayload,
    devices: DevicePayload[]
  ): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('embeddedLogger');

      const normalizedDefaults = this.normalizeDefaults(defaults);
      const normalizedDevices = devices.map((device) => this.normalizeDevice(device));

      await Promise.all([
        config.update(
          'defaultPort',
          normalizedDefaults.defaultPort,
          vscode.ConfigurationTarget.Workspace
        ),
        config.update(
          'defaultLogCommand',
          normalizedDefaults.defaultLogCommand,
          vscode.ConfigurationTarget.Workspace
        ),
        config.update(
          'defaultEnableSshTerminal',
          normalizedDefaults.defaultEnableSshTerminal,
          vscode.ConfigurationTarget.Workspace
        ),
        config.update(
          'defaultEnableSftpExplorer',
          normalizedDefaults.defaultEnableSftpExplorer,
          vscode.ConfigurationTarget.Workspace
        ),
        config.update(
          'defaultEnableWebBrowser',
          normalizedDefaults.defaultEnableWebBrowser,
          vscode.ConfigurationTarget.Workspace
        ),
        config.update(
          'defaultSshCommands',
          normalizedDefaults.defaultSshCommands,
          vscode.ConfigurationTarget.Workspace
        ),
        config.update(
          'maxLinesPerTab',
          normalizedDefaults.maxLinesPerTab,
          vscode.ConfigurationTarget.Workspace
        ),
        config.update('devices', normalizedDevices, vscode.ConfigurationTarget.Workspace),
      ]);

      this.panel.webview.postMessage({ type: 'saveResult', success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.panel.webview.postMessage({ type: 'saveResult', success: false, message });
    }
  }

  private normalizeDefaults(defaults: DefaultsPayload): {
    defaultPort: number;
    defaultLogCommand: string;
    defaultEnableSshTerminal: boolean;
    defaultEnableSftpExplorer: boolean;
    defaultEnableWebBrowser: boolean;
    defaultSshCommands: { name: string; command: string }[];
    maxLinesPerTab: number;
  } {
    const defaultPort = this.toNumberOrDefault(defaults.defaultPort, 22);
    const maxLinesPerTab = this.toNumberOrDefault(defaults.maxLinesPerTab, 100000);
    const defaultLogCommand =
      (defaults.defaultLogCommand ?? '').trim() || 'tail -F /var/log/syslog';
    const defaultEnableSshTerminal = Boolean(defaults.defaultEnableSshTerminal);
    const defaultEnableSftpExplorer = Boolean(defaults.defaultEnableSftpExplorer);
    const defaultEnableWebBrowser = Boolean(defaults.defaultEnableWebBrowser);
    const defaultSshCommands = this.normalizeSshCommands(defaults.defaultSshCommands);

    return {
      defaultPort,
      defaultLogCommand,
      defaultEnableSshTerminal,
      defaultEnableSftpExplorer,
      defaultEnableWebBrowser,
      defaultSshCommands,
      maxLinesPerTab,
    };
  }

  private normalizeDevice(device: DevicePayload): EmbeddedDevice {
    const sshCommands = this.normalizeSshCommands(device.sshCommands);
    const bastion = this.buildBastion(device);

    return {
      id: (device.id ?? '').trim(),
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
      enableSshTerminal: Boolean(device.enableSshTerminal),
      enableSftpExplorer: Boolean(device.enableSftpExplorer),
      enableWebBrowser: Boolean(device.enableWebBrowser),
      webBrowserUrl: device.webBrowserUrl?.trim() || undefined,
      sshCommands,
      bastion,
    };
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

  private normalizeSshCommands(value: SshCommand[] | string | undefined): SshCommand[] {
    if (!value || (typeof value === 'string' && !value.trim())) {
      return [];
    }

    let parsed: unknown = value;

    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error('SSH commands must be valid JSON (array of {name, command}).');
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error('SSH commands must be an array.');
    }

    return parsed
      .filter(isSshCommand)
      .map((item) => ({ name: item.name.trim(), command: item.command.trim() }))
      .filter((item) => item.name && item.command);
  }

  private toOptionalNumber(value: number | string | undefined): number | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
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

function isSshCommand(value: unknown): value is SshCommand {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<SshCommand>;
  return typeof candidate.name === 'string' && typeof candidate.command === 'string';
}
