import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(html).toMatch(/<th>Select<\/th>\s*<th>ID<\/th>/);
    expect(html).toContain('<th>External Web Browser</th>');
    expect(html).toContain('<th>Embedded Web Browser</th>');
    expect(html).toContain('<th>Show default SSH cmnds</th>');
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
        'Saved settings. Reload the window or extension host, then save again to persist the Embedded Web Browser default.',
    });
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
        defaultSshCommands: [{ name: ' Reboot ', command: ' sudo reboot ', openSshPanel: true }],
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
          sshCommands: [{ name: ' Logs ', command: ' journalctl -f ', openSshPanel: true }],
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
      'embeddedLogger.defaultSshCommands': [
        { name: 'Reboot', command: 'sudo reboot', openSshPanel: true },
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
          sshCommands: [{ name: 'Logs', command: 'journalctl -f', openSshPanel: true }],
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
          'embeddedLogger.defaultSshCommands': [
            { name: 'Restart', command: 'systemctl restart app', openSshPanel: true },
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
        defaultSshCommands: [
          { name: 'Restart', command: 'systemctl restart app', openSshPanel: true },
        ],
        maxLinesPerTab: 9000,
      },
      groups: [{ name: 'Lab' }],
      devices: [
        {
          id: 'device-a',
          group: 'Lab',
          name: 'Device A',
          host: '10.0.0.1',
          username: 'root',
          showDefaultSshCommands: false,
          sftpPresetsRemote: ['/var/log'],
          sftpPresetsLocal: [],
          bastion: {
            host: 'bastion.local',
            username: 'jump',
          },
        },
      ],
    });
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
