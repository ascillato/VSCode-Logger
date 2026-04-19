import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

const { readFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: readFileMock,
}));

import type { BastionConfig, EmbeddedDevice } from '../../src/deviceTree';
import { AuthenticationProvider } from '../../src/logSession/authenticationProvider';
import { createExtensionContext } from '../mocks/vscode';

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'Device One',
  host: 'device.local',
  username: 'root',
};

beforeEach(() => {
  readFileMock.mockReset();
});

describe('AuthenticationProvider', () => {
  it('loads a device private key from an expanded path and resolves the passphrase', async () => {
    const context = createExtensionContext();
    const passwordManager = {
      getPassphrase: vi.fn(async () => 'key-passphrase'),
      getPassword: vi.fn(),
    };
    readFileMock.mockResolvedValue(Buffer.from('PRIVATE KEY DATA'));
    const provider = new AuthenticationProvider(
      {
        ...baseDevice,
        privateKeyPath: '~/${env:USER}/.ssh/id_device',
      },
      context,
      {
        passwordManager: passwordManager as never,
      }
    );

    const auth = await provider.getDeviceAuthentication();

    expect(readFileMock).toHaveBeenCalledWith(
      path.resolve(path.join(os.homedir(), process.env.USER ?? '', '.ssh/id_device'))
    );
    expect(passwordManager.getPassphrase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'device-1' }),
      expect.objectContaining({ onPrompt: undefined })
    );
    expect(auth).toEqual({
      privateKey: Buffer.from('PRIVATE KEY DATA'),
      passphrase: 'key-passphrase',
    });
  });

  it('requests a device password when no private key is configured', async () => {
    const context = createExtensionContext();
    const passwordManager = {
      getPassword: vi.fn(async () => 'device-password'),
      getPassphrase: vi.fn(),
    };
    const onPrompt = vi.fn();
    const provider = new AuthenticationProvider(baseDevice, context, {
      passwordManager: passwordManager as never,
      onPrompt,
    });

    const auth = await provider.getDeviceAuthentication();

    expect(passwordManager.getPassword).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'device-1' }),
      { onPrompt }
    );
    expect(auth).toEqual({ password: 'device-password' });
  });

  it('throws when device authentication has neither private key nor password', async () => {
    const context = createExtensionContext();
    const provider = new AuthenticationProvider(baseDevice, context, {
      passwordManager: {
        getPassword: vi.fn(async () => undefined),
        getPassphrase: vi.fn(),
      } as never,
    });

    await expect(provider.getDeviceAuthentication()).rejects.toThrow(
      'Password or private key is required to connect to the device.'
    );
  });

  it('normalizes bastion configuration and resolves bastion key authentication', async () => {
    const context = createExtensionContext();
    const passwordManager = {
      getPassphrase: vi.fn(async () => 'bastion-passphrase'),
      getPassword: vi.fn(),
    };
    readFileMock.mockResolvedValue(Buffer.from('BASTION KEY DATA'));
    const provider = new AuthenticationProvider(
      {
        ...baseDevice,
        bastion: {
          host: ' bastion.local ',
          username: ' jump ',
          port: undefined,
          hostFingerprint: ' SHA256:test ',
          privateKeyPath: ' ~/.ssh/id_jump ',
        },
      },
      context,
      {
        passwordManager: passwordManager as never,
      }
    );

    const bastion = provider.getBastionConfig();
    const auth = await provider.getBastionAuthentication(bastion as BastionConfig);

    expect(bastion).toEqual({
      host: 'bastion.local',
      username: 'jump',
      port: 22,
      hostFingerprint: 'SHA256:test',
      privateKeyPath: '~/.ssh/id_jump',
    });
    expect(readFileMock).toHaveBeenCalledWith(
      path.resolve(path.join(os.homedir(), '.ssh/id_jump'))
    );
    expect(passwordManager.getPassphrase).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'device-1-bastion',
        name: 'Device One bastion',
        host: 'bastion.local',
        username: 'jump',
      }),
      expect.objectContaining({ onPrompt: undefined })
    );
    expect(auth).toEqual({
      privateKey: Buffer.from('BASTION KEY DATA'),
      passphrase: 'bastion-passphrase',
    });
  });

  it('returns undefined for incomplete bastion settings and throws on unreadable key files', async () => {
    const context = createExtensionContext();
    const incompleteProvider = new AuthenticationProvider(
      {
        ...baseDevice,
        bastion: {
          host: ' ',
          username: 'jump',
        },
      },
      context,
      {
        passwordManager: {
          getPassword: vi.fn(),
          getPassphrase: vi.fn(),
        } as never,
      }
    );

    expect(incompleteProvider.getBastionConfig()).toBeUndefined();

    readFileMock.mockRejectedValue(new Error('ENOENT'));
    const brokenProvider = new AuthenticationProvider(
      {
        ...baseDevice,
        privateKeyPath: '~/.ssh/missing',
      },
      context,
      {
        passwordManager: {
          getPassword: vi.fn(),
          getPassphrase: vi.fn(async () => undefined),
        } as never,
      }
    );

    await expect(brokenProvider.getDeviceAuthentication()).rejects.toThrow(
      `Failed to read private key from ${path.resolve(path.join(os.homedir(), '.ssh/missing'))}: ENOENT`
    );
  });

  it('resolves bastion password authentication and rejects missing bastion passwords', async () => {
    const context = createExtensionContext();
    const bastion: BastionConfig = {
      host: 'jump.local',
      username: 'jump',
    };
    const passwordManager = {
      getPassword: vi.fn(async () => 'jump-password'),
      getPassphrase: vi.fn(),
    };
    const provider = new AuthenticationProvider(baseDevice, context, {
      passwordManager: passwordManager as never,
    });

    await expect(provider.getBastionAuthentication(bastion)).resolves.toEqual({
      password: 'jump-password',
    });
    expect(passwordManager.getPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'device-1-bastion',
        host: 'jump.local',
        username: 'jump',
      }),
      expect.objectContaining({ onPrompt: undefined })
    );

    const missingProvider = new AuthenticationProvider(baseDevice, context, {
      passwordManager: {
        getPassword: vi.fn(async () => ''),
        getPassphrase: vi.fn(),
      } as never,
    });

    await expect(missingProvider.getBastionAuthentication(bastion)).rejects.toThrow(
      'Password or private key is required to connect to the bastion host.'
    );
  });

  it('returns undefined passphrases for blank key prompts and wraps empty key files', async () => {
    const context = createExtensionContext();
    const passwordManager = {
      getPassphrase: vi.fn(async () => ''),
      getPassword: vi.fn(),
    };
    readFileMock.mockResolvedValueOnce(Buffer.from('KEY DATA'));
    const provider = new AuthenticationProvider(
      {
        ...baseDevice,
        privateKeyPath: '${env:MISSING_AUTH_KEY_DIR}/id_device',
      },
      context,
      {
        passwordManager: passwordManager as never,
      }
    );

    await expect(provider.getDeviceAuthentication()).resolves.toEqual({
      privateKey: Buffer.from('KEY DATA'),
      passphrase: undefined,
    });
    expect(readFileMock).toHaveBeenCalledWith(path.resolve('/id_device'));

    readFileMock.mockResolvedValueOnce(Buffer.alloc(0));
    await expect(provider.getDeviceAuthentication()).rejects.toThrow(
      'The private key file is empty.'
    );
  });
});
