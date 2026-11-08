import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigurationChangeEvent, ExtensionContext } from 'vscode';
import type { McpToolDependencies } from '../../src/mcp/tools';

const server = vi.hoisted(() => ({
  created: vi.fn<(dependencies: McpToolDependencies) => void>(),
  start: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
}));

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/mcp/server', () => ({
  LocalMcpServer: class {
    constructor(dependencies: McpToolDependencies) {
      server.created(dependencies);
    }
    start = server.start;
    stop = server.stop;
    status = server.status;
  },
}));

import { activate, deactivate } from '../../src/extension';
import { SshCommandRunner } from '../../src/sshCommandRunner';
import {
  commands,
  ConfigurationTarget,
  createExtensionContext,
  env,
  resetWindowResponses,
  resetWorkspaceConfiguration,
  setWarningMessageResponse,
  window,
  workspace,
} from '../mocks/vscode';

const device = { id: 'board', name: 'Lab board', host: '192.0.2.1', username: 'root' };
let context: ExtensionContext;

function handler(id: string): () => unknown {
  const registration = vi.mocked(commands.registerCommand).mock.calls.find(([name]) => name === id);
  expect(registration, `Missing command ${id}`).toBeDefined();
  return registration![1] as () => unknown;
}

function dependencies(): McpToolDependencies {
  expect(server.created).toHaveBeenCalled();
  return server.created.mock.calls[server.created.mock.calls.length - 1][0];
}

beforeEach(async () => {
  resetWindowResponses();
  resetWorkspaceConfiguration();
  vi.clearAllMocks();
  context = createExtensionContext();
  server.start.mockResolvedValue({ running: true, endpoint: 'http://127.0.0.1:39070/mcp' });
  server.stop.mockResolvedValue(undefined);
  server.status.mockReturnValue({ running: true, endpoint: 'http://127.0.0.1:39070/mcp' });
  await workspace.getConfiguration('embeddedLogger').update('enableDevicePing', false);
  await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
});

afterEach(async () => {
  for (const subscription of context.subscriptions) subscription.dispose();
  deactivate();
  await Promise.all(server.stop.mock.results.map(({ value }) => value as Promise<void>));
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetWindowResponses();
  resetWorkspaceConfiguration();
});

describe('extension MCP commands', () => {
  it('starts only when enabled, reports status, and stops through registered commands', async () => {
    const config = workspace.getConfiguration('embeddedLogger.mcp');
    const update = vi.spyOn(config, 'update');
    await activate(context);
    expect(server.created).not.toHaveBeenCalled();
    await handler('embeddedLogger.mcp.status')();
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      'Embedded Logger MCP is stopped.'
    );

    await config.update('port', 40123);
    await handler('embeddedLogger.mcp.enable')();
    expect(update).toHaveBeenCalledWith('enabled', true, ConfigurationTarget.Global);
    expect(server.start).toHaveBeenCalledWith(40123);
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'embeddedLogger.mcpRunning',
      true
    );
    await handler('embeddedLogger.mcp.status')();
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      'Embedded Logger MCP is running at http://127.0.0.1:39070/mcp.'
    );

    await handler('embeddedLogger.mcp.enable')();
    expect(server.created).toHaveBeenCalledTimes(1);
    await handler('embeddedLogger.mcp.disable')();
    expect(update).toHaveBeenCalledWith('enabled', false, ConfigurationTarget.Global);
    expect(server.stop).toHaveBeenCalledTimes(1);
    expect(commands.executeCommand).toHaveBeenLastCalledWith(
      'setContext',
      'embeddedLogger.mcpRunning',
      false
    );
    await handler('embeddedLogger.mcp.status')();
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      'Embedded Logger MCP is stopped.'
    );
  });

  it.each([undefined, 40124])(
    'copies and opens connection configuration for port %s',
    async (port) => {
      if (port !== undefined)
        await workspace.getConfiguration('embeddedLogger.mcp').update('port', port);
      const openDocument = vi.spyOn(workspace, 'openTextDocument');
      await activate(context);
      await handler('embeddedLogger.mcp.showConfiguration')();
      const content = await env.clipboard.readText();
      expect(JSON.parse(content)).toEqual({
        servers: { embeddedLogger: { type: 'http', url: `http://127.0.0.1:${port ?? 39070}/mcp` } },
      });
      expect(openDocument).toHaveBeenCalledWith({ language: 'json', content });
      expect(window.showTextDocument).toHaveBeenCalledWith(
        await openDocument.mock.results[0].value,
        { preview: true }
      );
      await handler('embeddedLogger.mcp.showLogs')();
      const output = vi.mocked(window.createOutputChannel).mock.results[0].value;
      expect(output.show).toHaveBeenCalledOnce();
    }
  );

  it('wires live configuration, command execution, confirmation, redaction, and audit output', async () => {
    vi.useFakeTimers();
    await workspace.getConfiguration('embeddedLogger.mcp').update('enabled', true);
    const run = vi.spyOn(SshCommandRunner.prototype, 'run').mockResolvedValue('diagnostic output');
    await activate(context);
    const deps = dependencies();
    expect(deps.getDevices()).toEqual([expect.objectContaining(device)]);
    expect(deps.allowCustomCommands()).toBe(false);
    await workspace.getConfiguration('embeddedLogger.mcp').update('allowCustomCommands', true);
    expect(deps.allowCustomCommands()).toBe(true);

    const command = { name: 'Restart app', command: 'systemctl restart app', allowMcp: true };
    expect(await deps.confirm(device, command)).toBe(false);
    setWarningMessageResponse('Run');
    expect(await deps.confirm(device, command)).toBe(true);
    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      'MCP requests “Restart app” on “Lab board”. Run it?',
      { modal: true },
      'Run'
    );
    expect(await deps.runCommand(device, command)).toBe('diagnostic output');
    expect(run).toHaveBeenLastCalledWith(command);
    expect(await deps.diagnostics.run(device, 'memoryInfo')).toBe('diagnostic output');
    expect(run).toHaveBeenLastCalledWith({
      name: 'MCP read-only diagnostic',
      command: "cat /proc/meminfo | sed -n '1,30p'",
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(deps.sanitizer.text('password=hidden')).toBe('[REDACTED]');

    deps.audit.record({
      action: 'run_custom_command',
      deviceId: device.id,
      success: true,
      durationMs: 5,
    });
    deps.log('Command completed');
    const output = vi.mocked(window.createOutputChannel).mock.results[0].value;
    expect(output.info).toHaveBeenCalledWith(expect.stringContaining('Audit: '));
    expect(output.info).toHaveBeenCalledWith('Command completed');
  });

  it.each(['custom', 'diagnostic'] as const)(
    'bounds %s execution time and clears the completed timer',
    async (kind) => {
      vi.useFakeTimers();
      await workspace.getConfiguration('embeddedLogger.mcp').update('enabled', true);
      let finish!: (value: string) => void;
      const commandOutput = new Promise<string>((resolve) => {
        finish = resolve;
      });
      vi.spyOn(SshCommandRunner.prototype, 'run').mockReturnValue(commandOutput);
      await activate(context);
      const deps = dependencies();
      const execution =
        kind === 'custom'
          ? deps.runCommand(device, { name: 'Status', command: 'uptime' })
          : deps.diagnostics.run(device, 'uptime');
      const rejected = expect(execution).rejects.toThrow('Device operation timed out.');
      await vi.advanceTimersByTimeAsync(kind === 'custom' ? 30000 : 15000);
      await rejected;
      finish('late response');
      await commandOutput;
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([new Error('port unavailable'), 'port unavailable'])(
    'reports activation startup failures: %s',
    async (error) => {
      await workspace.getConfiguration('embeddedLogger.mcp').update('enabled', true);
      server.start.mockRejectedValueOnce(error);
      await activate(context);
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Unable to start Embedded Logger MCP: port unavailable'
      );
      const output = vi.mocked(window.createOutputChannel).mock.results[0].value;
      expect(output.info).toHaveBeenCalledWith('Server failed to start: port unavailable');
      expect(commands.executeCommand).not.toHaveBeenCalledWith(
        'setContext',
        'embeddedLogger.mcpRunning',
        true
      );
    }
  );

  it('recreates the server on MCP configuration changes and stops it when disabled', async () => {
    const config = workspace.getConfiguration('embeddedLogger.mcp');
    await config.update('enabled', true);
    await activate(context);
    const onChange = vi.mocked(workspace.onDidChangeConfiguration).mock.calls[0][0];
    const event = {
      affectsConfiguration: (section: string) =>
        section === 'embeddedLogger' || section === 'embeddedLogger.mcp',
    } as ConfigurationChangeEvent;
    await config.update('port', 40125);
    await config.update('redactSensitiveData', false);
    onChange(event);
    await vi.waitFor(() => expect(server.start).toHaveBeenLastCalledWith(40125));
    expect(server.stop).toHaveBeenCalledOnce();
    expect(server.created).toHaveBeenCalledTimes(2);
    expect(server.start).toHaveBeenLastCalledWith(40125);
    expect(dependencies().sanitizer.text('password=visible')).toBe('password=visible');

    await config.update('enabled', false);
    vi.mocked(commands.executeCommand).mockClear();
    onChange(event);
    await vi.waitFor(() =>
      expect(commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        'embeddedLogger.mcpRunning',
        false
      )
    );
    expect(server.stop).toHaveBeenCalledTimes(2);
    expect(server.start).toHaveBeenCalledTimes(2);
  });
});
