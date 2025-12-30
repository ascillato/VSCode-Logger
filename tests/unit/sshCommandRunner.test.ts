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
});
