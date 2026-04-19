import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { PasswordManager } from '../../src/passwordManager';
import {
  computeHash,
  createExtensionContext,
  getStoredSecrets,
  resetWindowResponses,
  resetWorkspaceConfiguration,
  setInputBoxResponse,
  setWarningMessageResponse,
  window,
  workspace,
} from '../mocks/vscode';

const device: EmbeddedDevice = {
  id: 'device-1',
  name: 'Test Device',
  host: '10.0.0.2',
  username: 'root',
};
const derivedPasswordKeyPattern = /^embeddedLogger\.password\.device-1\.version-1\.[0-9a-f]{64}$/;
const derivedWorkspaceKeyPattern = /^version-1\.[0-9a-f]{64}$/;

const buildLegacyScopedKey = (
  prefix: string,
  candidate: EmbeddedDevice,
  workspaceSource = 'file:///workspace'
): string =>
  `${prefix}${candidate.id}.${computeHash(workspaceSource)}.${computeHash(
    candidate.host.trim().toLowerCase()
  )}.${computeHash(candidate.username.trim())}`;

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

    const secretEntry = getStoredSecrets(context).find((entry) => entry.value === 'super-secret');
    expect(secretEntry?.key).toMatch(derivedPasswordKeyPattern);
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

  it('migrates legacy SHA-256 scoped secrets into the derived key format', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);
    const legacyScopedKey = buildLegacyScopedKey('embeddedLogger.password.', device);

    await context.secrets.store(legacyScopedKey, 'legacy-scoped-secret');

    const password = await manager.getPassword(device);

    expect(password).toBe('legacy-scoped-secret');
    expect(window.showInputBox).not.toHaveBeenCalled();
    expect(window.showWarningMessage).not.toHaveBeenCalled();

    const secrets = getStoredSecrets(context);
    const keys = secrets.map((entry) => entry.key);
    const migrated = secrets.find((entry) => entry.value === 'legacy-scoped-secret');
    const metadata = secrets.find(
      (entry) => entry.key === 'embeddedLogger.passwordMetadata.device-1'
    );

    expect(keys).not.toContain(legacyScopedKey);
    expect(migrated?.key).toMatch(derivedPasswordKeyPattern);
    expect(JSON.parse(metadata?.value ?? '{}')).toMatchObject({
      key: migrated?.key,
      workspaceId: expect.stringMatching(derivedWorkspaceKeyPattern),
    });
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

  it('handles declined legacy reuse, cancelled prompts, and malformed metadata', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);

    await context.secrets.store('embeddedLogger.password.device-1', 'legacy-secret');
    setWarningMessageResponse('Enter a new password');
    await expect(manager.getPassword(device)).resolves.toBeUndefined();
    expect(getStoredSecrets(context).map((entry) => entry.key)).toContain(
      'embeddedLogger.password.device-1'
    );

    await context.secrets.store(
      'embeddedLogger.passwordMetadata.device-1',
      JSON.stringify({
        key: 'some-key',
        host: device.host,
        username: device.username,
      })
    );
    await expect(manager.getPassword(device)).resolves.toBeUndefined();

    const onPrompt = vi.fn();
    await expect(
      manager.getPassword({ ...device, id: 'new-device' }, { onPrompt })
    ).resolves.toBeUndefined();
    expect(onPrompt).toHaveBeenCalledOnce();
  });

  it('clears metadata-backed secrets and supports workspace-file scoped keys', async () => {
    const context = createExtensionContext();
    const manager = new PasswordManager(context);
    const originalWorkspaceFile = workspace.workspaceFile;
    const originalWorkspaceFolders = workspace.workspaceFolders;
    const originalName = workspace.name;

    workspace.workspaceFile = {
      fsPath: '/workspace/project.code-workspace',
      toString: () => 'file:///workspace/project.code-workspace',
    } as never;
    workspace.workspaceFolders = undefined;
    workspace.name = undefined;

    try {
      await manager.storePassword(device, 'workspace-file-secret');
      const storedBeforeClear = getStoredSecrets(context);
      const secretKey = storedBeforeClear.find(
        (entry) => entry.value === 'workspace-file-secret'
      )?.key;
      expect(secretKey).toMatch(derivedPasswordKeyPattern);

      await context.secrets.store('embeddedLogger.passphrase.device-1', 'legacy-passphrase');
      await manager.clearPassword(device.id);

      const keys = getStoredSecrets(context).map((entry) => entry.key);
      expect(keys).not.toContain(secretKey);
      expect(keys).not.toContain('embeddedLogger.passwordMetadata.device-1');
      expect(keys).not.toContain('embeddedLogger.passphrase.device-1');
      expect(keys).not.toContain('embeddedLogger.passphraseMetadata.device-1');
    } finally {
      workspace.workspaceFile = originalWorkspaceFile;
      workspace.workspaceFolders = originalWorkspaceFolders;
      workspace.name = originalName;
    }
  });
});
