import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/passwordManager', () => ({
  PasswordManager: class {
    getPassword = vi.fn(async () => 'mock-password');
    getPassphrase = vi.fn(async () => undefined);
  },
}));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { LogSession } from '../../src/logSession';
import { ConnectionManager } from '../../src/logSession/connectionManager';
import { HostKeyMismatchError } from '../../src/logSession/errors';
import {
  createExtensionContext,
  resetWorkspaceConfiguration,
  setWarningMessageResponse,
  workspace,
} from '../mocks/vscode';
import { MockSshChannel } from '../mocks/ssh';

const mockFingerprint = (): string => {
  const digest = createHash('sha256').update(Buffer.from('mock-host-key')).digest('base64');
  return `SHA256:${digest}`;
};

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'Primary Device',
  host: 'primary.example.com',
  username: 'root',
  secondaryHost: 'backup.example.com',
};

beforeEach(() => {
  resetWorkspaceConfiguration();
  setWarningMessageResponse(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LogSession (unit)', () => {
  it('prompts to update fingerprints on mismatches and retries successfully', async () => {
    const context = createExtensionContext();
    const statuses: string[] = [];
    const lines: string[] = [];
    const onMismatch = vi.fn();
    const device: EmbeddedDevice = {
      ...baseDevice,
      hostFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    };

    setWarningMessageResponse('Update fingerprint and connect');

    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');
    const stream = new MockSshChannel();
    const requestedFingerprints: Array<string | undefined> = [];

    connectSpy.mockImplementationOnce(async (request) => {
      requestedFingerprints.push(request.endpoint.fingerprint);
      onMismatch({ expected: 'expected-value', received: mockFingerprint() });
      throw new HostKeyMismatchError(
        'Mismatch',
        'expected-value',
        mockFingerprint(),
        request.endpoint
      );
    });
    connectSpy.mockImplementationOnce(async (request) => {
      requestedFingerprints.push(request.endpoint.fingerprint);
      statuses.push('Connected. Streaming logs...');
      setTimeout(() => {
        stream.emitData('line one\n');
        stream.emitClose();
      });
      return {
        client: { end: vi.fn() } as unknown as object,
        stream,
      };
    });

    const session = new LogSession(device, context, {
      onLine: (line) => lines.push(line),
      onStatus: (message) => statuses.push(message),
      onError: (message) => statuses.push(`error:${message}`),
      onClose: () => statuses.push('closed'),
      onHostKeyMismatch: onMismatch,
    });

    await session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const devices = workspace
      .getConfiguration('embeddedLogger')
      .get<EmbeddedDevice[]>('devices', []);
    expect(devices.find((entry) => entry.id === device.id)?.hostFingerprint).toBe(
      mockFingerprint()
    );
    expect(requestedFingerprints).toEqual([
      'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      mockFingerprint(),
    ]);
    expect(onMismatch).toHaveBeenCalled();
    expect(lines).toEqual(['line one']);
    expect(statuses.some((status) => status.includes('Streaming logs'))).toBe(true);
    expect(statuses).toContain('closed');
  });

  it('falls back to the secondary endpoint when primary fingerprint is rejected', async () => {
    const context = createExtensionContext();
    const statuses: string[] = [];
    const lines: string[] = [];
    const attemptedHosts: string[] = [];
    const onMismatch = vi.fn();
    const device: EmbeddedDevice = {
      ...baseDevice,
      hostFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      secondaryHostFingerprint: undefined,
    };

    setWarningMessageResponse('Stop connection');

    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');
    const stream = new MockSshChannel();

    connectSpy.mockImplementationOnce(async () => {
      attemptedHosts.push(device.host);
      onMismatch({ expected: 'expected', received: 'received' });
      throw new HostKeyMismatchError('Mismatch', 'expected', 'received', {
        host: device.host,
        label: 'primary',
      });
    });
    connectSpy.mockImplementationOnce(async (request) => {
      attemptedHosts.push(request.endpoint.host);
      setTimeout(() => {
        stream.emitData('secondary ok\n');
        stream.emitClose();
      });
      statuses.push('Connected. Streaming logs...');
      return { client: { end: vi.fn() } as unknown as object, stream };
    });

    const session = new LogSession(device, context, {
      onLine: (line) => lines.push(line),
      onStatus: (message) => statuses.push(message),
      onError: (message) => statuses.push(`error:${message}`),
      onClose: () => statuses.push('closed'),
      onHostKeyMismatch: onMismatch,
    });

    await session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onMismatch).toHaveBeenCalled();
    expect(attemptedHosts).toContain('primary.example.com');
    expect(attemptedHosts).toContain('backup.example.com');
    expect(lines).toEqual(['secondary ok']);
    expect(statuses.some((status) => status.includes('Streaming logs'))).toBe(true);
  });

  it('prefers the last successful endpoint host on a new reconnect attempt', async () => {
    const context = createExtensionContext();
    const attemptedHosts: string[] = [];
    const statuses: string[] = [];
    const lines: string[] = [];
    const stream = new MockSshChannel();

    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');
    connectSpy.mockImplementationOnce(async (request) => {
      attemptedHosts.push(request.endpoint.host);
      throw new Error('secondary unavailable');
    });
    connectSpy.mockImplementationOnce(async (request) => {
      attemptedHosts.push(request.endpoint.host);
      setTimeout(() => {
        stream.emitData('primary ok\n');
        stream.emitClose();
      });
      statuses.push('Connected. Streaming logs...');
      return {
        client: { end: vi.fn() } as unknown as object,
        stream,
      };
    });

    const session = new LogSession(
      baseDevice,
      context,
      {
        onLine: (line) => lines.push(line),
        onStatus: (message) => statuses.push(message),
        onError: (message) => statuses.push(`error:${message}`),
        onClose: () => statuses.push('closed'),
      },
      {
        preferredEndpointHost: 'backup.example.com',
      }
    );

    await session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(attemptedHosts).toEqual(['backup.example.com', 'primary.example.com']);
    expect(lines).toEqual(['primary ok']);
    expect(statuses.some((status) => status.includes('Streaming logs'))).toBe(true);
  });

  it('reports configuration and log-command validation errors without connecting', async () => {
    const context = createExtensionContext();
    const errors: string[] = [];
    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');

    const missingHostSession = new LogSession({ ...baseDevice, host: ' ' }, context, {
      onLine: vi.fn(),
      onStatus: vi.fn(),
      onError: (message) => errors.push(message),
      onClose: vi.fn(),
    });

    await missingHostSession.start();

    const badCommandSession = new LogSession(
      { ...baseDevice, logCommand: 'tail -f\nwhoami' },
      context,
      {
        onLine: vi.fn(),
        onStatus: vi.fn(),
        onError: (message) => errors.push(message),
        onClose: vi.fn(),
      }
    );

    await badCommandSession.start();

    expect(errors).toContain('Device "Primary Device" is missing a host.');
    expect(errors).toContain('Log command must not contain control characters or new lines.');
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('buffers partial stream data, forwards stderr, and notifies close once', async () => {
    const context = createExtensionContext();
    const stream = new MockSshChannel();
    const lines: string[] = [];
    const errors: string[] = [];
    const closes = vi.fn();
    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');
    connectSpy.mockImplementationOnce(async (request) => {
      request.onStreamReady?.(stream as never);
      return { client: { end: vi.fn() } as unknown as object, stream };
    });

    const session = new LogSession(baseDevice, context, {
      onLine: (line) => lines.push(line),
      onStatus: vi.fn(),
      onError: (message) => errors.push(message),
      onClose: closes,
    });

    await session.start();

    stream.emitData('first');
    stream.emitData(' line\nsecond line\npartial');
    stream.emitStderr('stderr text');
    stream.emitClose();
    stream.emitClose();

    expect(lines).toEqual(['first line', 'second line']);
    expect(errors).toEqual(['stderr text']);
    expect(closes).toHaveBeenCalledOnce();
  });

  it('does not notify webview callbacks after disposal', async () => {
    const context = createExtensionContext();
    const stream = new MockSshChannel();
    const clientEnd = vi.fn();
    const streamClose = vi.fn();
    Object.assign(stream, { close: streamClose });
    vi.spyOn(ConnectionManager.prototype, 'connect').mockImplementationOnce(async (request) => {
      request.onStreamReady?.(stream as never);
      return { client: { end: clientEnd } as unknown as object, stream };
    });
    const callbacks = {
      onLine: vi.fn(),
      onStatus: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const session = new LogSession(baseDevice, context, callbacks);

    await session.start();
    session.dispose();
    stream.emitData('ignored\n');
    stream.emitStderr('ignored error');
    stream.emitClose();

    expect(streamClose).toHaveBeenCalled();
    expect(clientEnd).toHaveBeenCalled();
    expect(callbacks.onLine).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it('uses bastion authentication and validates bastion fields', async () => {
    const context = createExtensionContext();
    const authProvider = {
      getDeviceAuthentication: vi.fn(async () => ({ password: 'device-secret' })),
      getBastionConfig: vi.fn(() => ({ host: ' ', username: 'jump' })),
      getBastionAuthentication: vi.fn(async () => ({ password: 'jump-secret' })),
    };
    const errors: string[] = [];

    const invalidBastionSession = new LogSession(
      baseDevice,
      context,
      {
        onLine: vi.fn(),
        onStatus: vi.fn(),
        onError: (message) => errors.push(message),
        onClose: vi.fn(),
      },
      { authenticationProvider: authProvider as never }
    );

    await invalidBastionSession.start();
    expect(errors).toContain('Device "Primary Device" is missing a bastion host.');

    authProvider.getBastionConfig.mockReturnValue({
      host: 'jump.local',
      username: 'jump',
      port: 2200,
    });
    const stream = new MockSshChannel();
    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');
    connectSpy.mockImplementationOnce(async (request) => {
      expect(request.bastion).toEqual(
        expect.objectContaining({ host: 'jump.local', username: 'jump', port: 2200 })
      );
      expect(request.bastionAuthentication).toEqual({ password: 'jump-secret' });
      return { client: { end: vi.fn() } as unknown as object, stream };
    });

    await new LogSession(
      baseDevice,
      context,
      {
        onLine: vi.fn(),
        onStatus: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
      },
      { authenticationProvider: authProvider as never }
    ).start();

    expect(authProvider.getBastionAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'jump.local' })
    );
  });

  it('covers additional validation, endpoint ordering, and fingerprint prompt branches', async () => {
    const context = createExtensionContext();
    const errors: string[] = [];
    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');
    const callbacks = {
      onLine: vi.fn(),
      onStatus: vi.fn(),
      onError: (message: string) => errors.push(message),
      onClose: vi.fn(),
    };

    workspace.isTrusted = false;
    await new LogSession(baseDevice, context, callbacks).start();
    workspace.isTrusted = true;

    await new LogSession({ ...baseDevice, username: ' ' }, context, callbacks).start();
    await new LogSession({ ...baseDevice, port: -1 }, context, callbacks).start();
    await new LogSession(baseDevice, context, callbacks, {
      authenticationProvider: {
        getDeviceAuthentication: vi.fn(async () => ({ password: 'device-secret' })),
        getBastionConfig: vi.fn(() => ({ host: 'jump.local', username: ' ' })),
        getBastionAuthentication: vi.fn(async () => ({ password: 'jump-secret' })),
      } as never,
    }).start();
    await new LogSession(baseDevice, context, callbacks, {
      authenticationProvider: {
        getDeviceAuthentication: vi.fn(async () => ({ password: 'device-secret' })),
        getBastionConfig: vi.fn(() => ({ host: 'jump.local', username: 'jump', port: 0 })),
        getBastionAuthentication: vi.fn(async () => ({ password: 'jump-secret' })),
      } as never,
    }).start();

    expect(errors).toEqual(
      expect.arrayContaining([
        'Workspace trust is required before connecting to devices.',
        'Device "Primary Device" is missing a username.',
        'Device "Primary Device" has an invalid port.',
        'Device "Primary Device" is missing a bastion username.',
        'Device "Primary Device" has an invalid bastion port.',
      ])
    );
    expect(connectSpy).not.toHaveBeenCalled();

    const orderedSession = new LogSession(baseDevice, context, callbacks, {
      preferredEndpointHost: ' primary.example.com ',
    });
    expect(
      (
        orderedSession as unknown as {
          getOrderedEndpoints: () => Array<{ host: string }>;
        }
      )
        .getOrderedEndpoints()
        .map((endpoint) => endpoint.host)
    ).toEqual(['primary.example.com', 'backup.example.com']);

    const promptSession = new LogSession(baseDevice, context, callbacks);
    setWarningMessageResponse('Stop connection');
    await expect(
      (
        promptSession as unknown as {
          promptToUpdateFingerprint: (
            expected: string,
            received: string,
            endpoint: { host: string; label: 'bastion' }
          ) => Promise<boolean>;
        }
      ).promptToUpdateFingerprint('old', 'new', { host: 'jump.local', label: 'bastion' })
    ).resolves.toBe(false);
  });
});
