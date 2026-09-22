import type { EmbeddedDevice } from '../deviceTree';
import { quoteShellArg } from '../sshCommandExecution';
export type DiagnosticKind =
  | 'systemInfo'
  | 'serviceStatus'
  | 'serviceLogs'
  | 'processes'
  | 'diskUsage'
  | 'memoryInfo'
  | 'networkInfo'
  | 'uptime';
export interface DiagnosticExecutor {
  (device: EmbeddedDevice, command: string, timeoutMs: number): Promise<string>;
}
const SERVICE = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$/;
const SINCE =
  /^(?:\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?|\d+\s+(?:seconds?|minutes?|hours?|days?)\s+ago)$/;
export class DiagnosticService {
  constructor(private execute: DiagnosticExecutor) {}
  static validateService(service: string): string {
    if (!SERVICE.test(service)) throw new Error('Invalid systemd service name.');
    return service;
  }
  command(
    kind: DiagnosticKind,
    o: { service?: string; lines?: number; since?: string } = {}
  ): string {
    switch (kind) {
      case 'systemInfo':
        return "printf 'hostname='; hostname; printf 'kernel='; uname -sr; printf 'architecture='; uname -m; printf 'uptime='; uptime; (cat /etc/os-release 2>/dev/null || true); (free -b 2>/dev/null || true)";
      case 'serviceStatus': {
        const s = DiagnosticService.validateService(o.service ?? '');
        return `systemctl show --no-pager --property=Id,LoadState,ActiveState,SubState,MainPID,NRestarts,Result ${quoteShellArg(s)}`;
      }
      case 'serviceLogs': {
        const s = DiagnosticService.validateService(o.service ?? '');
        const n = o.lines ?? 200;
        if (!Number.isInteger(n) || n < 1 || n > 2000)
          throw new Error('lines must be between 1 and 2000.');
        let since = '';
        if (o.since) {
          if (!SINCE.test(o.since)) throw new Error('Invalid since value.');
          since = ` --since ${quoteShellArg(o.since)}`;
        }
        return `journalctl --no-pager --output=short-iso --lines=${n}${since} --unit ${quoteShellArg(s)}`;
      }
      case 'processes':
        return 'ps -eo pid=,comm=,pcpu=,pmem=,stat= --sort=-pcpu | head -n 201';
      case 'diskUsage':
        return 'df -P -B1 | head -n 101';
      case 'memoryInfo':
        return "cat /proc/meminfo | sed -n '1,30p'";
      case 'networkInfo':
        return "ip -brief address; printf '\\nROUTES\\n'; ip route | head -n 100; printf '\\nLISTENING\\n'; ss -H -lntu | head -n 100";
      case 'uptime':
        return 'cat /proc/uptime; who -b 2>/dev/null || true';
    }
  }
  async run(
    d: EmbeddedDevice,
    k: DiagnosticKind,
    o?: { service?: string; lines?: number; since?: string }
  ): Promise<string> {
    return this.execute(d, this.command(k, o), 15000);
  }
}
