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
});
