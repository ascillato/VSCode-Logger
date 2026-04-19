import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationResult } from '../../src/logSession/authenticationProvider';
import { ConnectionManager } from '../../src/logSession/connectionManager';
import { HostKeyMismatchError } from '../../src/logSession/errors';
import type { EmbeddedDevice } from '../../src/deviceTree';
import type { HostEndpoint } from '../../src/hostEndpoints';
import { createMockClient, MockSshChannel } from '../mocks/ssh';

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'Log Device',
  host: 'device.local',
  username: 'root',
  port: 2222,
};

const endpoint: HostEndpoint = {
  host: 'device.local',
  label: 'primary',
};

const authentication: AuthenticationResult = {
  password: 'secret',
};

describe('ConnectionManager', () => {
  it('connects directly, persists the seen fingerprint, and starts the log stream', async () => {
    const stream = new MockSshChannel();
    const client = createMockClient({
      onExec: (_command, execStream) => {
        expect(execStream).toBe(stream);
      },
    });
    vi.spyOn(client, 'exec').mockImplementation((command, callback) => {
      callback(undefined, stream as never);
      expect(command).toBe('tail -f /var/log/syslog');
      return client;
    });

    const callbacks = {
      onStatus: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const persistence = {
      persistIfMissing: vi.fn(async () => undefined),
    };
    const hostVerifier = {
      getExpectedFingerprint: vi.fn(() => ({ display: 'SHA256:expected', hex: '0123' })),
      reset: vi.fn(),
      verify: vi.fn(() => true),
      getLastSeen: vi.fn(() => ({ display: 'SHA256:seen', hex: '1234' })),
      getFailure: vi.fn(() => undefined),
    };

    const manager = new ConnectionManager(callbacks, persistence as never, hostVerifier as never, {
      createClient: () => client as never,
      createForwardingClient: () => createMockClient() as never,
    });
    const onStreamReady = vi.fn();

    const connection = await manager.connect({
      endpoint,
      authentication,
      logCommand: 'tail -f /var/log/syslog',
      device: baseDevice,
      onStreamReady,
    });

    expect(connection.client).toBe(client);
    expect(connection.stream).toBe(stream);
    expect(client.lastConnectConfig).toEqual(
      expect.objectContaining({
        host: 'device.local',
        port: 2222,
        username: 'root',
        password: 'secret',
        keepaliveInterval: 5000,
        keepaliveCountMax: 3,
        hostHash: 'sha256',
      })
    );
    expect(hostVerifier.reset).toHaveBeenCalled();
    expect(hostVerifier.verify).toHaveBeenCalled();
    expect(persistence.persistIfMissing).toHaveBeenCalledWith(endpoint, {
      display: 'SHA256:seen',
      hex: '1234',
    });
    expect(onStreamReady).toHaveBeenCalledWith(stream);
    expect(callbacks.onStatus).toHaveBeenCalledWith('Connecting to device.local:2222 ...');
    expect(callbacks.onStatus).toHaveBeenCalledWith('Connected. Streaming logs...');
  });

  it('wraps host key failures as HostKeyMismatchError for direct connections', async () => {
    const client = createMockClient();
    const callbacks = {
      onStatus: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const hostVerifier = {
      getExpectedFingerprint: vi.fn(() => ({ display: 'SHA256:expected', hex: '0123' })),
      reset: vi.fn(),
      verify: vi.fn(() => false),
      getLastSeen: vi.fn(() => undefined),
      getFailure: vi.fn(() => ({ expected: 'SHA256:expected', received: 'SHA256:received' })),
    };

    const manager = new ConnectionManager(
      callbacks,
      { persistIfMissing: vi.fn(async () => undefined) } as never,
      hostVerifier as never,
      {
        createClient: () => client as never,
        createForwardingClient: () => createMockClient() as never,
      }
    );

    await expect(
      manager.connect({
        endpoint,
        authentication,
        logCommand: 'tail -f /var/log/syslog',
        device: baseDevice,
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HostKeyMismatchError &&
        error.expected === 'SHA256:expected' &&
        error.received === 'SHA256:received' &&
        error.endpoint.host === 'device.local'
    );

    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('connects through a bastion and returns the bastion client alongside the log stream', async () => {
    const bastionClient = createMockClient();
    const stream = new MockSshChannel();
    const tunneledClient = createMockClient();
    vi.spyOn(tunneledClient, 'exec').mockImplementation((_command, callback) => {
      callback(undefined, stream as never);
      return tunneledClient;
    });

    const callbacks = {
      onStatus: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const persistence = {
      persistIfMissing: vi.fn(async () => undefined),
    };
    const hostVerifier = {
      getExpectedFingerprint: vi.fn(() => undefined),
      reset: vi.fn(),
      verify: vi.fn(() => true),
      getLastSeen: vi.fn(() => ({ display: 'SHA256:endpoint', hex: '1111' })),
      getFailure: vi.fn(() => undefined),
    };
    const bastionVerifier = {
      getExpectedFingerprint: vi.fn(() => undefined),
      reset: vi.fn(),
      verify: vi.fn(() => true),
      getLastSeen: vi.fn(() => ({ display: 'SHA256:bastion', hex: '2222' })),
      getFailure: vi.fn(() => undefined),
    };

    const manager = new ConnectionManager(
      callbacks,
      persistence as never,
      hostVerifier as never,
      {
        createClient: () => tunneledClient as never,
        createForwardingClient: () => bastionClient as never,
      },
      bastionVerifier as never
    );

    const connection = await manager.connect({
      endpoint,
      authentication,
      logCommand: 'journalctl -f',
      device: baseDevice,
      bastion: {
        host: 'bastion.local',
        username: 'jump',
        port: 2200,
      },
      bastionAuthentication: { password: 'jump-secret' },
    });

    expect(connection.client).toBe(tunneledClient);
    expect(connection.stream).toBe(stream);
    expect(connection.bastionClient).toBe(bastionClient);
    expect(bastionClient.lastConnectConfig).toEqual(
      expect.objectContaining({
        host: 'bastion.local',
        port: 2200,
        username: 'jump',
        password: 'jump-secret',
        keepaliveInterval: 5000,
        keepaliveCountMax: 3,
      })
    );
    expect(tunneledClient.lastConnectConfig).toEqual(
      expect.objectContaining({
        host: 'device.local',
        sock: expect.any(MockSshChannel),
      })
    );
    expect(persistence.persistIfMissing).toHaveBeenCalledWith(
      { host: 'bastion.local', fingerprint: undefined, label: 'bastion' },
      { display: 'SHA256:bastion', hex: '2222' }
    );
    expect(callbacks.onStatus).toHaveBeenCalledWith('Connecting to bastion bastion.local:2200 ...');
    expect(callbacks.onStatus).toHaveBeenCalledWith(
      'Connected to bastion. Tunneling to device.local:2222 ...'
    );
  });

  it('reports direct SSH errors and close notifications through callbacks', async () => {
    const client = createMockClient();
    vi.spyOn(client, 'connect').mockImplementation(() => {
      queueMicrotask(() => client.emit('error', new Error('network down')));
      return client;
    });
    const callbacks = {
      onStatus: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const hostVerifier = {
      getExpectedFingerprint: vi.fn(() => undefined),
      reset: vi.fn(),
      verify: vi.fn(() => true),
      getLastSeen: vi.fn(() => undefined),
      getFailure: vi.fn(() => undefined),
    };
    const manager = new ConnectionManager(
      callbacks,
      { persistIfMissing: vi.fn(async () => undefined) } as never,
      hostVerifier as never,
      {
        createClient: () => client as never,
        createForwardingClient: () => createMockClient() as never,
      }
    );

    await expect(
      manager.connect({
        endpoint,
        authentication,
        logCommand: 'tail -f /var/log/syslog',
        device: baseDevice,
      })
    ).rejects.toThrow('network down');

    expect(callbacks.onError).toHaveBeenCalledWith('SSH error: network down');

    client.emit('close');
    expect(callbacks.onStatus).toHaveBeenCalledWith('Connection closed.');
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  it('rejects when the log command cannot be started', async () => {
    const client = createMockClient();
    vi.spyOn(client, 'exec').mockImplementation((_command, callback) => {
      callback(new Error('exec failed'), undefined as never);
      return client;
    });
    const callbacks = {
      onStatus: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const hostVerifier = {
      getExpectedFingerprint: vi.fn(() => undefined),
      reset: vi.fn(),
      verify: vi.fn(() => true),
      getLastSeen: vi.fn(() => undefined),
      getFailure: vi.fn(() => undefined),
    };
    const manager = new ConnectionManager(
      callbacks,
      { persistIfMissing: vi.fn(async () => undefined) } as never,
      hostVerifier as never,
      {
        createClient: () => client as never,
        createForwardingClient: () => createMockClient() as never,
      }
    );

    await expect(
      manager.connect({
        endpoint,
        authentication,
        logCommand: 'bad-command',
        device: baseDevice,
      })
    ).rejects.toThrow('exec failed');
  });

  it('handles bastion forwarding and host-key failures', async () => {
    const bastionClient = createMockClient();
    vi.spyOn(bastionClient, 'forwardOut').mockImplementation(
      (_srcIp, _srcPort, _dstIp, _dstPort, callback) => {
        callback(new Error('forward denied'), undefined as never);
      }
    );
    const callbacks = {
      onStatus: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const hostVerifier = {
      getExpectedFingerprint: vi.fn(() => undefined),
      reset: vi.fn(),
      verify: vi.fn(() => true),
      getLastSeen: vi.fn(() => undefined),
      getFailure: vi.fn(() => undefined),
    };
    const bastionVerifier = {
      getExpectedFingerprint: vi.fn(() => undefined),
      reset: vi.fn(),
      verify: vi.fn(() => true),
      getLastSeen: vi.fn(() => undefined),
      getFailure: vi.fn(() => undefined),
    };
    const manager = new ConnectionManager(
      callbacks,
      { persistIfMissing: vi.fn(async () => undefined) } as never,
      hostVerifier as never,
      {
        createClient: () => createMockClient() as never,
        createForwardingClient: () => bastionClient as never,
      },
      bastionVerifier as never
    );

    await expect(
      manager.connect({
        endpoint,
        authentication,
        logCommand: 'journalctl -f',
        device: baseDevice,
        bastion: { host: 'jump.local', username: 'jump' },
        bastionAuthentication: { password: 'jump-secret' },
      })
    ).rejects.toThrow('forward denied');

    bastionClient.emit('close');
    expect(callbacks.onStatus).toHaveBeenCalledWith('Bastion connection closed.');

    const mismatchClient = createMockClient();
    vi.spyOn(mismatchClient, 'connect').mockImplementation(() => {
      queueMicrotask(() => mismatchClient.emit('error', new Error('Host key rejected')));
      return mismatchClient;
    });
    const mismatchVerifier = {
      ...bastionVerifier,
      getFailure: vi.fn(() => ({ expected: 'SHA256:old', received: 'SHA256:new' })),
    };
    const mismatchManager = new ConnectionManager(
      callbacks,
      { persistIfMissing: vi.fn(async () => undefined) } as never,
      hostVerifier as never,
      {
        createClient: () => createMockClient() as never,
        createForwardingClient: () => mismatchClient as never,
      },
      mismatchVerifier as never
    );

    await expect(
      mismatchManager.connect({
        endpoint,
        authentication,
        logCommand: 'journalctl -f',
        device: baseDevice,
        bastion: { host: 'jump.local', username: 'jump' },
        bastionAuthentication: { password: 'jump-secret' },
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HostKeyMismatchError &&
        error.expected === 'SHA256:old' &&
        error.received === 'SHA256:new'
    );
  });

  it('falls back to direct connections without bastion authentication and normalizes non-Error tunnel failures', async () => {
    const stream = new MockSshChannel();
    const client = createMockClient();
    vi.spyOn(client, 'exec').mockImplementation((_command, callback) => {
      callback(undefined, stream as never);
      return client;
    });
    const callbacks = {
      onStatus: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const hostVerifier = {
      getExpectedFingerprint: vi.fn(() => undefined),
      reset: vi.fn(),
      verify: vi.fn(() => true),
      getLastSeen: vi.fn(() => undefined),
      getFailure: vi.fn(() => undefined),
    };
    const manager = new ConnectionManager(
      callbacks,
      { persistIfMissing: vi.fn(async () => undefined) } as never,
      hostVerifier as never,
      {
        createClient: () => client as never,
        createForwardingClient: () => createMockClient() as never,
      }
    );

    await expect(
      manager.connect({
        endpoint,
        authentication,
        logCommand: 'tail -f /var/log/syslog',
        device: { ...baseDevice, port: undefined },
        bastion: { host: 'jump.local', username: 'jump' },
      })
    ).resolves.toEqual({ client, stream });
    expect(client.lastConnectConfig).toEqual(
      expect.objectContaining({ host: 'device.local', port: 22 })
    );

    expect(
      (
        manager as unknown as {
          normalizeError: (err: unknown, fallbackMessage: string) => Error;
        }
      ).normalizeError('plain failure', 'fallback').message
    ).toBe('plain failure');
    expect(
      (
        manager as unknown as {
          normalizeError: (err: unknown, fallbackMessage: string) => Error;
        }
      ).normalizeError(undefined, 'fallback').message
    ).toBe('fallback');
  });
});
