import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { activate } from '../../src/extension';
import {
  createExtensionContext,
  resetWorkspaceConfiguration,
  resetWorkspaceState,
  resetWindowResponses,
  workspace,
} from '../mocks/vscode';

const device: EmbeddedDevice = {
  id: 'device-a',
  name: 'Device A',
  host: '10.0.0.10',
  username: 'root',
};

beforeEach(() => {
  resetWorkspaceConfiguration();
  resetWorkspaceState();
  resetWindowResponses();
});

afterEach(() => {
  resetWorkspaceConfiguration();
  resetWorkspaceState();
  resetWindowResponses();
});

describe('SFTP preset migration', () => {
  it('moves workspace-state SFTP presets into embeddedLogger.devices', async () => {
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
    const context = createExtensionContext();

    await context.workspaceState.update('embeddedLogger.sftpPresets.device-a', [
      ' /var/log ',
      '/opt/app',
    ]);
    await context.workspaceState.update('embeddedLogger.sftpPresets.local.device-a', [
      '',
      '/tmp/downloads',
      ' /work/tree ',
    ]);

    await activate(context);

    expect(workspace.getConfiguration('embeddedLogger').get('devices', [])).toEqual([
      expect.objectContaining({
        id: 'device-a',
        sftpPresetsRemote: ['/var/log', '/opt/app'],
        sftpPresetsLocal: ['/tmp/downloads', '/work/tree'],
      }),
    ]);
    expect(context.workspaceState.get('embeddedLogger.sftpPresets.device-a')).toBeUndefined();
    expect(context.workspaceState.get('embeddedLogger.sftpPresets.local.device-a')).toBeUndefined();
  });
});
