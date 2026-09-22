export interface McpAuditEntry {
  timestamp: string;
  source: 'MCP';
  action: string;
  deviceId?: string;
  deviceName?: string;
  commandId?: string;
  commandName?: string;
  success: boolean;
  durationMs: number;
}
export class McpAudit {
  private entries: McpAuditEntry[] = [];
  constructor(private sink: (line: string) => void) {}
  record(entry: Omit<McpAuditEntry, 'timestamp' | 'source'>): void {
    const full = { timestamp: new Date().toISOString(), source: 'MCP' as const, ...entry };
    this.entries.push(full);
    if (this.entries.length > 1000) this.entries.shift();
    this.sink(JSON.stringify(full));
  }
  snapshot(): readonly McpAuditEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }
}
