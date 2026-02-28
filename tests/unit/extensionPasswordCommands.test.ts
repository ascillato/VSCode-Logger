import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { activate } from '../../src/extension';
import { PasswordManager } from '../../src/passwordManager';
import {
  commands,
  createExtensionContext,
  getStoredSecrets,
  resetWorkspaceConfiguration,
  resetWindowResponses,
  window,
  workspace,
} from '../mocks/vscode';

type CommandHandler = (...args: unknown[]) => unknown;

const devices: EmbeddedDevice[] = [
  {
    id: 'device-a',
    name: 'Device A',
    host: '10.0.0.10',
    username: 'root',
  },
  {
    id: 'device-b',
    name: 'Device B',
    host: '10.0.0.11',
    username: 'root',
  },
];

const metadataKeysFor = (deviceId: string): [string, string] => [
  `embeddedLogger.passwordMetadata.${deviceId}`,
  `embeddedLogger.passphraseMetadata.${deviceId}`,
];

const bastionDeviceFor = (device: EmbeddedDevice): EmbeddedDevice => ({
  id: `${device.id}-bastion`,
  name: `${device.name} bastion`,
  host: `${device.host}-bastion`,
  username: 'jump',
});

const getClearStoredPasswordsHandler = (): CommandHandler => {
  const registrations = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
  const registration = registrations.find(
    (call) => call[0] === 'embeddedLogger.clearStoredPasswords'
  );
  if (!registration) {
    throw new Error('embeddedLogger.clearStoredPasswords command was not registered');
  }
  return registration[1] as CommandHandler;
};

const hasMetadata = (keys: string[], deviceId: string): boolean => {
  const [passwordMetadata, passphraseMetadata] = metadataKeysFor(deviceId);
  return keys.includes(passwordMetadata) || keys.includes(passphraseMetadata);
};

const storeCredentials = async (
  passwordManager: PasswordManager,
  device: EmbeddedDevice
): Promise<void> => {
  await passwordManager.storePassword(device, `password-${device.id}`);
  await passwordManager.storePassphrase(device, `passphrase-${device.id}`);
};

afterEach(() => {
  resetWorkspaceConfiguration();
  resetWindowResponses();
});

describe('clearStoredPasswords command', () => {
  it('resets credentials per device (including bastion) without affecting others', async () => {
    await workspace.getConfiguration('embeddedLogger').update('devices', devices);
    const context = createExtensionContext();
    await activate(context);

    const command = getClearStoredPasswordsHandler();
    const passwordManager = new PasswordManager(context);
    const bastionA = bastionDeviceFor(devices[0]);
    const bastionB = bastionDeviceFor(devices[1]);

    await storeCredentials(passwordManager, devices[0]);
    await storeCredentials(passwordManager, bastionA);
    await storeCredentials(passwordManager, devices[1]);
    await storeCredentials(passwordManager, bastionB);
    (window.showInformationMessage as ReturnType<typeof vi.fn>).mockClear();

    await command(devices[0].id);

    let keys = getStoredSecrets(context).map((entry) => entry.key);
    expect(hasMetadata(keys, devices[0].id)).toBe(false);
    expect(hasMetadata(keys, bastionA.id)).toBe(false);
    expect(hasMetadata(keys, devices[1].id)).toBe(true);
    expect(hasMetadata(keys, bastionB.id)).toBe(true);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Stored passwords and passphrases have been removed for Device A.'
    );

    await command({ id: devices[1].id });

    keys = getStoredSecrets(context).map((entry) => entry.key);
    expect(hasMetadata(keys, devices[1].id)).toBe(false);
    expect(hasMetadata(keys, bastionB.id)).toBe(false);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Stored passwords and passphrases have been removed for Device B.'
    );
  });

  it('resets credentials for all configured devices', async () => {
    await workspace.getConfiguration('embeddedLogger').update('devices', devices);
    const context = createExtensionContext();
    await activate(context);

    const command = getClearStoredPasswordsHandler();
    const passwordManager = new PasswordManager(context);
    const allIds = [
      devices[0].id,
      bastionDeviceFor(devices[0]).id,
      devices[1].id,
      bastionDeviceFor(devices[1]).id,
    ];

    await Promise.all([
      storeCredentials(passwordManager, devices[0]),
      storeCredentials(passwordManager, bastionDeviceFor(devices[0])),
      storeCredentials(passwordManager, devices[1]),
      storeCredentials(passwordManager, bastionDeviceFor(devices[1])),
    ]);
    (window.showInformationMessage as ReturnType<typeof vi.fn>).mockClear();

    await command();

    const keys = getStoredSecrets(context).map((entry) => entry.key);
    allIds.forEach((deviceId) => {
      expect(hasMetadata(keys, deviceId)).toBe(false);
    });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Stored passwords and passphrases have been removed for configured devices.'
    );
  });

  it('shows an info message when no devices are configured', async () => {
    await workspace.getConfiguration('embeddedLogger').update('devices', []);
    const context = createExtensionContext();
    await activate(context);

    const command = getClearStoredPasswordsHandler();
    (window.showInformationMessage as ReturnType<typeof vi.fn>).mockClear();

    await command();

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'No devices configured to clear passwords for.'
    );
  });
});
