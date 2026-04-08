import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { FingerprintPersistence } from '../../src/logSession/fingerprintPersistence';
import {
  ConfigurationTarget,
  createExtensionContext,
  resetWorkspaceConfiguration,
  workspace,
} from '../mocks/vscode';

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'Persisted Device',
  host: 'device.local',
  username: 'root',
  bastion: {
    host: 'bastion.local',
    username: 'jump',
  },
};

describe('FingerprintPersistence', () => {
  it('persists missing primary and bastion fingerprints to config and local state', async () => {
    resetWorkspaceConfiguration();
    await workspace.getConfiguration('embeddedLogger').update('devices', [{ ...baseDevice }]);
    const updateSpy = vi.spyOn(workspace.getConfiguration('embeddedLogger'), 'update');
    const device = { ...baseDevice };
    const persistence = new FingerprintPersistence(
      device,
      createExtensionContext(),
      () => device.bastion
    );
    const endpoint = { host: 'device.local', label: 'primary' as const };

    await persistence.persistIfMissing(endpoint, { display: 'SHA256:primary', hex: '1111' });

    expect(updateSpy).toHaveBeenCalledWith(
      'devices',
      [
        expect.objectContaining({
          id: 'device-1',
          hostFingerprint: 'SHA256:primary',
        }),
      ],
      ConfigurationTarget.Workspace
    );
    expect(device.hostFingerprint).toBe('SHA256:primary');
    expect(endpoint.fingerprint).toBe('SHA256:primary');

    const bastionEndpoint = { host: 'bastion.local', label: 'bastion' as const };
    await persistence.updateDeviceHostFingerprint('SHA256:bastion', bastionEndpoint);

    expect(device.bastion).toEqual(
      expect.objectContaining({
        host: 'bastion.local',
        hostFingerprint: 'SHA256:bastion',
      })
    );
  });

  it('updates secondary fingerprints and adds the device when it is missing from configuration', async () => {
    resetWorkspaceConfiguration();
    await workspace.getConfiguration('embeddedLogger').update('devices', []);
    const device = {
      ...baseDevice,
      secondaryHost: 'backup.local',
    };
    const persistence = new FingerprintPersistence(
      device,
      createExtensionContext(),
      () => device.bastion
    );
    const endpoint = {
      host: 'backup.local',
      label: 'secondary' as const,
    };

    await persistence.updateDeviceHostFingerprint('SHA256:secondary', endpoint);

    expect(workspace.getConfiguration('embeddedLogger').get('devices', [])).toEqual([
      expect.objectContaining({
        id: 'device-1',
        secondaryHostFingerprint: 'SHA256:secondary',
      }),
    ]);
    expect(device.secondaryHostFingerprint).toBe('SHA256:secondary');
    expect(endpoint.fingerprint).toBe('SHA256:secondary');
  });

  it('does nothing when persistence prerequisites are not met', async () => {
    resetWorkspaceConfiguration();
    const device = { ...baseDevice, hostFingerprint: 'SHA256:existing' };
    const persistence = new FingerprintPersistence(
      device,
      createExtensionContext(),
      () => device.bastion
    );
    const updateSpy = vi.spyOn(workspace.getConfiguration('embeddedLogger'), 'update');
    updateSpy.mockClear();

    await persistence.persistIfMissing(undefined, { display: 'SHA256:new', hex: '1111' });
    await persistence.persistIfMissing(
      { host: 'device.local', label: 'primary', fingerprint: 'SHA256:configured' },
      { display: 'SHA256:new', hex: '1111' }
    );
    await persistence.persistIfMissing({ host: 'device.local', label: 'primary' }, undefined);

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
