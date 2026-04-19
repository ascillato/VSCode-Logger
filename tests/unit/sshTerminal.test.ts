import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/passwordManager', () => ({
  PasswordManager: class {
    getPassword = vi.fn(async () => 'mock-password');
    getPassphrase = vi.fn(async () => undefined);
  },
}));

type MockClientRecord = {
  connectConfig: Record<string, unknown> | undefined;
  shellOptions: Record<string, unknown> | undefined;
  shellChannel: {
    writes: string[];
    write: (value: string) => boolean;
    setWindow: (rows: number, columns: number, pixelHeight: number, pixelWidth: number) => void;
    stderr: {
      emit: (event: string, data: Buffer) => void;
    };
    emit: (event: string, ...args: unknown[]) => void;
    end: () => unknown;
  };
  sftpSession: {
    uploads: Array<{ localPath: string; remotePath: string }>;
  };
  end: () => unknown;
};

type EventListener = (...args: unknown[]) => void;
type ShellCallback = (
  err: Error | undefined,
  stream: {
    write: (value: string) => boolean;
    on: (event: string, listener: EventListener) => unknown;
    stderr: { on: (event: string, listener: EventListener) => unknown };
  }
) => void;
type SftpCallback = (
  err: Error | undefined,
  sftp: {
    fastPut: (localPath: string, remotePath: string, callback: (err?: Error) => void) => void;
    end: () => void;
  }
) => void;
type ForwardOutCallback = (
  err: Error | undefined,
  stream: {
    on: (event: string, listener: EventListener) => unknown;
    stderr: { on: (event: string, listener: EventListener) => unknown };
    write: (value: string) => boolean;
  }
) => void;

const { sshMockState, fsMockState } = vi.hoisted(() => ({
  sshMockState: {
    clients: [] as MockClientRecord[],
  },
  fsMockState: {
    readFile: vi.fn(),
    mkdtemp: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: fsMockState.readFile,
  mkdtemp: fsMockState.mkdtemp,
  writeFile: fsMockState.writeFile,
  rm: fsMockState.rm,
}));

vi.mock('ssh2', () => {
  class MockEmitter {
    private readonly listeners = new Map<string, EventListener[]>();

    on(event: string, listener: EventListener): this {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
      return this;
    }

    once(event: string, listener: EventListener): this {
      const onceListener: EventListener = (...args: unknown[]): void => {
        this.off(event, onceListener);
        listener(...args);
      };
      return this.on(event, onceListener);
    }

    off(event: string, listener: EventListener): this {
      const current = this.listeners.get(event) ?? [];
      this.listeners.set(
        event,
        current.filter((candidate) => candidate !== listener)
      );
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }

    removeAllListeners(): this {
      this.listeners.clear();
      return this;
    }
  }

  class MockShellChannel extends MockEmitter {
    readonly stderr = new MockEmitter();
    readonly writes: string[] = [];
    readonly write = vi.fn((value: string) => {
      this.writes.push(value);
      return true;
    });
    readonly setWindow = vi.fn();
    readonly end = vi.fn(() => {
      this.emit('close');
      return this;
    });
  }

  class MockSftpSession {
    readonly uploads: Array<{ localPath: string; remotePath: string }> = [];
    readonly fastPut = vi.fn(
      (localPath: string, remotePath: string, callback: (err?: Error) => void) => {
        this.uploads.push({ localPath, remotePath });
        callback(undefined);
      }
    );
    readonly end = vi.fn();
  }

  class MockClient extends MockEmitter {
    connectConfig: Record<string, unknown> | undefined;
    shellOptions: Record<string, unknown> | undefined;
    readonly shellChannel = new MockShellChannel();
    readonly sftpSession = new MockSftpSession();
    readonly connect = vi.fn((config: Record<string, unknown>) => {
      this.connectConfig = config;
      queueMicrotask(() => this.emit('ready'));
      return this;
    });
    readonly shell = vi.fn((options: Record<string, unknown>, callback: ShellCallback) => {
      this.shellOptions = options;
      callback(undefined, this.shellChannel);
      return this;
    });
    readonly sftp = vi.fn((callback: SftpCallback) => {
      callback(undefined, this.sftpSession);
      return this;
    });
    readonly forwardOut = vi.fn(
      (
        _srcIp: string,
        _srcPort: number,
        _dstIp: string,
        _dstPort: number,
        callback: ForwardOutCallback
      ) => {
        callback(undefined, this.shellChannel);
      }
    );
    readonly end = vi.fn(() => {
      this.emit('close');
      return this;
    });

    constructor() {
      super();
      sshMockState.clients.push(this);
    }
  }

  return { Client: MockClient };
});

import type { EmbeddedDevice } from '../../src/deviceTree';
import { SshTerminalSession } from '../../src/sshTerminal';
import { createExtensionContext, resetWindowResponses, window, workspace } from '../mocks/vscode';

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'Terminal Device',
  host: 'device.local',
  username: 'root',
};

const flushAsync = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  sshMockState.clients.length = 0;
  fsMockState.readFile.mockReset();
  fsMockState.mkdtemp.mockReset();
  fsMockState.writeFile.mockReset();
  fsMockState.rm.mockReset();
  resetWindowResponses();
  workspace.isTrusted = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SshTerminalSession', () => {
  it('opens a shell, writes the initial path and command, forwards data, and resizes the terminal', async () => {
    const context = createExtensionContext();
    const writes: string[] = [];
    const closes = vi.fn();
    const session = new SshTerminalSession(
      baseDevice,
      context,
      '/var/log/my app',
      ' tail -f /var/log/syslog '
    );

    session.onDidWrite((value: unknown) => {
      if (typeof value === 'string') {
        writes.push(value);
      }
    });
    session.onDidClose(closes);

    session.open({ columns: 100, rows: 40 });
    await flushAsync();

    const client = sshMockState.clients[0];
    const shell = client.shellChannel;

    expect(client.connectConfig).toEqual(
      expect.objectContaining({
        host: 'device.local',
        port: 22,
        username: 'root',
        password: 'mock-password',
      })
    );
    expect(client.shellOptions).toEqual(
      expect.objectContaining({
        term: 'xterm-color',
        cols: 100,
        rows: 40,
      })
    );
    expect(shell.writes).toEqual(["cd -- '/var/log/my app'\n", 'tail -f /var/log/syslog\n']);

    shell.emit('data', Buffer.from('hello\nworld'));
    shell.stderr.emit('data', Buffer.from('warn\n'));
    session.handleInput('ls');
    session.handleInput('\r');
    session.setDimensions({ columns: 120, rows: 50 });

    expect(shell.write).toHaveBeenCalledWith('ls');
    expect(shell.write).toHaveBeenCalledWith('\r');
    expect(shell.setWindow).toHaveBeenCalledWith(50, 120, 50, 120);
    expect(writes).toContain('Connected to Terminal Device\r\n');
    expect(writes).toContain('hello\r\nworld');
    expect(writes).toContain('warn\r\n');

    session.close();

    expect(closes).toHaveBeenCalledOnce();
    expect(shell.end).toHaveBeenCalled();
    expect(client.end).toHaveBeenCalled();
  });

  it('uploads an initial script and executes the remote wrapper command', async () => {
    const context = createExtensionContext();
    fsMockState.mkdtemp.mockResolvedValue('/tmp/upload-dir');
    fsMockState.writeFile.mockResolvedValue(undefined);
    fsMockState.rm.mockResolvedValue(undefined);

    const session = new SshTerminalSession(
      baseDevice,
      context,
      undefined,
      'echo ready',
      false,
      '#!/bin/sh\necho deployed\n'
    );

    session.open();
    await flushAsync();

    const client = sshMockState.clients[0];
    const shell = client.shellChannel;

    expect(fsMockState.mkdtemp).toHaveBeenCalled();
    expect(fsMockState.writeFile).toHaveBeenCalledWith(
      '/tmp/upload-dir/command.sh',
      '#!/bin/sh\necho deployed\n',
      'utf8'
    );
    expect(client.sftpSession.uploads).toHaveLength(1);
    expect(client.sftpSession.uploads[0].localPath).toBe('/tmp/upload-dir/command.sh');
    expect(client.sftpSession.uploads[0].remotePath).toMatch(/^\/tmp\/embedded-logger-.*\.sh$/);
    expect(shell.writes).toHaveLength(1);
    expect(shell.writes[0]).toMatch(
      /^echo ready && chmod 0777 '\/tmp\/embedded-logger-.*\.sh' && '\/tmp\/embedded-logger-.*\.sh'\n$/
    );
    expect(fsMockState.rm).toHaveBeenCalledWith('/tmp/upload-dir', {
      recursive: true,
      force: true,
    });
  });

  it('reconnects after an unexpected disconnect and reruns the initial command when configured', async () => {
    vi.useFakeTimers();

    const context = createExtensionContext();
    const writes: string[] = [];
    const session = new SshTerminalSession(baseDevice, context, undefined, 'top', true);

    session.onDidWrite((value: unknown) => {
      if (typeof value === 'string') {
        writes.push(value);
      }
    });

    session.open({ columns: 80, rows: 24 });
    await flushAsync();

    const firstClient = sshMockState.clients[0];
    const firstShell = firstClient.shellChannel;

    expect(firstShell.writes).toEqual(['top\n']);

    firstShell.emit('close');
    await flushAsync();

    expect(writes.some((value) => value.includes('Retrying in 5 seconds'))).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();

    const secondClient = sshMockState.clients[1];
    const secondShell = secondClient.shellChannel;

    expect(sshMockState.clients).toHaveLength(2);
    expect(secondShell.writes).toEqual(['top\n']);
  });

  it('treats user exit as a clean close and does not reconnect', async () => {
    vi.useFakeTimers();

    const context = createExtensionContext();
    const writes: string[] = [];
    const closes = vi.fn();
    const session = new SshTerminalSession(baseDevice, context);

    session.onDidWrite((value) => writes.push(value));
    session.onDidClose(closes);

    session.open();
    await flushAsync();

    const firstClient = sshMockState.clients[0];
    const firstShell = firstClient.shellChannel;

    session.handleInput('exit');
    session.handleInput('\r');
    firstShell.emit('exit', 0, null);
    firstShell.emit('close');
    await flushAsync();
    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();

    expect(closes).toHaveBeenCalledOnce();
    expect(sshMockState.clients).toHaveLength(1);
    expect(writes.some((value) => value.includes('Retrying in 5 seconds'))).toBe(false);
  });

  it('reports workspace trust errors and closes without connecting', async () => {
    const context = createExtensionContext();
    const closes = vi.fn();
    const session = new SshTerminalSession(baseDevice, context);

    workspace.isTrusted = false;
    session.onDidClose(closes);

    session.open();
    await flushAsync();

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Workspace trust is required before connecting to devices.'
    );
    expect(closes).toHaveBeenCalledOnce();
    expect(sshMockState.clients).toHaveLength(0);
  });

  it('validates device configuration and helper methods directly', async () => {
    const context = createExtensionContext();
    const session = new SshTerminalSession(
      {
        ...baseDevice,
        bastion: {
          host: ' jump.local ',
          username: ' jump ',
          privateKeyPath: ' ~/.ssh/id_jump ',
        },
      },
      context
    ) as unknown as {
      validateDeviceConfiguration: () => string | undefined;
      getBastionConfig: () => {
        host: string;
        username: string;
        port: number;
        privateKeyPath?: string;
      };
      getBastionDevice: (bastion: { host: string; username: string }) => EmbeddedDevice;
      quotePath: (value: string) => string;
      normalizeInitialCommand: (value: string | undefined) => string | undefined;
      isExitCommand: (value: string) => boolean;
      isCleanExit: (code?: number | null, signal?: string | null) => boolean;
      getErrorMessage: (err: unknown) => string;
      toError: (err: unknown, fallbackMessage: string) => Error;
    };

    expect(session.validateDeviceConfiguration()).toBeUndefined();
    expect(session.getBastionConfig()).toEqual(
      expect.objectContaining({
        host: 'jump.local',
        username: 'jump',
        port: 22,
        privateKeyPath: '~/.ssh/id_jump',
      })
    );
    expect(session.getBastionDevice({ host: 'jump.local', username: 'jump' })).toEqual(
      expect.objectContaining({
        id: 'device-1-bastion',
        name: 'Terminal Device bastion',
        host: 'jump.local',
        username: 'jump',
      })
    );
    expect(session.quotePath("/tmp/it's here")).toBe("'/tmp/it'\\''s here'");
    expect(session.normalizeInitialCommand(' uptime ')).toBe('uptime');
    expect(() => session.normalizeInitialCommand('bad\ncommand')).toThrow(
      'SSH command must not contain control characters or new lines.'
    );
    expect(session.isExitCommand('\u001b[31mexit 0\r')).toBe(true);
    expect(session.isExitCommand('logout\n')).toBe(true);
    expect(session.isExitCommand('echo exit\n')).toBe(false);
    expect(session.isCleanExit(0, null)).toBe(true);
    expect(session.isCleanExit(1, null)).toBe(false);
    expect(session.isCleanExit(0, 'TERM')).toBe(false);
    expect(session.getErrorMessage('plain')).toBe('plain');
    expect(session.toError(undefined, 'fallback').message).toBe('undefined');

    expect(
      (
        new SshTerminalSession({ ...baseDevice, host: ' ' }, context) as unknown as {
          validateDeviceConfiguration: () => string | undefined;
        }
      ).validateDeviceConfiguration()
    ).toBe('Device "Terminal Device" is missing a host.');
    expect(
      (
        new SshTerminalSession({ ...baseDevice, username: ' ' }, context) as unknown as {
          validateDeviceConfiguration: () => string | undefined;
        }
      ).validateDeviceConfiguration()
    ).toBe('Device "Terminal Device" is missing a username.');
    expect(
      (
        new SshTerminalSession({ ...baseDevice, port: -1 }, context) as unknown as {
          validateDeviceConfiguration: () => string | undefined;
        }
      ).validateDeviceConfiguration()
    ).toBe('Device "Terminal Device" has an invalid port.');
    expect(
      (
        new SshTerminalSession(
          { ...baseDevice, bastion: { host: ' ', username: 'jump' } },
          context
        ) as unknown as {
          validateDeviceConfiguration: () => string | undefined;
        }
      ).validateDeviceConfiguration()
    ).toBe('Device "Terminal Device" is missing a bastion host.');
    expect(
      (
        new SshTerminalSession(
          { ...baseDevice, bastion: { host: 'jump.local', username: ' ', port: 22 } },
          context
        ) as unknown as {
          validateDeviceConfiguration: () => string | undefined;
        }
      ).validateDeviceConfiguration()
    ).toBe('Device "Terminal Device" is missing a bastion username.');
    expect(
      (
        new SshTerminalSession(
          { ...baseDevice, bastion: { host: 'jump.local', username: 'jump', port: 0 } },
          context
        ) as unknown as {
          validateDeviceConfiguration: () => string | undefined;
        }
      ).validateDeviceConfiguration()
    ).toBe('Device "Terminal Device" has an invalid bastion port.');
    expect(
      (
        new SshTerminalSession(
          { ...baseDevice, bastion: { host: '', username: 'jump' } },
          context
        ) as unknown as {
          getBastionConfig: () => unknown;
        }
      ).getBastionConfig()
    ).toBeUndefined();
  });

  it('loads private keys and reports empty key files', async () => {
    const context = createExtensionContext();
    const session = new SshTerminalSession(baseDevice, context) as unknown as {
      loadPrivateKey: (filePath: string) => Promise<Buffer>;
      expandPath: (value: string) => string;
    };
    const previousEnv = process.env.SSH_TERMINAL_KEY_DIR;
    process.env.SSH_TERMINAL_KEY_DIR = '/keys';
    fsMockState.readFile.mockResolvedValueOnce(Buffer.from('PRIVATE KEY'));
    fsMockState.readFile.mockResolvedValueOnce(Buffer.alloc(0));

    try {
      expect(session.expandPath('${env:SSH_TERMINAL_KEY_DIR}/id_test')).toBe('/keys/id_test');
      await expect(session.loadPrivateKey('/keys/id_test')).resolves.toEqual(
        Buffer.from('PRIVATE KEY')
      );
      await expect(session.loadPrivateKey('/keys/empty')).rejects.toThrow(
        'The private key file is empty.'
      );
    } finally {
      if (previousEnv === undefined) {
        delete process.env.SSH_TERMINAL_KEY_DIR;
      } else {
        process.env.SSH_TERMINAL_KEY_DIR = previousEnv;
      }
    }
  });

  it('returns private-key authentication for devices and bastion hosts', async () => {
    const context = createExtensionContext();
    fsMockState.readFile.mockResolvedValue(Buffer.from('PRIVATE KEY'));

    const session = new SshTerminalSession(
      {
        ...baseDevice,
        privateKeyPath: '/keys/id_device',
        bastion: {
          host: 'jump.local',
          username: 'jump',
          privateKeyPath: '/keys/id_jump',
        },
      },
      context
    ) as unknown as {
      getAuthentication: () => Promise<{ privateKey?: Buffer; passphrase?: string }>;
      getBastionConfig: () => { host: string; username: string; privateKeyPath?: string };
      getBastionAuthentication: (bastion: {
        host: string;
        username: string;
        privateKeyPath?: string;
      }) => Promise<{ privateKey?: Buffer; passphrase?: string }>;
    };

    await expect(session.getAuthentication()).resolves.toEqual({
      privateKey: Buffer.from('PRIVATE KEY'),
      passphrase: undefined,
    });
    await expect(session.getBastionAuthentication(session.getBastionConfig())).resolves.toEqual({
      privateKey: Buffer.from('PRIVATE KEY'),
      passphrase: undefined,
    });
  });

  it('retries secondary terminal endpoints and ignores duplicate close paths', async () => {
    const context = createExtensionContext();
    const closes = vi.fn();
    const session = new SshTerminalSession(
      { ...baseDevice, secondaryHost: 'backup.local' },
      context
    ) as SshTerminalSession & {
      start: () => Promise<void>;
      connect: ReturnType<typeof vi.fn>;
      handleConnectionLost: () => void;
      scheduleReconnect: () => void;
      closed?: boolean;
      userRequestedClose?: boolean;
    };
    session.onDidClose(closes);
    session.connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary down'))
      .mockResolvedValueOnce(undefined);

    session.setDimensions({ columns: 90, rows: 30 });
    await session.start();

    expect(session.connect).toHaveBeenNthCalledWith(
      1,
      { host: 'device.local', fingerprint: undefined, label: 'primary' },
      { password: 'mock-password' },
      undefined,
      undefined,
      undefined
    );
    expect(session.connect).toHaveBeenNthCalledWith(
      2,
      { host: 'backup.local', fingerprint: undefined, label: 'secondary' },
      { password: 'mock-password' },
      undefined,
      undefined,
      undefined
    );

    session.close();
    session.close();
    session.handleConnectionLost();
    session.scheduleReconnect();
    expect(closes).toHaveBeenCalledOnce();
  });

  it('does not rerun the initial command on reconnect unless configured', async () => {
    vi.useFakeTimers();

    const context = createExtensionContext();
    const session = new SshTerminalSession(baseDevice, context, undefined, 'top', false);

    session.open({ columns: 80, rows: 24 });
    await flushAsync();

    const firstShell = sshMockState.clients[0].shellChannel;
    expect(firstShell.writes).toEqual(['top\n']);

    firstShell.emit('close');
    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();

    const secondShell = sshMockState.clients[1].shellChannel;
    expect(secondShell.writes).toEqual([]);
  });

  it('connects through a bastion host before opening the shell', async () => {
    const context = createExtensionContext();
    const session = new SshTerminalSession(
      {
        ...baseDevice,
        port: 2201,
        bastion: {
          host: 'jump.local',
          username: 'jump',
          port: 2200,
        },
      },
      context
    );

    session.open();
    await flushAsync();

    const bastionClient = sshMockState.clients[0];
    const tunneledClient = sshMockState.clients[1];

    expect(bastionClient.connectConfig).toEqual(
      expect.objectContaining({ host: 'jump.local', port: 2200, username: 'jump' })
    );
    expect(tunneledClient.connectConfig).toEqual(
      expect.objectContaining({ host: 'device.local', port: 2201, sock: expect.any(Object) })
    );
  });

  it('keeps only one reconnect timer and clears it when the terminal closes', async () => {
    vi.useFakeTimers();

    const context = createExtensionContext();
    const writes: string[] = [];
    const session = new SshTerminalSession(baseDevice, context) as SshTerminalSession & {
      scheduleReconnect: () => void;
      reconnectTimer?: NodeJS.Timeout;
    };
    session.onDidWrite((value: unknown) => {
      if (typeof value === 'string') {
        writes.push(value);
      }
    });

    session.scheduleReconnect();
    const firstTimer = session.reconnectTimer;
    session.scheduleReconnect();

    expect(session.reconnectTimer).toBe(firstTimer);
    expect(writes.filter((value) => value.includes('Retrying in 5 seconds'))).toHaveLength(1);

    session.close();
    await vi.advanceTimersByTimeAsync(5000);

    expect(sshMockState.clients).toHaveLength(0);
  });

  it('reports direct connection and shell setup failures', async () => {
    const context = createExtensionContext();
    const networkSession = new SshTerminalSession(baseDevice, context) as unknown as {
      connect: (
        endpoint: { host: string; label: 'primary' },
        auth: { password: string }
      ) => Promise<void>;
    };

    const networkPromise = networkSession.connect(
      { host: 'device.local', label: 'primary' },
      { password: 'secret' }
    );
    const networkClient = sshMockState.clients[0];
    networkClient.emit('error', new Error('network down'));

    await expect(networkPromise).rejects.toThrow('SSH error: network down');

    const shellSession = new SshTerminalSession(baseDevice, context) as unknown as {
      connect: (
        endpoint: { host: string; label: 'primary' },
        auth: { password: string }
      ) => Promise<void>;
    };
    const shellPromise = shellSession.connect(
      { host: 'device.local', label: 'primary' },
      { password: 'secret' }
    );
    const shellClient = sshMockState.clients[1];
    shellClient.shell.mockImplementationOnce((_options, callback) => {
      callback(new Error('shell denied'), undefined as never);
      return shellClient;
    });

    await expect(shellPromise).rejects.toThrow('shell denied');
  });

  it('reports bastion forwarding failures and normalizes tunnel errors', async () => {
    const context = createExtensionContext();
    const session = new SshTerminalSession(
      {
        ...baseDevice,
        bastion: {
          host: 'jump.local',
          username: 'jump',
        },
      },
      context
    ) as unknown as {
      connectThroughBastion: (
        endpoint: { host: string; label: 'primary' },
        auth: { password: string },
        bastion: { host: string; username: string },
        bastionAuth: { password: string }
      ) => Promise<void>;
    };

    const forwardPromise = session.connectThroughBastion(
      { host: 'device.local', label: 'primary' },
      { password: 'device' },
      { host: 'jump.local', username: 'jump' },
      { password: 'jump' }
    );
    const bastionClient = sshMockState.clients[0];
    bastionClient.forwardOut.mockImplementationOnce(
      (_srcIp, _srcPort, _dstIp, _dstPort, callback) => {
        callback(new Error('forward denied'), undefined as never);
        return bastionClient;
      }
    );

    await expect(forwardPromise).rejects.toThrow('forward denied');

    const failingTunnelSession = new SshTerminalSession(
      {
        ...baseDevice,
        bastion: {
          host: 'jump.local',
          username: 'jump',
        },
      },
      context
    ) as unknown as {
      connectDirect: ReturnType<typeof vi.fn>;
      connectThroughBastion: (
        endpoint: { host: string; label: 'primary' },
        auth: { password: string },
        bastion: { host: string; username: string },
        bastionAuth: { password: string }
      ) => Promise<void>;
    };
    failingTunnelSession.connectDirect = vi.fn(() =>
      Promise.reject(new Error('plain tunnel failure'))
    );

    await expect(
      failingTunnelSession.connectThroughBastion(
        { host: 'device.local', label: 'primary' },
        { password: 'device' },
        { host: 'jump.local', username: 'jump' },
        { password: 'jump' }
      )
    ).rejects.toThrow('plain tunnel failure');
  });
});
