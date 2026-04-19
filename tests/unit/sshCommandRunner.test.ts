import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/passwordManager', () => ({
  PasswordManager: class {
    getPassword = vi.fn(async () => 'mock-password');
    getPassphrase = vi.fn(async () => undefined);
  },
}));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { SshCommandError, SshCommandRunner } from '../../src/sshCommandRunner';
import { createExtensionContext } from '../mocks/vscode';
import { createMockClient } from '../mocks/ssh';
import type { MockSshChannel } from '../mocks/ssh';

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'Test Device',
  host: 'example.com',
  username: 'root',
};

describe('SshCommandRunner', () => {
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
});
