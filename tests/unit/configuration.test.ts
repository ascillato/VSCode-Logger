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

beforeEach(() => {
  resetWorkspaceConfiguration();
});

describe('configuration', () => {
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
});
