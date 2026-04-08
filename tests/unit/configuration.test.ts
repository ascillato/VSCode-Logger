import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import { getEmbeddedLoggerConfiguration } from '../../src/configuration';
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
});
