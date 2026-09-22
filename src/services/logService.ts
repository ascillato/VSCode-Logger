export interface LogEntry {
  entryId: string;
  timestamp: string;
  level?: string;
  source: string;
  message: string;
}
export interface DeviceRuntimeState {
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  lastError?: string;
}
const LEVEL = /\b(trace|debug|info|notice|warn(?:ing)?|error|err|fatal|critical|crit)\b/i;
export class LogService {
  private entries = new Map<string, LogEntry[]>();
  private states = new Map<string, DeviceRuntimeState>();
  private sequence = 0;
  constructor(private capacity = 100000) {}
  append(deviceId: string, message: string, source = 'live'): LogEntry {
    const level = LEVEL.exec(message)?.[1]?.toLowerCase().replace('warning', 'warn');
    const entry = {
      entryId: `${deviceId}:${++this.sequence}`,
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
    };
    const values = this.entries.get(deviceId) ?? [];
    values.push(entry);
    if (values.length > this.capacity) values.splice(0, values.length - this.capacity);
    this.entries.set(deviceId, values);
    return entry;
  }
  setState(id: string, state: DeviceRuntimeState): void {
    this.states.set(id, { ...state });
  }
  getState(id: string): DeviceRuntimeState {
    return { ...(this.states.get(id) ?? { state: 'disconnected' }) };
  }
  snapshot(id: string): readonly LogEntry[] {
    return [...(this.entries.get(id) ?? [])];
  }
  sources(id: string): string[] {
    return [...new Set((this.entries.get(id) ?? []).map((e) => e.source))];
  }
}
export const sharedLogService = new LogService();
