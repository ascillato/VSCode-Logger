import { createHash } from 'crypto';
import { z } from 'zod/v4';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { EmbeddedDevice, SshCommandDefinition } from '../deviceTree';
import type { LogEntry, LogService } from '../services/logService';
import type { DiagnosticService, DiagnosticKind } from '../services/diagnosticService';
import type { McpAudit } from './audit';
import type { McpSanitizer } from './sanitizer';
import { safeError } from './sanitizer';
export interface McpToolDependencies {
  getDevices(): EmbeddedDevice[];
  logs: LogService;
  diagnostics: DiagnosticService;
  runCommand(d: EmbeddedDevice, c: SshCommandDefinition): Promise<string>;
  allowCustomCommands(): boolean;
  confirm(d: EmbeddedDevice, c: SshCommandDefinition): Promise<boolean>;
  sanitizer: McpSanitizer;
  audit: McpAudit;
  log(m: string): void;
}
const deviceId = z.string().trim().min(1).max(200),
  level = z.string().trim().min(1).max(32).optional(),
  source = z.string().trim().min(1).max(128).optional(),
  iso = z.iso.datetime({ offset: true });
export function stableCommandId(c: SshCommandDefinition, i: number): string {
  return `cmd-${createHash('sha256').update(`${i}\0${c.name}`).digest('hex').slice(0, 12)}`;
}
function filter(
  e: readonly LogEntry[],
  f: { level?: string; source?: string; filter?: string }
): LogEntry[] {
  const n = f.filter?.toLowerCase();
  return e.filter(
    (x) =>
      (!f.level || x.level === f.level.toLowerCase()) &&
      (!f.source || x.source === f.source) &&
      (!n || x.message.toLowerCase().includes(n))
  );
}
export function registerMcpTools(server: McpServer, d: McpToolDependencies): void {
  const find = (id: string): EmbeddedDevice => {
    const x = d.getDevices().find((v) => v.id === id);
    if (!x) throw new Error(`Unknown device ID '${id}'.`);
    return x;
  };
  const call = async (name: string, fn: () => unknown): Promise<CallToolResult> => {
    d.log(`Tool invoked: ${name}`);
    try {
      const value = await fn();
      d.log(`Tool completed: ${name}`);
      return {
        content: [
          { type: 'text' as const, text: d.sanitizer.text(JSON.stringify(value, null, 2)) },
        ],
      };
    } catch (e) {
      const x = safeError(e, d.sanitizer);
      d.log(`Tool failed: ${name}: ${x.message}`);
      throw x;
    }
  };
  const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool(
    'list_devices',
    { description: 'List safe configured-device metadata.', inputSchema: {}, annotations: ro },
    () =>
      call('list_devices', () =>
        d.getDevices().map((x) => ({
          deviceId: x.id,
          name: x.name,
          connectionState: d.logs.getState(x.id).state,
          liveLogging: d.logs.getState(x.id).state === 'connected',
          logSources: d.logs.sources(x.id),
        }))
      )
  );
  server.registerTool(
    'get_device_status',
    {
      description: 'Read known status without connecting.',
      inputSchema: { deviceId },
      annotations: ro,
    },
    ({ deviceId: id }) =>
      call('get_device_status', () => {
        const x = find(id),
          s = d.logs.getState(id);
        return {
          deviceId: id,
          name: x.name,
          ...s,
          logEntries: d.logs.snapshot(id).length,
          logSources: d.logs.sources(id),
        };
      })
  );
  server.registerTool(
    'get_recent_logs',
    {
      description: 'Read bounded logs already collected.',
      inputSchema: {
        deviceId,
        limit: z.number().int().min(1).max(5000).default(200),
        level,
        source,
        filter: z.string().max(500).optional(),
      },
      annotations: ro,
    },
    ({ deviceId: id, limit, ...f }) =>
      call('get_recent_logs', () => {
        find(id);
        return filter(d.logs.snapshot(id), f).slice(-limit);
      })
  );
  server.registerTool(
    'search_logs',
    {
      description: 'Search logs without changing UI filters.',
      inputSchema: {
        deviceId,
        query: z.string().min(1).max(500),
        maxResults: z.number().int().min(1).max(1000).default(200),
        level,
        source,
        since: iso.optional(),
        until: iso.optional(),
      },
      annotations: ro,
    },
    ({ deviceId: id, query, maxResults, level, source, since, until }) =>
      call('search_logs', () => {
        find(id);
        const a = since ? Date.parse(since) : -Infinity,
          b = until ? Date.parse(until) : Infinity;
        if (a > b) throw new Error('since must not be after until.');
        return filter(d.logs.snapshot(id), { level, source, filter: query })
          .filter((x) => Date.parse(x.timestamp) >= a && Date.parse(x.timestamp) <= b)
          .slice(0, maxResults);
      })
  );
  server.registerTool(
    'get_logs_around',
    {
      description: 'Read bounded context around one log.',
      inputSchema: {
        deviceId,
        logEntryId: z.string().max(300).optional(),
        timestamp: iso.optional(),
        before: z.number().int().min(0).max(500).default(50),
        after: z.number().int().min(0).max(500).default(50),
      },
      annotations: ro,
    },
    ({ deviceId: id, logEntryId, timestamp, before, after }) =>
      call('get_logs_around', () => {
        find(id);
        if ((!logEntryId && !timestamp) || (logEntryId && timestamp))
          throw new Error('Provide exactly one of logEntryId or timestamp.');
        const v = d.logs.snapshot(id);
        let i = logEntryId ? v.findIndex((x) => x.entryId === logEntryId) : -1;
        if (timestamp)
          i = v.reduce(
            (best, x, n) =>
              Math.abs(Date.parse(x.timestamp) - Date.parse(timestamp)) <
              Math.abs(Date.parse(v[best]?.timestamp ?? '') - Date.parse(timestamp))
                ? n
                : best,
            0
          );
        if (i < 0 || !v.length) throw new Error('Log entry was not found.');
        return v.slice(Math.max(0, i - before), i + after + 1);
      })
  );
  server.registerTool(
    'list_log_sources',
    {
      description: 'List sources present in the buffer.',
      inputSchema: { deviceId },
      annotations: ro,
    },
    ({ deviceId: id }) =>
      call('list_log_sources', () => {
        find(id);
        return d.logs.sources(id);
      })
  );
  const diag = (
    name: string,
    kind: DiagnosticKind,
    schema: Record<string, z.ZodType> = { deviceId }
  ): RegisteredTool =>
    server.registerTool(
      name,
      { description: `Run fixed read-only ${name}.`, inputSchema: schema, annotations: ro },
      (args) =>
        call(name, async () => {
          const a = args as { deviceId: string; service?: string; lines?: number; since?: string },
            x = find(a.deviceId);
          if (d.logs.getState(x.id).state !== 'connected')
            throw new Error(`Device '${x.id}' is currently disconnected.`);
          return { deviceId: x.id, output: await d.diagnostics.run(x, kind, a) };
        })
    );
  diag('get_system_info', 'systemInfo');
  diag('get_service_status', 'serviceStatus', { deviceId, service: z.string().min(1).max(128) });
  diag('get_service_logs', 'serviceLogs', {
    deviceId,
    service: z.string().min(1).max(128),
    lines: z.number().int().min(1).max(2000).default(200),
    since: z.string().max(64).optional(),
  });
  diag('get_processes', 'processes');
  diag('get_disk_usage', 'diskUsage');
  diag('get_memory_info', 'memoryInfo');
  diag('get_network_info', 'networkInfo');
  diag('get_device_uptime', 'uptime');
  server.registerTool(
    'list_custom_commands',
    {
      description: 'List explicitly MCP-authorized commands.',
      inputSchema: { deviceId },
      annotations: ro,
    },
    ({ deviceId: id }) =>
      call('list_custom_commands', () => {
        const x = find(id);
        return (x.sshCommands ?? []).flatMap((c, i) =>
          c.allowMcp
            ? [
                {
                  id: stableCommandId(c, i),
                  name: c.name,
                  confirmation: c.mcpConfirmation ?? 'always',
                },
              ]
            : []
        );
      })
  );
  server.registerTool(
    'run_custom_command',
    {
      description: 'Run an exact preauthorized command; accepts no command text or arguments.',
      inputSchema: { deviceId, commandId: z.string().regex(/^cmd-[a-f0-9]{12}$/) },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    ({ deviceId: id, commandId }) =>
      call('run_custom_command', async () => {
        if (!d.allowCustomCommands())
          throw new Error('MCP custom-command execution is globally disabled.');
        const x = find(id),
          found = (x.sshCommands ?? [])
            .map((c, i) => ({ c, id: stableCommandId(c, i) }))
            .find((v) => v.id === commandId);
        if (!found) throw new Error(`Unknown command ID '${commandId}'.`);
        if (!found.c.allowMcp) throw new Error('This command is not authorized for MCP.');
        if ((found.c.mcpConfirmation ?? 'always') === 'always' && !(await d.confirm(x, found.c)))
          throw new Error('The user declined or dismissed command confirmation.');
        const start = Date.now();
        let success = false;
        try {
          const stdout = await d.runCommand(x, found.c);
          success = true;
          return {
            commandId,
            success,
            exitCode: 0,
            durationMs: Date.now() - start,
            stdout,
            stderr: '',
          };
        } finally {
          d.audit.record({
            action: 'run_custom_command',
            deviceId: id,
            deviceName: x.name,
            commandId,
            commandName: found.c.name,
            success,
            durationMs: Date.now() - start,
          });
        }
      })
  );
}
