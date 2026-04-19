import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import {
  getEmbeddedLoggerConfiguration,
  getEmbeddedLoggerGroups,
  mergeSftpPresets,
  sanitizeSftpPresets,
  updateEmbeddedLoggerDeviceConfiguration,
} from '../../src/configuration';
import type { EmbeddedDevice, SshCommandDefinition } from '../../src/deviceTree';
import { resetWorkspaceConfiguration, workspace } from '../mocks/vscode';

const defaultCommands: SshCommandDefinition[] = [
  { name: 'Reboot', command: 'reboot' },
  { name: 'Processes', command: 'top', openSshPanel: true },
];

const deviceCommands: SshCommandDefinition[] = [
  { name: 'Logs', command: 'journalctl -f', openSshPanel: true },
];

const scriptCommands: SshCommandDefinition[] = [
  {
    name: 'Deploy helper',
    copyAndRunScript: true,
    script: '#!/bin/sh\necho deployed\n',
  },
];

beforeEach(() => {
  resetWorkspaceConfiguration();
});

describe('configuration', () => {
  it('uses enabled feature defaults when related settings are unset', async () => {
    const devices: EmbeddedDevice[] = [
      {
        id: 'device-a',
        name: 'Device A',
        host: '10.0.0.1',
        username: 'root',
      },
    ];

    await workspace.getConfiguration('embeddedLogger').update('devices', devices);

    const config = getEmbeddedLoggerConfiguration();

    expect(config.enableDevicePing).toBe(true);
    expect(config.devices).toEqual([
      expect.objectContaining({
        id: 'device-a',
        enableSshTerminal: true,
        enableSftpExplorer: true,
        enableWebBrowser: true,
        enableEmbeddedWebBrowser: true,
      }),
    ]);
  });

  it('prepends shared SSH commands before per-device commands by default', async () => {
    const devices: EmbeddedDevice[] = [
      {
        id: 'device-a',
        name: 'Device A',
        host: '10.0.0.1',
        username: 'root',
        sshCommands: deviceCommands,
      },
    ];

    await workspace
      .getConfiguration('embeddedLogger')
      .update('defaultSshCommands', defaultCommands);
    await workspace.getConfiguration('embeddedLogger').update('devices', devices);

    const { devices: resolvedDevices } = getEmbeddedLoggerConfiguration();

    expect(resolvedDevices).toEqual([
      expect.objectContaining({
        id: 'device-a',
        showDefaultSshCommands: true,
        sshCommands: [...defaultCommands, ...deviceCommands],
      }),
    ]);
  });

  it('hides shared SSH commands when a device disables them', async () => {
    const devices: EmbeddedDevice[] = [
      {
        id: 'device-a',
        name: 'Device A',
        host: '10.0.0.1',
        username: 'root',
        showDefaultSshCommands: false,
        sshCommands: deviceCommands,
      },
    ];

    await workspace
      .getConfiguration('embeddedLogger')
      .update('defaultSshCommands', defaultCommands);
    await workspace.getConfiguration('embeddedLogger').update('devices', devices);

    const { devices: resolvedDevices } = getEmbeddedLoggerConfiguration();

    expect(resolvedDevices).toEqual([
      expect.objectContaining({
        id: 'device-a',
        showDefaultSshCommands: false,
        sshCommands: deviceCommands,
      }),
    ]);
  });

  it('keeps script-backed SSH commands when no shell command is configured', async () => {
    const devices: EmbeddedDevice[] = [
      {
        id: 'device-a',
        name: 'Device A',
        host: '10.0.0.1',
        username: 'root',
        sshCommands: scriptCommands,
      },
    ];

    await workspace.getConfiguration('embeddedLogger').update('devices', devices);

    const { devices: resolvedDevices } = getEmbeddedLoggerConfiguration();

    expect(resolvedDevices).toEqual([
      expect.objectContaining({
        id: 'device-a',
        sshCommands: scriptCommands,
      }),
    ]);
  });

  it('resolves ping settings with optional interval', async () => {
    await workspace.getConfiguration('embeddedLogger').update('enableDevicePing', true);
    await workspace.getConfiguration('embeddedLogger').update('devicePingIntervalSeconds', 15);

    const config = getEmbeddedLoggerConfiguration();

    expect(config.enableDevicePing).toBe(true);
    expect(config.devicePingIntervalSeconds).toBe(15);
  });

  it('normalizes groups, device defaults, SFTP presets, and SSH command definitions', async () => {
    await workspace
      .getConfiguration('embeddedLogger')
      .update('groups', [{ name: ' Lab ' }, { name: '' }, { name: 'Field' }]);
    await workspace.getConfiguration('embeddedLogger').update('defaultPort', 2022);
    await workspace.getConfiguration('embeddedLogger').update('defaultLogCommand', '');
    await workspace.getConfiguration('embeddedLogger').update('defaultSshCommands', [
      null,
      { name: ' ' },
      { name: 'No command' },
      { name: 'Invalid script', copyAndRunScript: true, script: ' ' },
      {
        name: ' Shared ',
        command: ' uptime ',
        openSshPanel: true,
        rerunOnReconnection: true,
      },
    ]);
    await workspace.getConfiguration('embeddedLogger').update('devices', [
      {
        id: 'device-a',
        name: 'Device A',
        host: '10.0.0.1',
        username: 'root',
        webBrowserUrl: ' ',
        sftpPresetsRemote: [' /var/log ', '', '/tmp'],
        sftpPresetsLocal: 'not-array',
        sshCommands: [
          { name: 'Device command', command: ' journalctl -f ' },
          { name: 'Script', copyAndRunScript: true, script: '#!/bin/sh\necho ok\n' },
        ],
        bastion: {
          host: 'jump.local',
          username: 'jump',
        },
      },
    ] satisfies EmbeddedDevice[]);

    const config = getEmbeddedLoggerConfiguration();

    expect(getEmbeddedLoggerGroups()).toEqual([{ name: 'Lab' }, { name: 'Field' }]);
    expect(config.devices[0]).toEqual(
      expect.objectContaining({
        port: 2022,
        logCommand: 'tail -F /var/log/syslog',
        webBrowserUrl: undefined,
        sftpPresetsRemote: ['/var/log', '/tmp'],
        sftpPresetsLocal: [],
        bastion: expect.objectContaining({ port: 2022 }),
        sshCommands: [
          {
            name: 'Shared',
            command: 'uptime',
            openSshPanel: true,
            rerunOnReconnection: true,
            copyAndRunScript: undefined,
            script: undefined,
          },
          {
            name: 'Device command',
            command: 'journalctl -f',
            openSshPanel: undefined,
            rerunOnReconnection: undefined,
            copyAndRunScript: undefined,
            script: undefined,
          },
          {
            name: 'Script',
            command: undefined,
            openSshPanel: undefined,
            rerunOnReconnection: undefined,
            copyAndRunScript: true,
            script: '#!/bin/sh\necho ok\n',
          },
        ],
      })
    );
  });

  it('sanitizes and merges SFTP presets with duplicate and limit handling', () => {
    expect(sanitizeSftpPresets('not-array')).toEqual([]);
    expect(
      mergeSftpPresets(
        ['/one', ' /two '],
        ['/two', '/three', '/four', '/five', '/six', '/seven', '/eight', '/nine', '/ten', '/eleven']
      )
    ).toEqual([
      '/one',
      '/two',
      '/three',
      '/four',
      '/five',
      '/six',
      '/seven',
      '/eight',
      '/nine',
      '/ten',
    ]);
  });

  it('updates a configured device by trimmed id and returns undefined for misses', async () => {
    await workspace.getConfiguration('embeddedLogger').update('devices', [
      {
        id: ' device-a ',
        name: 'Device A',
        host: '10.0.0.1',
        username: 'root',
      },
      {
        id: 'device-b',
        name: 'Device B',
        host: '10.0.0.2',
        username: 'root',
      },
    ] satisfies EmbeddedDevice[]);

    await expect(
      updateEmbeddedLoggerDeviceConfiguration('', (device) => device)
    ).resolves.toBeUndefined();
    await expect(
      updateEmbeddedLoggerDeviceConfiguration('missing', (device) => device)
    ).resolves.toBeUndefined();

    const updated = await updateEmbeddedLoggerDeviceConfiguration('device-a', (entry) => ({
      ...entry,
      name: 'Updated Device A',
    }));

    expect(updated).toEqual(expect.objectContaining({ name: 'Updated Device A' }));
    expect(workspace.getConfiguration('embeddedLogger').get('devices', [])).toEqual([
      expect.objectContaining({ id: ' device-a ', name: 'Updated Device A' }),
      expect.objectContaining({ id: 'device-b', name: 'Device B' }),
    ]);
  });
});
