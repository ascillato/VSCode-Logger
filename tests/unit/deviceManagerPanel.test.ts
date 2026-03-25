import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import { DeviceManagerPanel } from '../../src/deviceManagerPanel';
import {
  commands,
  createExtensionContext,
  getCreatedWebviews,
  resetCreatedWebviews,
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
    expect(html).toContain('id="defaultEnableEmbeddedWebBrowser"');
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
});
