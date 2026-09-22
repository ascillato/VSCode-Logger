import { createServer } from 'http';
import { describe, expect, it, vi } from 'vitest';
import { LogService } from '../../src/services/logService';
import { DiagnosticService } from '../../src/services/diagnosticService';
import { McpSanitizer } from '../../src/mcp/sanitizer';
import { McpAudit } from '../../src/mcp/audit';
import { LocalMcpServer } from '../../src/mcp/server';
describe('MCP security', () => {
  it('keeps bounded immutable log snapshots', () => {
    const l = new LogService(2);
    l.append('d', 'one');
    const two = l.append('d', 'error two');
    l.append('d', 'three');
    const s = l.snapshot('d') as (typeof two)[];
    expect(s).toHaveLength(2);
    expect(s[0].entryId).toBe(two.entryId);
    s.pop();
    expect(l.snapshot('d')).toHaveLength(2);
  });
  it('redacts test secrets and bounds output', () => {
    const input =
      'password=SUPER_SECRET_PASSWORD_123 token=SECRET_TOKEN_ABC123 apiKey=VERY_PRIVATE_API_KEY';
    const out = new McpSanitizer(true).text(input, 80);
    expect(out).not.toContain('SUPER_SECRET_PASSWORD_123');
    expect(out).not.toContain('SECRET_TOKEN_ABC123');
    expect(out).not.toContain('VERY_PRIVATE_API_KEY');
  });
  it.each(['watcher; reboot', 'watcher && reboot', '$(reboot)', '`reboot`', 'watcher | reboot'])(
    'rejects injection %s',
    (x) => expect(() => DiagnosticService.validateService(x)).toThrow()
  );
  it('bounds fixed diagnostics', () => {
    const d = new DiagnosticService(vi.fn());
    expect(d.command('serviceStatus', { service: 'watcher.service' })).toContain(
      "'watcher.service'"
    );
    expect(() => d.command('serviceLogs', { service: 'watcher', lines: 2001 })).toThrow();
  });
  it('audits metadata without output', () => {
    const a = new McpAudit(vi.fn());
    a.record({ action: 'run_custom_command', deviceId: 'd', success: true, durationMs: 1 });
    expect(JSON.stringify(a.snapshot())).not.toContain('stdout');
  });
});
describe('MCP lifecycle', () => {
  const deps = () => ({
    getDevices: () => [],
    logs: new LogService(),
    diagnostics: new DiagnosticService(vi.fn()),
    runCommand: vi.fn(),
    allowCustomCommands: () => false,
    confirm: vi.fn(),
    sanitizer: new McpSanitizer(true),
    audit: new McpAudit(vi.fn()),
    log: vi.fn(),
  });
  it('starts and stops idempotently on loopback', async () => {
    const s = new LocalMcpServer(deps());
    expect((await s.start(39171)).endpoint).toBe('http://127.0.0.1:39171/mcp');
    expect((await s.start(39171)).running).toBe(true);
    await s.stop();
    await s.stop();
    expect(s.status().running).toBe(false);
  });
  it('rejects a port conflict', async () => {
    const occupied = createServer();
    await new Promise<void>((ok) => occupied.listen(39172, '127.0.0.1', ok));
    const s = new LocalMcpServer(deps());
    await expect(s.start(39172)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await new Promise<void>((ok) => occupied.close(() => ok()));
  });
});
