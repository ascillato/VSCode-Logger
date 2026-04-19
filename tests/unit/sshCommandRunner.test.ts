import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/passwordManager', () => ({
  PasswordManager: class {
    getPassword = vi.fn(async () => 'mock-password');
    getPassphrase = vi.fn(async () => undefined);
  },
}));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { SshCommandError, SshCommandRunner } from '../../src/sshCommandRunner';
import { createExtensionContext, workspace } from '../mocks/vscode';
import { createMockClient } from '../mocks/ssh';
import type { MockSshChannel } from '../mocks/ssh';

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'Test Device',
  host: 'example.com',
  username: 'root',
};

describe('SshCommandRunner', () => {
  afterEach(() => {
    workspace.isTrusted = true;
  });

  it('runs a command successfully with injected SSH client', async () => {
    const context = createExtensionContext();
    const executed: string[] = [];
    const client = createMockClient({
      onExec: (command, stream: MockSshChannel): void => {
        executed.push(command);
        stream.emitData('hello world');
        stream.emitExit(0, null);
        stream.emitClose();
      },
    });

    const runner = new SshCommandRunner(baseDevice, context, {
      createClient: () => client,
    });

    const output = await runner.run({ name: 'Echo', command: ' echo hello world ' });

    expect(output.trim()).toBe('hello world');
    expect(executed).toEqual(['echo hello world']);
  });

  it('throws on commands containing new lines', async () => {
    const context = createExtensionContext();
    const runner = new SshCommandRunner(baseDevice, context);

    await expect(runner.run({ name: 'Bad', command: 'invalid\ncommand' })).rejects.toThrow(
      'SSH command must not contain control characters or new lines.'
    );
  });

  it('bubbles up remote failures with stderr output', async () => {
    const context = createExtensionContext();
    const client = createMockClient({
      onExec: (_command, stream: MockSshChannel): void => {
        stream.emitStderr('permission denied');
        stream.emitExit(1, null);
        stream.emitClose();
      },
    });

    const runner = new SshCommandRunner(baseDevice, context, {
      createClient: () => client,
    });

    await expect(runner.run({ name: 'Fail', command: 'whoami' })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SshCommandError &&
        err.exitCode === 1 &&
        /permission denied/i.test(err.message) &&
        /whoami/.test(err.message)
    );
  });

  it('uploads and runs a script after the optional command', async () => {
    const context = createExtensionContext();
    const executed: string[] = [];
    const client = createMockClient({
      onExec: (command, stream: MockSshChannel): void => {
        executed.push(command);
        stream.emitData('script ok');
        stream.emitExit(0, null);
        stream.emitClose();
      },
    });

    const runner = new SshCommandRunner(baseDevice, context, {
      createClient: () => client,
    });

    const output = await runner.run({
      name: 'Deploy',
      command: 'echo ready',
      copyAndRunScript: true,
      script: '#!/bin/sh\necho deployed\n',
    });

    expect(output.trim()).toBe('script ok');
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatch(/^echo ready && chmod 0777 '\/tmp\/embedded-logger-/);
    expect(executed[0]).toContain(".sh' && '/tmp/embedded-logger-");
    expect(client.sftpSessions).toHaveLength(1);
    expect(client.sftpSessions[0].uploads[0]?.remotePath).toMatch(
      /^\/tmp\/embedded-logger-.*\.sh$/
    );
  });

  it('supports script-only commands when copyAndRunScript is enabled', async () => {
    const context = createExtensionContext();
    const executed: string[] = [];
    const client = createMockClient({
      onExec: (command, stream: MockSshChannel): void => {
        executed.push(command);
        stream.emitExit(0, null);
        stream.emitClose();
      },
    });

    const runner = new SshCommandRunner(baseDevice, context, {
      createClient: () => client,
    });

    await runner.run({
      name: 'Script only',
      copyAndRunScript: true,
      script: '#!/bin/sh\necho only-script\n',
    });

    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatch(/^chmod 0777 '\/tmp\/embedded-logger-/);
  });

  it('rejects invalid device and command configuration before connecting', async () => {
    const context = createExtensionContext();

    await expect(
      new SshCommandRunner({ ...baseDevice, host: ' ' }, context).run({
        name: 'Bad',
        command: 'uptime',
      })
    ).rejects.toThrow('Device "Test Device" is missing a host.');

    await expect(
      new SshCommandRunner({ ...baseDevice, username: ' ' }, context).run({
        name: 'Bad',
        command: 'uptime',
      })
    ).rejects.toThrow('Device "Test Device" is missing a username.');

    await expect(
      new SshCommandRunner({ ...baseDevice, port: 0 }, context).run({
        name: 'Bad',
        command: 'uptime',
      })
    ).rejects.toThrow('Device "Test Device" has an invalid port.');

    await expect(
      new SshCommandRunner(
        { ...baseDevice, bastion: { host: 'jump.local', username: ' ', port: 22 } },
        context
      ).run({ name: 'Bad', command: 'uptime' })
    ).rejects.toThrow('Device "Test Device" is missing a bastion username.');

    await expect(new SshCommandRunner(baseDevice, context).run({ name: 'Empty' })).rejects.toThrow(
      'SSH command is empty.'
    );
  });

  it('blocks missing workspace trust and validates bastion host and port settings', async () => {
    const context = createExtensionContext();

    workspace.isTrusted = false;
    await expect(
      new SshCommandRunner(baseDevice, context).run({ name: 'Trust', command: 'uptime' })
    ).rejects.toThrow('Workspace trust is required before connecting to devices.');
    workspace.isTrusted = true;

    await expect(
      new SshCommandRunner(
        { ...baseDevice, bastion: { host: ' ', username: 'jump', port: 22 } },
        context
      ).run({ name: 'Bad', command: 'uptime' })
    ).rejects.toThrow('Device "Test Device" is missing a bastion host.');

    await expect(
      new SshCommandRunner(
        { ...baseDevice, bastion: { host: 'jump.local', username: 'jump', port: -1 } },
        context
      ).run({ name: 'Bad', command: 'uptime' })
    ).rejects.toThrow('Device "Test Device" has an invalid bastion port.');
  });

  it('loads private keys with environment expansion and includes passphrases when present', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-runner-key-'));
    const previousEnv = process.env.SSH_RUNNER_KEY_DIR;
    const keyPath = path.join(tempDir, 'id_test');
    await fs.writeFile(keyPath, 'PRIVATE KEY DATA');
    process.env.SSH_RUNNER_KEY_DIR = tempDir;

    try {
      const client = createMockClient({
        onExec: (_command, stream: MockSshChannel): void => {
          stream.emitData('key ok');
          stream.emitExit(0, null);
          stream.emitClose();
        },
      });
      const runner = new SshCommandRunner(
        { ...baseDevice, privateKeyPath: '${env:SSH_RUNNER_KEY_DIR}/id_test' },
        createExtensionContext(),
        { createClient: () => client }
      );

      await expect(runner.run({ name: 'Key', command: 'whoami' })).resolves.toBe('key ok');
      expect(client.lastConnectConfig).toEqual(
        expect.objectContaining({
          privateKey: Buffer.from('PRIVATE KEY DATA'),
          passphrase: undefined,
        })
      );
    } finally {
      if (previousEnv === undefined) {
        delete process.env.SSH_RUNNER_KEY_DIR;
      } else {
        process.env.SSH_RUNNER_KEY_DIR = previousEnv;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('retries secondary endpoints after a command failure', async () => {
    const context = createExtensionContext();
    const firstClient = createMockClient({
      onExec: (_command, stream: MockSshChannel): void => {
        stream.emitStderr('primary down');
        stream.emitExit(1, null);
        stream.emitClose();
      },
    });
    const secondClient = createMockClient({
      onExec: (_command, stream: MockSshChannel): void => {
        stream.emitData('secondary ok');
        stream.emitExit(0, null);
        stream.emitClose();
      },
    });
    const clients = [firstClient, secondClient];
    const runner = new SshCommandRunner(
      { ...baseDevice, secondaryHost: 'backup.example.com' },
      context,
      { createClient: () => clients.shift() ?? createMockClient() }
    );

    await expect(runner.run({ name: 'Retry', command: 'uptime' })).resolves.toBe('secondary ok');
    expect(firstClient.lastConnectConfig?.host).toBe('example.com');
    expect(secondClient.lastConnectConfig?.host).toBe('backup.example.com');
  });

  it('executes commands through a bastion tunnel and closes the bastion client', async () => {
    const context = createExtensionContext();
    const bastionClient = createMockClient();
    const tunneledClient = createMockClient({
      onExec: (_command, stream: MockSshChannel): void => {
        stream.emitData('tunnel ok');
        stream.emitExit(0, null);
        stream.emitClose();
      },
    });
    const bastionEnd = vi.spyOn(bastionClient, 'end');
    const runner = new SshCommandRunner(
      {
        ...baseDevice,
        port: 2201,
        bastion: {
          host: 'jump.local',
          username: 'jump',
          port: 2200,
        },
      },
      context,
      {
        createForwardingClient: () => bastionClient as never,
        createClient: () => tunneledClient,
      }
    );

    await expect(runner.run({ name: 'Tunnel', command: 'hostname' })).resolves.toBe('tunnel ok');
    expect(bastionClient.lastConnectConfig).toEqual(
      expect.objectContaining({ host: 'jump.local', port: 2200, username: 'jump' })
    );
    expect(tunneledClient.lastConnectConfig).toEqual(
      expect.objectContaining({ host: 'example.com', sock: expect.any(Object) })
    );
    expect(bastionEnd).toHaveBeenCalled();
  });

  it('handles signal failures, stderr success output, and default completion messages', async () => {
    const signalClient = createMockClient({
      onExec: (_command, stream: MockSshChannel): void => {
        stream.emitData('partial stdout');
        stream.emitExit(null, 'TERM');
        stream.emitClose();
      },
    });

    await expect(
      new SshCommandRunner(baseDevice, createExtensionContext(), {
        createClient: () => signalClient,
      }).run({ name: 'Signal', command: 'long-running' })
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SshCommandError &&
        err.signal === 'TERM' &&
        /signal TERM/.test(err.message) &&
        /partial stdout/.test(err.message)
    );

    const stderrClient = createMockClient({
      onExec: (_command, stream: MockSshChannel): void => {
        stream.emitStderr('warning only');
        stream.emitExit(0, null);
        stream.emitClose();
      },
    });
    await expect(
      new SshCommandRunner(baseDevice, createExtensionContext(), {
        createClient: () => stderrClient,
      }).run({ name: 'Warn', command: 'warn' })
    ).resolves.toBe('warning only');

    const quietClient = createMockClient({
      onExec: (_command, stream: MockSshChannel): void => {
        stream.emitExit(0, null);
        stream.emitClose();
      },
    });
    await expect(
      new SshCommandRunner(baseDevice, createExtensionContext(), {
        createClient: () => quietClient,
      }).run({ name: 'Quiet', command: 'true' })
    ).resolves.toBe('');
  });

  it('wraps upload, private-key, and unknown errors consistently', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-runner-empty-key-'));
    try {
      const emptyKey = path.join(tempDir, 'empty');
      await fs.writeFile(emptyKey, '');
      await expect(
        new SshCommandRunner(
          { ...baseDevice, privateKeyPath: emptyKey },
          createExtensionContext()
        ).run({ name: 'Key', command: 'uptime' })
      ).rejects.toThrow(
        `Failed to read private key from ${emptyKey}: The private key file is empty.`
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    const uploadClient = createMockClient();
    vi.spyOn(uploadClient, 'sftp').mockImplementation((callback) => {
      callback(new Error('sftp denied'), undefined as never);
    });

    await expect(
      new SshCommandRunner(baseDevice, createExtensionContext(), {
        createClient: () => uploadClient,
      }).run({
        name: 'Upload',
        command: 'echo ready',
        copyAndRunScript: true,
        script: '#!/bin/sh\necho upload\n',
      })
    ).rejects.toThrow('sftp denied');

    const runner = new SshCommandRunner(baseDevice, createExtensionContext());
    expect(
      (
        runner as unknown as {
          getErrorMessage: (err: unknown) => string;
          toError: (err: unknown, fallbackMessage: string) => Error;
        }
      ).getErrorMessage({ toString: () => 'object failure' })
    ).toBe('object failure');
    expect(
      (
        runner as unknown as {
          toError: (err: unknown, fallbackMessage: string) => Error;
        }
      ).toError(undefined, 'fallback').message
    ).toBe('undefined');
  });

  it('wraps SSH client and exec failures with useful messages', async () => {
    const errorClient = createMockClient();
    vi.spyOn(errorClient, 'connect').mockImplementation(() => {
      queueMicrotask(() => errorClient.emit('error', new Error('network down')));
      return errorClient;
    });

    await expect(
      new SshCommandRunner(baseDevice, createExtensionContext(), {
        createClient: () => errorClient,
      }).run({ name: 'Network', command: 'uptime' })
    ).rejects.toThrow('SSH error: network down');

    const execClient = createMockClient();
    vi.spyOn(execClient, 'exec').mockImplementation((_command, callback) => {
      callback(new Error('exec denied'), undefined as never);
      return execClient;
    });

    await expect(
      new SshCommandRunner(baseDevice, createExtensionContext(), {
        createClient: () => execClient,
      }).run({ name: 'Exec', command: 'uptime' })
    ).rejects.toThrow('exec denied');
  });

  it('exhausts endpoint retries and wraps non-error failures from private execution', async () => {
    const runner = new SshCommandRunner(
      { ...baseDevice, secondaryHost: 'backup.example.com' },
      createExtensionContext()
    );
    const executeSpy = vi
      .spyOn(
        runner as unknown as {
          executeCommand: () => Promise<string>;
        },
        'executeCommand'
      )
      .mockRejectedValue('plain failure');

    await expect(runner.run({ name: 'Retry', command: 'uptime' })).rejects.toThrow('plain failure');
    expect(executeSpy).toHaveBeenCalledTimes(3);
  });

  it('normalizes bastion helpers and loads bastion private-key authentication', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-runner-bastion-key-'));
    const keyPath = path.join(tempDir, 'id_jump');
    await fs.writeFile(keyPath, 'JUMP KEY');

    try {
      const runner = new SshCommandRunner(
        {
          ...baseDevice,
          bastion: {
            host: ' jump.local ',
            username: ' jump ',
            hostFingerprint: ' SHA256:abc ',
            privateKeyPath: ` ${keyPath} `,
          },
        },
        createExtensionContext()
      ) as unknown as {
        getBastionConfig: () =>
          | {
              host: string;
              username: string;
              port: number;
              hostFingerprint?: string;
              privateKeyPath?: string;
            }
          | undefined;
        getBastionAuthentication: (bastion: {
          host: string;
          username: string;
          privateKeyPath?: string;
        }) => Promise<{ privateKey?: Buffer; passphrase?: string }>;
      };

      expect(runner.getBastionConfig()).toEqual({
        host: 'jump.local',
        username: 'jump',
        port: 22,
        hostFingerprint: 'SHA256:abc',
        privateKeyPath: keyPath,
      });
      await expect(
        runner.getBastionAuthentication({
          host: 'jump.local',
          username: 'jump',
          privateKeyPath: keyPath,
        })
      ).resolves.toEqual({
        privateKey: Buffer.from('JUMP KEY'),
        passphrase: undefined,
      });

      expect(
        (
          new SshCommandRunner(
            { ...baseDevice, bastion: { host: ' ', username: 'jump' } },
            createExtensionContext()
          ) as unknown as { getBastionConfig: () => unknown }
        ).getBastionConfig()
      ).toBeUndefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects bastion forwarding errors during tunneled execution', async () => {
    const bastionClient = createMockClient();
    vi.spyOn(bastionClient, 'forwardOut').mockImplementation(
      (_srcIp, _srcPort, _dstIp, _dstPort, callback) => {
        callback(new Error('forward denied'), undefined as never);
      }
    );

    const runner = new SshCommandRunner(baseDevice, createExtensionContext(), {
      createForwardingClient: () => bastionClient as never,
    }) as unknown as {
      executeCommandThroughBastion: (
        endpoint: { host: string; label: 'primary' },
        command: { remoteCommand: string; command?: string },
        auth: { password: string },
        bastion: { host: string; username: string },
        bastionAuth: { password: string }
      ) => Promise<string>;
    };

    await expect(
      runner.executeCommandThroughBastion(
        { host: 'device.local', label: 'primary' },
        { remoteCommand: 'uptime', command: 'uptime' },
        { password: 'device' },
        { host: 'jump.local', username: 'jump' },
        { password: 'jump' }
      )
    ).rejects.toThrow('forward denied');
  });
});
