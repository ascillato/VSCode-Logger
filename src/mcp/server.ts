import * as http from 'http';
import type { AddressInfo } from 'net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpToolDependencies } from './tools';
import { registerMcpTools } from './tools';
export interface McpServerStatus {
  running: boolean;
  host: '127.0.0.1';
  port?: number;
  endpoint?: string;
}
export class LocalMcpServer {
  private httpServer?: http.Server;
  private port?: number;
  private transports = new Set<StreamableHTTPServerTransport>();
  constructor(private d: McpToolDependencies) {}
  status(): McpServerStatus {
    return {
      running: !!this.httpServer,
      host: '127.0.0.1',
      port: this.port,
      endpoint: this.port ? `http://127.0.0.1:${this.port}/mcp` : undefined,
    };
  }
  async start(port: number): Promise<McpServerStatus> {
    if (this.httpServer) return this.status();
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('MCP port must be between 1024 and 65535.');
    const s = http.createServer((q, r) => void this.handle(q, r));
    s.on('connection', (x) => x.unref());
    await new Promise<void>((ok, no) => {
      const fail = (e: Error) => no(e);
      s.once('error', fail);
      s.listen(port, '127.0.0.1', () => {
        s.off('error', fail);
        ok();
      });
    });
    s.unref();
    this.httpServer = s;
    this.port = (s.address() as AddressInfo).port;
    this.d.log(`Server started at ${this.status().endpoint}`);
    return this.status();
  }
  async stop(): Promise<void> {
    if (!this.httpServer) return;
    for (const t of this.transports) await t.close();
    this.transports.clear();
    const s = this.httpServer;
    this.httpServer = undefined;
    this.port = undefined;
    await new Promise<void>((ok, no) => s.close((e) => (e ? no(e) : ok())));
    this.d.log('Server stopped');
  }
  private async handle(q: http.IncomingMessage, r: http.ServerResponse): Promise<void> {
    if (q.url !== '/mcp' || q.method !== 'POST') {
      r.writeHead(405, { 'Content-Type': 'application/json' });
      r.end(JSON.stringify({ error: 'Only POST /mcp is supported.' }));
      return;
    }
    try {
      const body = await this.read(q),
        t = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
      this.transports.add(t);
      t.onclose = () => this.transports.delete(t);
      const p = new McpServer(
        { name: 'embedded-device-logger', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );
      registerMcpTools(p, this.d);
      await p.connect(t);
      await t.handleRequest(q, r, body);
      await t.close();
    } catch (e) {
      this.d.log(`Request failed: ${e instanceof Error ? e.message : String(e)}`);
      if (!r.headersSent) r.writeHead(400, { 'Content-Type': 'application/json' });
      if (!r.writableEnded)
        r.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid MCP request.' },
            id: null,
          })
        );
    }
  }
  private async read(q: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of q) {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += b.length;
      if (size > 1048576) throw new Error('MCP request body is too large.');
      chunks.push(Buffer.from(b));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
}
