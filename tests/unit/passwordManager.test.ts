import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { PasswordManager } from '../../src/passwordManager';
import {
  createExtensionContext,
  getStoredSecrets,
  resetWindowResponses,
  resetWorkspaceConfiguration,
  setInputBoxResponse,
  setWarningMessageResponse,
  window,
} from '../mocks/vscode';

const device: EmbeddedDevice = {
  id: 'device-1',
  name: 'Test Device',
  host: '10.0.0.2',
  username: 'root',
};

afterEach(() => {
  resetWindowResponses();
  resetWorkspaceConfiguration();
});

describe('PasswordManager', () => {
  it('stores and retrieves passwords without prompting when already cached', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);

    await manager.storePassword(device, 'super-secret');
    const password = await manager.getPassword(device);

    expect(password).toBe('super-secret');
    expect(window.showInputBox).not.toHaveBeenCalled();
  });

  it('migrates secrets when user confirms reuse', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);
    const legacyKey = 'embeddedLogger.password.device-1';

    await context.secrets.store(legacyKey, 'legacy-secret');
    setWarningMessageResponse('Reuse saved password');

    const password = await manager.getPassword(device);

    expect(password).toBe('legacy-secret');
    const secrets = getStoredSecrets(context);
    const keys = secrets.map((entry) => entry.key);
    expect(keys).not.toContain(legacyKey);
    expect(keys.length).toBe(2); // password + metadata
  });

  it('prompts the user when no stored password exists', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);

    setInputBoxResponse('typed-secret');

    const password = await manager.getPassword(device);

    expect(password).toBe('typed-secret');
    expect(window.showInputBox).toHaveBeenCalledTimes(1);
  });

  it('reuses a stored password for a changed host only when the user confirms', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);

    await manager.storePassword(device, 'original-secret');

    const movedDevice: EmbeddedDevice = {
      ...device,
      host: '10.0.0.99',
    };

    setWarningMessageResponse('Enter a new password');
    await expect(manager.getPassword(movedDevice)).resolves.toBeUndefined();

    setWarningMessageResponse('Reuse saved password');
    await expect(manager.getPassword(movedDevice)).resolves.toBe('original-secret');
  });

  it('ignores missing and invalid metadata before prompting for a new password', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);

    await context.secrets.store(
      'embeddedLogger.passwordMetadata.device-1',
      JSON.stringify({
        key: 'missing-secret',
        host: device.host,
        username: device.username,
        workspaceId: 'x',
      })
    );

    await expect(manager.getPassword(device)).resolves.toBeUndefined();

    await context.secrets.store('embeddedLogger.passwordMetadata.device-1', '{not-json');
    setInputBoxResponse('replacement');

    await expect(manager.getPassword(device)).resolves.toBe('replacement');
  });

  it('stores, retrieves, and reuses passphrases independently from passwords', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);

    await manager.storePassphrase(device, 'key-secret');
    await expect(manager.getPassphrase(device)).resolves.toBe('key-secret');

    const renamedUser: EmbeddedDevice = {
      ...device,
      username: 'admin',
    };

    setWarningMessageResponse('Reuse saved passphrase');
    await expect(manager.getPassphrase(renamedUser)).resolves.toBe('key-secret');
  });
});
