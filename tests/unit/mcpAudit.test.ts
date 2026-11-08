import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpAudit } from '../../src/mcp/audit';

afterEach(() => vi.useRealTimers());

describe('McpAudit', () => {
  it('writes command metadata with a timestamp to the sink and snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const sink = vi.fn();
    const audit = new McpAudit(sink);
    const entry = {
      action: 'run_custom_command',
      deviceId: 'device-1',
      deviceName: 'Lab device',
      commandId: 'command-1',
      commandName: 'Service status',
      success: false,
      durationMs: 42,
    };

    audit.record(entry);

    const expected = { timestamp: '2026-01-02T03:04:05.000Z', source: 'MCP', ...entry };
    expect(sink).toHaveBeenCalledExactlyOnceWith(JSON.stringify(expected));
    expect(audit.snapshot()).toEqual([expected]);
  });

  it('keeps only the latest 1000 entries while emitting every event', () => {
    const sink = vi.fn();
    const audit = new McpAudit(sink);
    expect(audit.snapshot()).toEqual([]);
    for (let i = 0; i < 1002; i++) {
      audit.record({ action: `action-${i}`, success: true, durationMs: i });
    }

    const snapshot = audit.snapshot();
    expect(snapshot).toHaveLength(1000);
    expect(snapshot[0].action).toBe('action-2');
    expect(snapshot[snapshot.length - 1].action).toBe('action-1001');
    expect(sink).toHaveBeenCalledTimes(1002);
  });

  it('protects recorded metadata from mutations to returned entries', () => {
    const audit = new McpAudit(vi.fn());
    audit.record({ action: 'list_devices', success: true, durationMs: 1 });
    const snapshot = audit.snapshot();
    snapshot[0].action = 'changed';
    snapshot[0].success = false;

    expect(audit.snapshot()[0]).toMatchObject({ action: 'list_devices', success: true });
    expect(audit.snapshot()[0]).not.toBe(snapshot[0]);
  });
});
