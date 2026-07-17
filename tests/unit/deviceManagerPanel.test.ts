import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => import('../mocks/vscode'));

import { DeviceManagerPanel } from '../../src/deviceManagerPanel';
import {
  Uri,
  commands,
  createExtensionContext,
  getCreatedWebviews,
  resetCreatedWebviews,
  setOpenDialogResponse,
  setSaveDialogResponse,
  resetWindowResponses,
  resetWorkspaceConfiguration,
  resetWorkspaceState,
  workspace,
} from '../mocks/vscode';

const createPanel = () => {
  const context = createExtensionContext();
  DeviceManagerPanel.createOrShow(context.extensionUri);
  const panel = getCreatedWebviews()[0];
  if (!panel) {
    throw new Error('Expected DeviceManagerPanel to create a webview panel.');
  }
  return panel;
};

beforeEach(() => {
  resetWorkspaceConfiguration();
  resetWorkspaceState();
  resetWindowResponses();
  resetCreatedWebviews();
});

afterEach(() => {
  const panels = getCreatedWebviews();
  panels.forEach((panel) => {
    panel.dispose();
  });
  resetCreatedWebviews();
  resetWorkspaceState();
  vi.restoreAllMocks();
});

describe('DeviceManagerPanel', () => {
  it('renders selected-device controls and select column in Devices table', () => {
    const panel = createPanel();
    const html = panel.webview.html;

    expect(html).toContain('id="moveSelectedUp"');
    expect(html).toContain('title="Move selected devices up in the list"');
    expect(html).toContain('id="moveSelectedDown"');
    expect(html).toContain('title="Move selected devices down in the list"');
    expect(html).toContain('id="clearSelectedPasswords"');
    expect(html).toContain('id="removeSelectedDevices"');
    expect(html).toMatch(/id="moveSelectedUp"[\s\S]*?disabled/);
    expect(html).toMatch(/id="moveSelectedDown"[\s\S]*?disabled/);
    expect(html).toMatch(/id="clearSelectedPasswords"[\s\S]*?disabled/);
    expect(html).toMatch(/id="removeSelectedDevices"[\s\S]*?disabled/);
    expect(html).toContain('id="showBastionOptions"');
    expect(html).toContain('<span>Show Bastion options</span>');
    expect(html).toContain('<tr id="devicesHeader"></tr>');
    expect(html).not.toContain('<th>ID</th>');
    expect(html).toContain('id="defaultEnableEmbeddedWebBrowser"');
    expect(html).toContain('<h2>Groups</h2>');
    expect(html).toContain('id="addGroup"');
    expect(html).toContain('id="removeSelectedGroups"');
    expect(html).toMatch(/<th>Select<\/th>\s*<th>Name<\/th>/);
    expect(html).toMatch(
      /id="clearPasswords"[\s\S]*id="importSettings"[\s\S]*id="exportSettings"[\s\S]*id="editJson"/
    );
    expect(html).toContain('title="Import Settings"');
    expect(html).toContain('title="Export Settings"');
    expect(html).toContain('aria-label="Import Settings"');
    expect(html).toContain('aria-label="Export Settings"');
  });

  it('reports enabled global defaults when no defaults are configured yet', async () => {
    const panel = createPanel();

    panel.__fireMessage({ type: 'requestState' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'init',
      defaults: expect.objectContaining({
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: true,
        defaultEnableEmbeddedWebBrowser: true,
        enableDevicePing: true,
      }),
      devices: [],
      groups: [],
    });
  });

  it('routes per-device password reset messages to clearStoredPasswords command with device id', async () => {
    const panel = createPanel();
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();

    panel.__fireMessage({ type: 'clearDevicePassword', deviceId: 'device-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commands.executeCommand).toHaveBeenCalledWith(
      'embeddedLogger.clearStoredPasswords',
      'device-1'
    );
  });

  it('saves devices in the same order received from the webview payload', async () => {
    const panel = createPanel();
    const config = workspace.getConfiguration('embeddedLogger');
    const updateSpy = vi.spyOn(config, 'update');

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        defaultSshCommands: [],
        maxLinesPerTab: 100000,
      },
      devices: [
        {
          id: 'device-b',
          name: 'Device B',
          host: '10.0.0.2',
          username: 'root',
        },
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const devicesCall = updateSpy.mock.calls.find((call) => call[0] === 'devices');
    expect(devicesCall).toBeDefined();
    if (!devicesCall) {
      throw new Error('Missing devices update call.');
    }
    expect((devicesCall[1] as Array<{ id: string }>).map((device) => device.id)).toEqual([
      'device-b',
      'device-a',
    ]);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'saveResult',
      success: true,
      message: 'Saved settings.',
    });
  });

  it('generates missing device ids and repairs duplicate ids on save', async () => {
    const panel = createPanel();
    const config = workspace.getConfiguration('embeddedLogger');
    const updateSpy = vi.spyOn(config, 'update');

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        defaultSshCommands: [],
        maxLinesPerTab: 100000,
      },
      devices: [
        {
          name: 'New Device',
          host: '10.0.0.1',
          username: 'root',
        },
        {
          id: 'legacy-device',
          name: 'Legacy Device',
          host: '10.0.0.2',
          username: 'root',
        },
        {
          id: 'legacy-device',
          name: 'Legacy Device Copy',
          host: '10.0.0.3',
          username: 'root',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const devicesCall = updateSpy.mock.calls.find((call) => call[0] === 'devices');
    expect(devicesCall).toBeDefined();
    if (!devicesCall) {
      throw new Error('Missing devices update call.');
    }
    expect((devicesCall[1] as Array<{ id: string }>).map((device) => device.id)).toEqual([
      'new-device',
      'legacy-device',
      'legacy-device-2',
    ]);
  });

  it('keeps saving when the embedded browser default is unavailable and asks for a reload', async () => {
    const panel = createPanel();
    const config = workspace.getConfiguration('embeddedLogger');
    const updateSpy = vi.spyOn(config, 'update').mockImplementation((key: string) => {
      if (key === 'defaultEnableEmbeddedWebBrowser') {
        return Promise.reject(
          new Error(
            'Unable to write to User Settings because embeddedLogger.defaultEnableEmbeddedWebBrowser is not a registered configuration.'
          )
        );
      }

      return Promise.resolve();
    });

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        defaultSshCommands: [],
        maxLinesPerTab: 100000,
      },
      devices: [
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateSpy).toHaveBeenCalledWith(
      'devices',
      expect.arrayContaining([expect.objectContaining({ id: 'device-a' })]),
      expect.anything()
    );
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'saveResult',
      success: true,
      message:
        'Saved settings. Reload the window or extension host, then save again to persist newly added default settings.',
    });
  });

  it('keeps saving when the language setting is not registered until reload', async () => {
    const panel = createPanel();
    const config = workspace.getConfiguration('embeddedLogger');
    const updateSpy = vi.spyOn(config, 'update').mockImplementation((key: string) => {
      if (key === 'language') {
        return Promise.reject(
          new Error(
            'Unable to write to User Settings because embeddedLogger.language is not a registered configuration.'
          )
        );
      }

      return Promise.resolve();
    });

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        language: 'de',
        defaultSshCommands: [],
        maxLinesPerTab: 100000,
      },
      groups: [],
      devices: [
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateSpy).toHaveBeenCalledWith('language', 'de', expect.anything());
    expect(updateSpy).toHaveBeenCalledWith(
      'devices',
      expect.arrayContaining([expect.objectContaining({ id: 'device-a' })]),
      expect.anything()
    );
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'saveResult',
      success: true,
      message:
        'Saved settings. Reload the window or extension host, then save again to persist newly added default settings.',
    });
    expect(commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.reloadWindow');
  });

  it('reloads the window after saving a changed language setting', async () => {
    const panel = createPanel();

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        language: 'de',
        defaultSshCommands: [],
        maxLinesPerTab: 100000,
      },
      groups: [],
      devices: [
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'saveResult',
      success: true,
      message: 'Saved settings.',
    });
    expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
  });

  it('stores SFTP presets directly on device configuration entries', async () => {
    const panel = createPanel();
    const config = workspace.getConfiguration('embeddedLogger');
    const updateSpy = vi.spyOn(config, 'update');

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        defaultSshCommands: [],
        maxLinesPerTab: 100000,
      },
      devices: [
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
          sftpPresetsRemote: ' /var/log \n/opt/app\n',
          sftpPresetsLocal: '\n/tmp\n /work ',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const devicesCall = updateSpy.mock.calls.find((call) => call[0] === 'devices');
    expect(devicesCall).toBeDefined();
    if (!devicesCall) {
      throw new Error('Missing devices update call.');
    }

    expect(devicesCall[1]).toEqual([
      expect.objectContaining({
        id: 'device-a',
        sftpPresetsRemote: ['/var/log', '/opt/app'],
        sftpPresetsLocal: ['/tmp', '/work'],
      }),
    ]);
  });

  it('normalizes defaults, devices, groups, and SSH command payload variants', () => {
    createPanel();
    const manager = (DeviceManagerPanel as unknown as { currentPanel: unknown }).currentPanel as {
      normalizeDefaults: (defaults: Record<string, unknown>) => Record<string, unknown>;
      normalizeGroups: (groups: unknown) => Array<{ name: string }>;
      normalizeDevice: (device: Record<string, unknown>) => Record<string, unknown>;
      normalizeSshCommands: (value: unknown) => Array<Record<string, unknown>>;
      parsePresetText: (value?: string) => string[];
      toOptionalNumber: (value: unknown) => number | undefined;
      toOptionalPositiveInteger: (value: unknown) => number | undefined;
      toOptionalTriState: (value: unknown) => boolean | undefined;
    };

    expect(
      manager.normalizeDefaults({
        defaultPort: 'bad',
        defaultLogCommand: '   ',
        defaultEnableSshTerminal: 1,
        defaultEnableSftpExplorer: '',
        defaultEnableWebBrowser: true,
        defaultEnableEmbeddedWebBrowser: false,
        enableDevicePing: true,
        devicePingIntervalSeconds: '0',
        defaultSshCommands: JSON.stringify([
          { name: ' Follow ', command: ' tail -f /var/log/syslog ', openSshPanel: true },
          { name: '', command: 'ignored' },
        ]),
        maxLinesPerTab: 'not-a-number',
      })
    ).toEqual(
      expect.objectContaining({
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: false,
        devicePingIntervalSeconds: undefined,
        maxLinesPerTab: 100000,
        defaultSshCommands: [
          {
            name: 'Follow',
            command: 'tail -f /var/log/syslog',
            openSshPanel: true,
            rerunOnReconnection: undefined,
            copyAndRunScript: undefined,
            script: undefined,
          },
        ],
      })
    );

    expect(manager.normalizeGroups([{ name: ' Group A ' }, { name: ' ' }, undefined])).toEqual([
      { name: 'Group A' },
    ]);
    expect(manager.normalizeGroups('bad')).toEqual([]);
    expect(manager.parsePresetText(undefined)).toEqual([]);
    expect(
      manager.parsePresetText(Array.from({ length: 12 }, (_, index) => `/p${index}`).join('\n'))
    ).toHaveLength(10);
    expect(manager.toOptionalNumber('abc')).toBeUndefined();
    expect(manager.toOptionalPositiveInteger('5')).toBe(5);
    expect(manager.toOptionalPositiveInteger('5.5')).toBeUndefined();
    expect(manager.toOptionalTriState('enabled')).toBe(true);
    expect(manager.toOptionalTriState('disabled')).toBe(false);
    expect(manager.toOptionalTriState('default')).toBeUndefined();

    expect(
      manager.normalizeDevice({
        id: ' device-a ',
        group: ' Lab ',
        color: ' white ',
        name: ' Device A ',
        host: ' 10.0.0.10 ',
        hostFingerprint: ' SHA256:host ',
        secondaryHost: ' backup.local ',
        secondaryHostFingerprint: ' SHA256:backup ',
        port: '2222',
        username: ' root ',
        password: ' secret ',
        privateKeyPath: ' ~/.ssh/id ',
        privateKeyPassphrase: ' pass ',
        logCommand: ' journalctl -f ',
        enableSshTerminal: 'enabled',
        enableSftpExplorer: 'disabled',
        enableWebBrowser: true,
        enableEmbeddedWebBrowser: false,
        webBrowserUrl: ' http://device ',
        showDefaultSshCommands: false,
        bastionHost: ' jump.local ',
        bastionHostFingerprint: ' SHA256:jump ',
        bastionPort: '2200',
        bastionUsername: ' jump ',
        bastionPassword: ' jump-secret ',
        bastionPrivateKeyPath: ' ~/.ssh/jump ',
        bastionPrivateKeyPassphrase: ' jump-pass ',
        sftpPresetsRemote: '/var/log\n/opt/app',
        sftpPresetsLocal: '/tmp',
        sshCommands: [
          {
            name: ' Deploy ',
            command: '',
            copyAndRunScript: true,
            script: '#!/bin/sh\r\necho ok\r\n',
          },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        id: 'device-a',
        group: 'Lab',
        color: 'white',
        host: '10.0.0.10',
        port: 2222,
        enableSshTerminal: true,
        enableSftpExplorer: false,
        enableWebBrowser: true,
        enableEmbeddedWebBrowser: false,
        showDefaultSshCommands: false,
        bastion: expect.objectContaining({
          host: 'jump.local',
          port: 2200,
          username: 'jump',
        }),
        sftpPresetsRemote: ['/var/log', '/opt/app'],
        sftpPresetsLocal: ['/tmp'],
        sshCommands: [
          expect.objectContaining({
            name: 'Deploy',
            copyAndRunScript: true,
            script: '#!/bin/sh\necho ok\n',
          }),
        ],
      })
    );
  });

  it('validates imported settings and reports malformed nested payloads', () => {
    createPanel();
    const manager = (DeviceManagerPanel as unknown as { currentPanel: unknown }).currentPanel as {
      validateImportedSettings: (raw: unknown) => unknown;
      validateGroups: (value: unknown, key: string) => unknown;
      validateSshCommands: (value: unknown, key: string) => unknown;
      validateOptionalPresetArray: (value: unknown, key: string) => unknown;
      validateOptionalBastion: (value: unknown, key: string) => unknown;
      readOptionalString: (value: unknown, key: string, allowBlank?: boolean) => string | undefined;
      readOptionalBoolean: (value: unknown, key: string) => boolean | undefined;
      readOptionalPositiveNumber: (value: unknown, key: string) => number | undefined;
      requireStringValue: (value: unknown, key: string, allowBlank?: boolean) => string;
      requireBooleanValue: (value: unknown, key: string) => boolean;
      requirePositiveNumber: (value: unknown, key: string) => number;
      normalizeSshCommands: (value: unknown) => unknown;
    };
    const validImport = {
      'embeddedLogger.defaultPort': '22',
      'embeddedLogger.defaultLogCommand': 'journalctl -f',
      'embeddedLogger.defaultEnableSshTerminal': true,
      'embeddedLogger.defaultEnableSftpExplorer': true,
      'embeddedLogger.defaultEnableWebBrowser': false,
      'embeddedLogger.defaultEnableEmbeddedWebBrowser': false,
      'embeddedLogger.enableDevicePing': true,
      'embeddedLogger.devicePingIntervalSeconds': '',
      'embeddedLogger.defaultSshCommands': [{ name: 'Uptime', command: 'uptime' }],
      'embeddedLogger.maxLinesPerTab': 1000,
      'embeddedLogger.groups': [{ name: 'Lab' }],
      'embeddedLogger.devices': [
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.10',
          username: 'root',
          showDefaultSshCommands: true,
          sftpPresetsRemote: ['/var/log'],
        },
      ],
    };

    expect(manager.validateImportedSettings(validImport)).toEqual(
      expect.objectContaining({
        groups: [{ name: 'Lab' }],
        devices: [
          expect.not.objectContaining({
            showDefaultSshCommands: expect.anything(),
          }),
        ],
      })
    );

    expect(
      manager.validateImportedSettings({
        ...validImport,
        'embeddedLogger.devices': [
          { name: 'Imported Device', host: '10.0.0.10', username: 'root' },
          { id: 'device-a', name: 'Device A', host: '10.0.0.11', username: 'root' },
          { id: 'device-a', name: 'Device A Copy', host: '10.0.0.12', username: 'root' },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        devices: [
          expect.objectContaining({ id: 'imported-device' }),
          expect.objectContaining({ id: 'device-a' }),
          expect.objectContaining({ id: 'device-a-2' }),
        ],
      })
    );

    expect(() => manager.validateImportedSettings(null)).toThrow(
      'The imported settings file must contain a JSON object.'
    );
    expect(() => manager.validateImportedSettings({})).toThrow(
      'Imported settings are missing required key'
    );
    expect(() =>
      manager.validateImportedSettings({ ...validImport, 'embeddedLogger.devices': 'bad' })
    ).toThrow('embeddedLogger.devices must be an array.');
    expect(() => manager.validateGroups('bad', 'groups')).toThrow(
      'groups must be an array of group objects.'
    );
    expect(() => manager.validateGroups([null], 'groups')).toThrow('groups[0] must be an object.');
    expect(() => manager.validateSshCommands('bad', 'commands')).toThrow(
      'commands must be an array'
    );
    expect(() => manager.validateSshCommands([{}], 'commands')).toThrow(
      'commands[0].name must be a string.'
    );
    expect(() =>
      manager.validateSshCommands([{ name: 'Script', copyAndRunScript: true }], 'commands')
    ).toThrow('commands[0].script is required when copyAndRunScript is enabled.');
    expect(() => manager.validateOptionalPresetArray([1], 'presets')).toThrow(
      'presets must be an array of strings.'
    );
    expect(() => manager.validateOptionalBastion('bad', 'bastion')).toThrow(
      'bastion must be an object.'
    );
    expect(manager.readOptionalString('', 'key')).toBeUndefined();
    expect(manager.readOptionalString('  ', 'key')).toBeUndefined();
    expect(manager.readOptionalString('  ', 'key', true)).toBe('  ');
    expect(() => manager.readOptionalString(1, 'key')).toThrow('key must be a string.');
    expect(manager.readOptionalBoolean(undefined, 'flag')).toBeUndefined();
    expect(() => manager.readOptionalBoolean('true', 'flag')).toThrow('flag must be a boolean.');
    expect(manager.readOptionalPositiveNumber('', 'count')).toBeUndefined();
    expect(() => manager.requireStringValue('', 'name')).toThrow('name is required.');
    expect(() => manager.requireBooleanValue('false', 'flag')).toThrow('flag must be a boolean.');
    expect(() => manager.requirePositiveNumber(0, 'port')).toThrow(
      'port must be a number greater than or equal to 1.'
    );
    expect(() => manager.normalizeSshCommands('{bad json')).toThrow(
      'SSH commands must be valid JSON'
    );
    expect(() => manager.normalizeSshCommands({})).toThrow('SSH commands must be an array.');
    expect(() =>
      manager.normalizeSshCommands([{ name: 'Deploy', copyAndRunScript: true }])
    ).toThrow('SSH command at index 0 has copyAndRunScript enabled but no script.');
  });

  it('saves a blank ping interval as null instead of forcing a default value', async () => {
    const panel = createPanel();
    const config = workspace.getConfiguration('embeddedLogger');
    const updateSpy = vi.spyOn(config, 'update');

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        enableDevicePing: true,
        devicePingIntervalSeconds: '',
        defaultSshCommands: [],
        maxLinesPerTab: 100000,
      },
      devices: [
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateSpy).toHaveBeenCalledWith('devicePingIntervalSeconds', null, expect.anything());
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'saveResult',
      success: true,
      message: 'Saved settings.',
    });
  });

  it('stores disabled default SSH commands explicitly on device entries', async () => {
    const panel = createPanel();
    const config = workspace.getConfiguration('embeddedLogger');
    const updateSpy = vi.spyOn(config, 'update');

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        defaultSshCommands: [{ name: 'Reboot', command: 'reboot', openSshPanel: false }],
        maxLinesPerTab: 100000,
      },
      devices: [
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
          showDefaultSshCommands: false,
          sshCommands: [{ name: 'Logs', command: 'journalctl -f', openSshPanel: true }],
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const devicesCall = updateSpy.mock.calls.find((call) => call[0] === 'devices');
    expect(devicesCall).toBeDefined();
    if (!devicesCall) {
      throw new Error('Missing devices update call.');
    }

    expect(devicesCall[1]).toEqual([
      expect.objectContaining({
        id: 'device-a',
        showDefaultSshCommands: false,
        sshCommands: [{ name: 'Logs', command: 'journalctl -f', openSshPanel: true }],
      }),
    ]);
  });

  it('persists copy-and-run scripts on SSH commands', async () => {
    const panel = createPanel();
    const config = workspace.getConfiguration('embeddedLogger');
    const updateSpy = vi.spyOn(config, 'update');

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: false,
        defaultSshCommands: [
          {
            name: 'Deploy',
            command: 'echo ready',
            copyAndRunScript: true,
            script: '#!/bin/sh\necho deployed\n',
          },
        ],
        maxLinesPerTab: 100000,
      },
      devices: [
        {
          id: 'device-a',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
          sshCommands: [
            {
              name: 'Script only',
              copyAndRunScript: true,
              script: '#!/bin/sh\necho device\n',
            },
          ],
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const defaultsCall = updateSpy.mock.calls.find((call) => call[0] === 'defaultSshCommands');
    const devicesCall = updateSpy.mock.calls.find((call) => call[0] === 'devices');
    expect(defaultsCall?.[1]).toEqual([
      {
        name: 'Deploy',
        command: 'echo ready',
        copyAndRunScript: true,
        script: '#!/bin/sh\necho deployed\n',
      },
    ]);
    expect(devicesCall?.[1]).toEqual([
      expect.objectContaining({
        id: 'device-a',
        sshCommands: [
          {
            name: 'Script only',
            copyAndRunScript: true,
            script: '#!/bin/sh\necho device\n',
          },
        ],
      }),
    ]);
  });

  it('exports the current manager state as settings.json-compatible JSON', async () => {
    const panel = createPanel();
    const exportPath = '/tmp/embedded-device-logger-settings.json';
    setSaveDialogResponse(exportPath);

    panel.__fireMessage({
      type: 'exportSettings',
      defaults: {
        defaultPort: 22,
        defaultLogCommand: 'tail -F /var/log/syslog',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: true,
        enableDevicePing: false,
        devicePingIntervalSeconds: '',
        defaultSshCommands: [
          {
            name: ' Deploy ',
            command: ' echo ready ',
            copyAndRunScript: true,
            script: '#!/bin/sh\necho deployed\n',
          },
        ],
        maxLinesPerTab: 5000,
      },
      groups: [{ name: ' Lab ' }],
      devices: [
        {
          id: ' device-a ',
          group: ' Lab ',
          color: '#4fc3f7',
          name: ' Device A ',
          host: ' 10.0.0.1 ',
          username: ' root ',
          enableSshTerminal: 'enabled',
          enableWebBrowser: 'disabled',
          showDefaultSshCommands: false,
          sftpPresetsRemote: ' /var/log \n /opt/app ',
          sshCommands: [
            {
              name: ' Deploy ',
              copyAndRunScript: true,
              script: '#!/bin/sh\necho device\n',
            },
          ],
          bastionHost: ' bastion.local ',
          bastionUsername: ' jump ',
          bastionPort: '22',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const written = await workspace.fs.readFile(Uri.file(exportPath) as never);
    const exported = JSON.parse(Buffer.from(written).toString('utf8'));

    expect(exported).toEqual({
      'embeddedLogger.defaultPort': 22,
      'embeddedLogger.defaultLogCommand': 'tail -F /var/log/syslog',
      'embeddedLogger.defaultEnableSshTerminal': true,
      'embeddedLogger.defaultEnableSftpExplorer': true,
      'embeddedLogger.defaultEnableWebBrowser': false,
      'embeddedLogger.defaultEnableEmbeddedWebBrowser': true,
      'embeddedLogger.language': 'vscode',
      'embeddedLogger.enableDevicePing': false,
      'embeddedLogger.devicePingIntervalSeconds': null,
      'embeddedLogger.defaultSshCommands': [
        {
          name: 'Deploy',
          command: 'echo ready',
          copyAndRunScript: true,
          script: '#!/bin/sh\necho deployed\n',
        },
      ],
      'embeddedLogger.maxLinesPerTab': 5000,
      'embeddedLogger.groups': [{ name: 'Lab' }],
      'embeddedLogger.devices': [
        {
          id: 'device-a',
          group: 'Lab',
          color: '#4fc3f7',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
          enableSshTerminal: true,
          enableWebBrowser: false,
          showDefaultSshCommands: false,
          sftpPresetsRemote: ['/var/log', '/opt/app'],
          sshCommands: [
            {
              name: 'Deploy',
              copyAndRunScript: true,
              script: '#!/bin/sh\necho device\n',
            },
          ],
          bastion: {
            host: 'bastion.local',
            port: 22,
            username: 'jump',
          },
        },
      ],
    });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'operationResult',
      message: `Exported settings to ${exportPath}.`,
      variant: 'success',
    });
  });

  it('imports validated settings into the manager state without saving immediately', async () => {
    const panel = createPanel();
    const importPath = '/tmp/imported-settings.json';
    setOpenDialogResponse(importPath);

    await workspace.fs.writeFile(
      Uri.file(importPath) as never,
      Buffer.from(
        JSON.stringify({
          'embeddedLogger.defaultPort': 2222,
          'embeddedLogger.defaultLogCommand': 'journalctl -f',
          'embeddedLogger.defaultEnableSshTerminal': true,
          'embeddedLogger.defaultEnableSftpExplorer': true,
          'embeddedLogger.defaultEnableWebBrowser': false,
          'embeddedLogger.defaultEnableEmbeddedWebBrowser': true,
          'embeddedLogger.language': 'it',
          'embeddedLogger.enableDevicePing': true,
          'embeddedLogger.devicePingIntervalSeconds': 30,
          'embeddedLogger.defaultSshCommands': [
            {
              name: 'Restart',
              command: 'systemctl restart app',
              openSshPanel: true,
              copyAndRunScript: true,
              script: '#!/bin/sh\necho imported\n',
            },
          ],
          'embeddedLogger.maxLinesPerTab': 9000,
          'embeddedLogger.groups': [{ name: 'Lab' }],
          'embeddedLogger.devices': [
            {
              id: 'device-a',
              group: 'Lab',
              name: 'Device A',
              host: '10.0.0.1',
              username: 'root',
              showDefaultSshCommands: false,
              sftpPresetsRemote: ['/var/log'],
              bastion: {
                host: 'bastion.local',
                username: 'jump',
              },
            },
          ],
        }),
        'utf8'
      )
    );

    panel.__fireMessage({ type: 'importSettings' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'importResult',
      success: true,
      message: `Imported settings from ${importPath}. Review and click Save changes to apply them.`,
      defaults: {
        defaultPort: 2222,
        defaultLogCommand: 'journalctl -f',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: true,
        language: 'it',
        enableDevicePing: true,
        devicePingIntervalSeconds: 30,
        defaultSshCommands: [
          {
            name: 'Restart',
            command: 'systemctl restart app',
            openSshPanel: true,
            copyAndRunScript: true,
            script: '#!/bin/sh\necho imported\n',
          },
        ],
        maxLinesPerTab: 9000,
      },
      groups: [{ name: 'Lab' }],
      devices: [
        expect.objectContaining({
          id: 'device-a',
          group: 'Lab',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
          showDefaultSshCommands: false,
          sftpPresetsRemote: ['/var/log'],
          sftpPresetsLocal: [],
          bastion: expect.objectContaining({
            host: 'bastion.local',
            username: 'jump',
          }),
        }),
      ],
    });
  });

  it('saves imported settings to the user configuration when workspace settings exist', async () => {
    const importPath = '/tmp/imported-user-settings.json';
    const config = workspace.getConfiguration('embeddedLogger');
    await config.update('devices', [
      { id: 'workspace-device', name: 'Workspace', host: '10.0.0.2', username: 'root' },
    ]);
    const updateSpy = vi.spyOn(config, 'update');
    const panel = createPanel();
    setOpenDialogResponse(importPath);

    await workspace.fs.writeFile(
      Uri.file(importPath) as never,
      Buffer.from(
        JSON.stringify({
          'embeddedLogger.defaultPort': 2222,
          'embeddedLogger.defaultLogCommand': 'journalctl -f',
          'embeddedLogger.defaultEnableSshTerminal': true,
          'embeddedLogger.defaultEnableSftpExplorer': true,
          'embeddedLogger.defaultEnableWebBrowser': false,
          'embeddedLogger.defaultEnableEmbeddedWebBrowser': true,
          'embeddedLogger.enableDevicePing': true,
          'embeddedLogger.devicePingIntervalSeconds': 30,
          'embeddedLogger.defaultSshCommands': [],
          'embeddedLogger.maxLinesPerTab': 9000,
          'embeddedLogger.devices': [],
        }),
        'utf8'
      )
    );

    panel.__fireMessage({ type: 'importSettings' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    updateSpy.mockClear();

    panel.__fireMessage({
      type: 'save',
      defaults: {
        defaultPort: 2222,
        defaultLogCommand: 'journalctl -f',
        defaultEnableSshTerminal: true,
        defaultEnableSftpExplorer: true,
        defaultEnableWebBrowser: false,
        defaultEnableEmbeddedWebBrowser: true,
        enableDevicePing: true,
        devicePingIntervalSeconds: 30,
        defaultSshCommands: [],
        maxLinesPerTab: 9000,
      },
      groups: [],
      devices: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateSpy).toHaveBeenCalled();
    expect(
      updateSpy.mock.calls.every((call) => call[2] === vscode.ConfigurationTarget.Global)
    ).toBe(true);
  });

  it('rejects imported files that omit required device keys', async () => {
    const panel = createPanel();
    const importPath = '/tmp/invalid-imported-settings.json';
    setOpenDialogResponse(importPath);

    await workspace.fs.writeFile(
      Uri.file(importPath) as never,
      Buffer.from(
        JSON.stringify({
          'embeddedLogger.defaultPort': 22,
          'embeddedLogger.defaultLogCommand': 'tail -F /var/log/syslog',
          'embeddedLogger.defaultEnableSshTerminal': true,
          'embeddedLogger.defaultEnableSftpExplorer': true,
          'embeddedLogger.defaultEnableWebBrowser': false,
          'embeddedLogger.defaultEnableEmbeddedWebBrowser': false,
          'embeddedLogger.enableDevicePing': false,
          'embeddedLogger.devicePingIntervalSeconds': null,
          'embeddedLogger.defaultSshCommands': [],
          'embeddedLogger.maxLinesPerTab': 100000,
          'embeddedLogger.devices': [
            {
              id: 'device-a',
              name: 'Device A',
              host: '10.0.0.1',
            },
          ],
        }),
        'utf8'
      )
    );

    panel.__fireMessage({ type: 'importSettings' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'importResult',
      success: false,
      message: 'Failed to import settings: embeddedLogger.devices[0].username must be a string.',
    });
  });
});
