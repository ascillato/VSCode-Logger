import { describe, expect, it, vi } from 'vitest';
import type { EmbeddedDevice } from '../../src/deviceTree';
import { DiagnosticService } from '../../src/services/diagnosticService';

const device: EmbeddedDevice = {
  id: 'diagnostic-device',
  name: 'Diagnostic Device',
  host: 'device.example',
  username: 'root',
};

describe('DiagnosticService', () => {
  it.each([
    ['processes', 'ps -eo pid=,comm=,pcpu=,pmem=,stat= --sort=-pcpu | head -n 201'],
    ['diskUsage', 'df -P -B1 | head -n 101'],
    ['memoryInfo', "cat /proc/meminfo | sed -n '1,30p'"],
    [
      'networkInfo',
      "ip -brief address; printf '\\nROUTES\\n'; ip route | head -n 100; printf '\\nLISTENING\\n'; ss -H -lntu | head -n 100",
    ],
    ['uptime', 'cat /proc/uptime; who -b 2>/dev/null || true'],
    [
      'systemInfo',
      "printf 'hostname='; hostname; printf 'kernel='; uname -sr; printf 'architecture='; uname -m; printf 'uptime='; uptime; (cat /etc/os-release 2>/dev/null || true); (free -b 2>/dev/null || true)",
    ],
  ] as const)('executes the fixed %s diagnostic with a bounded timeout', async (kind, command) => {
    const execute = vi.fn().mockResolvedValue('device output');
    const diagnostics = new DiagnosticService(execute);

    await expect(diagnostics.run(device, kind)).resolves.toBe('device output');
    expect(execute).toHaveBeenCalledExactlyOnceWith(device, command, 15000);
  });

  it('requests only the supported service properties and quotes the service name', async () => {
    const execute = vi.fn().mockResolvedValue('ActiveState=active');
    const diagnostics = new DiagnosticService(execute);

    await expect(
      diagnostics.run(device, 'serviceStatus', { service: 'watcher@instance-1.service' })
    ).resolves.toBe('ActiveState=active');
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      device,
      "systemctl show --no-pager --property=Id,LoadState,ActiveState,SubState,MainPID,NRestarts,Result 'watcher@instance-1.service'",
      15000
    );
  });

  it('defaults service logs to 200 lines without a time filter', () => {
    const diagnostics = new DiagnosticService(vi.fn());
    expect(diagnostics.command('serviceLogs', { service: 'watcher' })).toBe(
      "journalctl --no-pager --output=short-iso --lines=200 --unit 'watcher'"
    );
  });

  it.each([1, 2000])('accepts the service log line boundary %i', async (lines) => {
    const execute = vi.fn().mockResolvedValue('log output');
    const diagnostics = new DiagnosticService(execute);

    await expect(
      diagnostics.run(device, 'serviceLogs', { service: 'watcher', lines, since: '2 hours ago' })
    ).resolves.toBe('log output');
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      device,
      `journalctl --no-pager --output=short-iso --lines=${lines} --since '2 hours ago' --unit 'watcher'`,
      15000
    );
  });

  it.each(['2026-01-02', '2026-01-02 03:04', '2026-01-02T03:04:05', '1 day ago'])(
    'quotes the supported time filter %s',
    (since) => {
      const diagnostics = new DiagnosticService(vi.fn());
      expect(diagnostics.command('serviceLogs', { service: 'watcher', since })).toBe(
        `journalctl --no-pager --output=short-iso --lines=200 --since '${since}' --unit 'watcher'`
      );
    }
  );

  it.each([0, -1, 2001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid line count %s before executing anything',
    async (lines) => {
      const execute = vi.fn();
      const diagnostics = new DiagnosticService(execute);

      await expect(
        diagnostics.run(device, 'serviceLogs', { service: 'watcher', lines })
      ).rejects.toThrow('lines must be between 1 and 2000.');
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each(['now', '2 weeks ago', '1 day ago; reboot', "2026-01-02'", '$(reboot)'])(
    'rejects invalid time filter %s before executing anything',
    async (since) => {
      const execute = vi.fn();
      const diagnostics = new DiagnosticService(execute);

      await expect(
        diagnostics.run(device, 'serviceLogs', { service: 'watcher', since })
      ).rejects.toThrow('Invalid since value.');
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each(['serviceStatus', 'serviceLogs'] as const)(
    'requires a service name for %s',
    async (kind) => {
      const execute = vi.fn();
      const diagnostics = new DiagnosticService(execute);

      await expect(diagnostics.run(device, kind)).rejects.toThrow('Invalid systemd service name.');
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each(['', '-watcher', 'watcher service', 'watcher;reboot', 'a'.repeat(129)])(
    'rejects unsupported service names: %s',
    (service) => {
      expect(() => DiagnosticService.validateService(service)).toThrow(
        'Invalid systemd service name.'
      );
    }
  );

  it('accepts a service name at the maximum length', () => {
    const service = 'a'.repeat(128);
    expect(DiagnosticService.validateService(service)).toBe(service);
  });

  it('propagates execution failures to the caller', async () => {
    const failure = new Error('SSH connection closed');
    const diagnostics = new DiagnosticService(vi.fn().mockRejectedValue(failure));
    await expect(diagnostics.run(device, 'uptime')).rejects.toBe(failure);
  });
});
