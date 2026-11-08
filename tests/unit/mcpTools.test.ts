import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { EmbeddedDevice, SshCommandDefinition } from '../../src/deviceTree';
import { McpAudit } from '../../src/mcp/audit';
import { McpSanitizer } from '../../src/mcp/sanitizer';
import { registerMcpTools, stableCommandId } from '../../src/mcp/tools';
import { DiagnosticService } from '../../src/services/diagnosticService';
import { LogService } from '../../src/services/logService';

function resultText(result: CallToolResult): string {
  expect(result.content).toHaveLength(1);
  const content = result.content[0];
  if (content.type !== 'text') throw new Error('Expected a text result.');
  return content.text;
}

describe('MCP tools', () => {
  let client: Client;
  let server: McpServer;
  let devices: EmbeddedDevice[];
  let logs: LogService;
  let audit: McpAudit;
  const executeDiagnostic = vi.fn<ConstructorParameters<typeof DiagnosticService>[0]>();
  const runCommand =
    vi.fn<(device: EmbeddedDevice, command: SshCommandDefinition) => Promise<string>>();
  const confirm =
    vi.fn<(device: EmbeddedDevice, command: SshCommandDefinition) => Promise<boolean>>();
  const allowCustomCommands = vi.fn<() => boolean>();
  const log = vi.fn<(message: string) => void>();

  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  const read = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const result = await call(name, args);
    expect(result.isError).not.toBe(true);
    return JSON.parse(resultText(result)) as unknown;
  };
  const expectError = async (
    name: string,
    args: Record<string, unknown>,
    message: string
  ): Promise<void> => {
    const result = await call(name, args);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain(message);
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    devices = [
      {
        id: 'device-1',
        name: 'Lab device',
        host: 'private-host',
        username: 'private-user',
        password: 'private-password',
        privateKeyPath: '/private/key',
      },
      { id: 'device-2', name: 'Spare', host: 'spare-host', username: 'root' },
    ];
    logs = new LogService();
    audit = new McpAudit(vi.fn());
    allowCustomCommands.mockReturnValue(true);
    confirm.mockResolvedValue(true);
    runCommand.mockResolvedValue('command output');
    executeDiagnostic.mockResolvedValue('diagnostic output');
    server = new McpServer({ name: 'tool-tests', version: '1.0.0' });
    registerMcpTools(server, {
      getDevices: () => devices,
      logs,
      diagnostics: new DiagnosticService(executeDiagnostic),
      runCommand,
      allowCustomCommands,
      confirm,
      sanitizer: new McpSanitizer(true),
      audit,
      log,
    });
    client = new Client({ name: 'tool-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.restoreAllMocks();
  });

  it('declares read-only tools and identifies the custom command as destructive', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(16);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: tool.name !== 'run_custom_command',
        destructiveHint: tool.name === 'run_custom_command',
        openWorldHint: false,
      });
    }
  });

  it('lists safe metadata and current logging state without exposing connection credentials', async () => {
    logs.setState('device-1', { state: 'connected' });
    logs.append('device-1', 'info connected', 'journal');
    expect(await read('list_devices')).toEqual([
      {
        deviceId: 'device-1',
        name: 'Lab device',
        connectionState: 'connected',
        liveLogging: true,
        logSources: ['journal'],
      },
      {
        deviceId: 'device-2',
        name: 'Spare',
        connectionState: 'disconnected',
        liveLogging: false,
        logSources: [],
      },
    ]);
    expect(executeDiagnostic).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([
      ['Tool invoked: list_devices'],
      ['Tool completed: list_devices'],
    ]);
  });

  it('reads status and unique buffered sources without connecting', async () => {
    logs.setState('device-1', { state: 'error', lastError: 'connection refused' });
    logs.append('device-1', 'first', 'journal');
    logs.append('device-1', 'second', 'journal');
    logs.append('device-1', 'third', 'live');
    expect(await read('get_device_status', { deviceId: ' device-1 ' })).toEqual({
      deviceId: 'device-1',
      name: 'Lab device',
      state: 'error',
      lastError: 'connection refused',
      logEntries: 3,
      logSources: ['journal', 'live'],
    });
    expect(await read('list_log_sources', { deviceId: 'device-1' })).toEqual(['journal', 'live']);
    expect(executeDiagnostic).not.toHaveBeenCalled();
  });

  it.each([
    ['get_device_status', {}],
    ['get_recent_logs', {}],
    ['search_logs', { query: 'error' }],
    ['get_logs_around', { logEntryId: 'missing' }],
    ['list_log_sources', {}],
    ['get_system_info', {}],
    ['list_custom_commands', {}],
  ])('rejects an unknown device for %s', async (name, args) => {
    await expectError(name, { ...args, deviceId: 'missing' }, "Unknown device ID 'missing'.");
    expect(executeDiagnostic).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('filters recent logs before applying the limit and preserves the buffer', async () => {
    logs.append('device-1', 'error needle old', 'journal');
    logs.append('device-1', 'info needle', 'journal');
    logs.append('device-1', 'error needle wrong source', 'live');
    logs.append('device-1', 'error unrelated', 'journal');
    const match = logs.append('device-1', 'error NEEDLE new', 'journal');
    logs.append('device-2', 'error needle other device', 'journal');
    const snapshot = logs.snapshot('device-1');
    expect(
      await read('get_recent_logs', {
        deviceId: 'device-1',
        limit: 1,
        level: 'ERROR',
        source: 'journal',
        filter: 'Needle',
      })
    ).toEqual([match]);
    expect(await read('get_recent_logs', { deviceId: 'device-1' })).toEqual(snapshot);
    expect(logs.snapshot('device-1')).toEqual(snapshot);
  });

  it('defaults recent logs to the newest 200 entries', async () => {
    for (let i = 0; i < 205; i++) logs.append('device-1', `info entry ${i}`);
    expect(await read('get_recent_logs', { deviceId: 'device-1' })).toEqual(
      logs.snapshot('device-1').slice(-200)
    );
  });

  it('searches an inclusive time range and returns the earliest matching results', async () => {
    const entries = [0, 1, 2, 3].map((minute) => {
      const entry = logs.append('device-1', `error NEEDLE ${minute}`, 'journal');
      entry.timestamp = `2026-01-01T00:0${minute}:00.000Z`;
      return entry;
    });
    expect(
      await read('search_logs', {
        deviceId: 'device-1',
        query: 'needle',
        level: 'ERROR',
        source: 'journal',
        since: entries[1].timestamp,
        until: entries[2].timestamp,
      })
    ).toEqual(entries.slice(1, 3));
    expect(
      await read('search_logs', { deviceId: 'device-1', query: 'needle', maxResults: 1 })
    ).toEqual([entries[0]]);
    await expectError(
      'search_logs',
      {
        deviceId: 'device-1',
        query: 'needle',
        since: entries[2].timestamp,
        until: entries[1].timestamp,
      },
      'since must not be after until.'
    );
  });

  it('gets bounded context by entry ID or the nearest timestamp', async () => {
    const entries = [0, 1, 2, 3, 4].map((minute) => {
      const entry = logs.append('device-1', `info context ${minute}`);
      entry.timestamp = `2026-01-01T00:0${minute}:00.000Z`;
      return entry;
    });
    expect(
      await read('get_logs_around', {
        deviceId: 'device-1',
        logEntryId: entries[0].entryId,
        before: 10,
        after: 1,
      })
    ).toEqual(entries.slice(0, 2));
    expect(
      await read('get_logs_around', {
        deviceId: 'device-1',
        timestamp: '2026-01-01T00:02:10.000Z',
        before: 1,
        after: 1,
      })
    ).toEqual(entries.slice(1, 4));
    expect(
      await read('get_logs_around', { deviceId: 'device-1', logEntryId: entries[4].entryId })
    ).toEqual(entries);
  });

  it.each([
    [{}, 'Provide exactly one of logEntryId or timestamp.'],
    [
      { logEntryId: 'device-1:1', timestamp: '2026-01-01T00:00:00Z' },
      'Provide exactly one of logEntryId or timestamp.',
    ],
    [{ logEntryId: 'missing' }, 'Log entry was not found.'],
    [{ timestamp: '2026-01-01T00:00:00Z' }, 'Log entry was not found.'],
  ])('rejects unavailable or ambiguous log context: %j', async (args, message) => {
    await expectError('get_logs_around', { deviceId: 'device-1', ...args }, message);
  });

  it.each([
    ['get_recent_logs', { limit: 0 }],
    ['get_recent_logs', { limit: 5001 }],
    ['get_recent_logs', { limit: 1.5 }],
    ['search_logs', { query: '' }],
    ['search_logs', { query: 'error', maxResults: 1001 }],
    ['search_logs', { query: 'error', since: 'yesterday' }],
    ['get_logs_around', { logEntryId: 'entry', before: 501 }],
    ['get_logs_around', { logEntryId: 'entry', after: -1 }],
    ['get_service_logs', { service: 'app', lines: 2001 }],
    ['run_custom_command', { commandId: 'reboot' }],
  ])('validates arguments before invoking %s: %j', async (name, args) => {
    const result = await call(name, { deviceId: 'device-1', ...args });
    expect(result.isError).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(executeDiagnostic).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['get_system_info', {}, 'hostname'],
    ['get_service_status', { service: 'app.service' }, "'app.service'"],
    [
      'get_service_logs',
      { service: 'app.service', since: '2 hours ago' },
      "--lines=200 --since '2 hours ago' --unit 'app.service'",
    ],
    ['get_processes', {}, 'ps -eo'],
    ['get_disk_usage', {}, 'df -P'],
    ['get_memory_info', {}, '/proc/meminfo'],
    ['get_network_info', {}, 'ip -brief address'],
    ['get_device_uptime', {}, '/proc/uptime'],
  ])('runs the fixed diagnostic for %s with a bounded timeout', async (name, args, command) => {
    logs.setState('device-1', { state: 'connected' });
    expect(await read(name, { deviceId: 'device-1', ...args })).toEqual({
      deviceId: 'device-1',
      output: 'diagnostic output',
    });
    expect(executeDiagnostic).toHaveBeenCalledExactlyOnceWith(
      devices[0],
      expect.stringContaining(command),
      15000
    );
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('requires an active connection before running diagnostics', async () => {
    await expectError(
      'get_system_info',
      { deviceId: 'device-1' },
      "Device 'device-1' is currently disconnected."
    );
    expect(executeDiagnostic).not.toHaveBeenCalled();
  });

  it('lists only authorized commands with opaque IDs and confirmation defaults', async () => {
    devices[0].sshCommands = [
      { name: 'Hidden command', command: 'private command' },
      { name: 'Restart', command: 'systemctl restart app', allowMcp: true },
      { name: 'Status', command: 'uptime', allowMcp: true, mcpConfirmation: 'never' },
    ];
    expect(await read('list_custom_commands', { deviceId: 'device-1' })).toEqual([
      {
        id: stableCommandId(devices[0].sshCommands[1], 1),
        name: 'Restart',
        confirmation: 'always',
      },
      { id: stableCommandId(devices[0].sshCommands[2], 2), name: 'Status', confirmation: 'never' },
    ]);
    expect(await read('list_custom_commands', { deviceId: 'device-2' })).toEqual([]);
  });

  describe('custom command authorization', () => {
    let command: SshCommandDefinition;
    let commandId: string;
    const run = () => read('run_custom_command', { deviceId: 'device-1', commandId });

    beforeEach(() => {
      command = { name: 'Restart', command: 'systemctl restart app', allowMcp: true };
      devices[0].sshCommands = [command];
      commandId = stableCommandId(command, 0);
    });

    it('requires the global setting before confirmation or execution', async () => {
      allowCustomCommands.mockReturnValue(false);
      await expectError(
        'run_custom_command',
        { deviceId: 'device-1', commandId },
        'MCP custom-command execution is globally disabled.'
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
      expect(audit.snapshot()).toEqual([]);
    });

    it.each(['device-1', 'device-2'])('rejects unknown commands for %s', async (deviceId) => {
      await expectError(
        'run_custom_command',
        { deviceId, commandId: 'cmd-000000000000' },
        "Unknown command ID 'cmd-000000000000'."
      );
      expect(runCommand).not.toHaveBeenCalled();
    });

    it('requires authorization for the selected command', async () => {
      command.allowMcp = false;
      await expectError(
        'run_custom_command',
        { deviceId: 'device-1', commandId },
        'This command is not authorized for MCP.'
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    });

    it('does not execute or audit when confirmation is declined', async () => {
      confirm.mockResolvedValue(false);
      await expectError(
        'run_custom_command',
        { deviceId: 'device-1', commandId },
        'The user declined or dismissed command confirmation.'
      );
      expect(confirm).toHaveBeenCalledExactlyOnceWith(devices[0], command);
      expect(runCommand).not.toHaveBeenCalled();
      expect(audit.snapshot()).toEqual([]);
    });

    it('executes the exact configured command after confirmation and audits metadata only', async () => {
      expect(await run()).toEqual({
        commandId,
        success: true,
        exitCode: 0,
        durationMs: expect.any(Number),
        stdout: 'command output',
        stderr: '',
      });
      expect(confirm).toHaveBeenCalledExactlyOnceWith(devices[0], command);
      expect(runCommand).toHaveBeenCalledExactlyOnceWith(devices[0], command);
      expect(audit.snapshot()).toEqual([
        {
          timestamp: expect.any(String),
          source: 'MCP',
          action: 'run_custom_command',
          deviceId: 'device-1',
          deviceName: 'Lab device',
          commandId,
          commandName: 'Restart',
          success: true,
          durationMs: expect.any(Number),
        },
      ]);
    });

    it('honors an explicit never-confirm setting', async () => {
      command.mcpConfirmation = 'never';
      await run();
      expect(confirm).not.toHaveBeenCalled();
      expect(runCommand).toHaveBeenCalledExactlyOnceWith(devices[0], command);
    });

    it('audits failures and sanitizes errors returned to the client and task log', async () => {
      runCommand.mockRejectedValue(new Error('failed: password=private-password'));
      const result = await call('run_custom_command', { deviceId: 'device-1', commandId });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain('[REDACTED]');
      expect(resultText(result)).not.toContain('private-password');
      expect(log).toHaveBeenLastCalledWith('Tool failed: run_custom_command: failed: [REDACTED]');
      expect(audit.snapshot()).toEqual([
        expect.objectContaining({ commandId, success: false, durationMs: expect.any(Number) }),
      ]);
      expect(JSON.stringify(audit.snapshot())).not.toContain('private-password');
    });

    it('sanitizes successful output before exposing it to the client', async () => {
      runCommand.mockResolvedValue('password=private-password\nnext line');
      const result = await call('run_custom_command', { deviceId: 'device-1', commandId });
      expect(result.isError).not.toBe(true);
      expect(resultText(result)).toContain('[REDACTED]');
      expect(resultText(result)).not.toContain('private-password');
    });
  });
});

describe('stableCommandId', () => {
  it('uses the command name and position without exposing command text', () => {
    const command = { name: 'Restart', command: 'systemctl restart app' };
    const id = stableCommandId(command, 0);
    expect(id).toMatch(/^cmd-[a-f0-9]{12}$/);
    expect(stableCommandId({ ...command, command: 'updated command' }, 0)).toBe(id);
    expect(stableCommandId(command, 1)).not.toBe(id);
    expect(stableCommandId({ ...command, name: 'Stop' }, 0)).not.toBe(id);
  });
});
