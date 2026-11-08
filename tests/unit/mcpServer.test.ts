import { EventEmitter } from 'events';
import type { IncomingMessage, RequestListener, ServerResponse } from 'http';
import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMcpServer } from '../../src/mcp/server';
import { McpAudit } from '../../src/mcp/audit';
import { McpSanitizer } from '../../src/mcp/sanitizer';
import { DiagnosticService } from '../../src/services/diagnosticService';
import { LogService } from '../../src/services/logService';

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  McpServer: vi.fn(),
  Transport: vi.fn(),
  registerTools: vi.fn(),
}));

vi.mock('http', () => ({ createServer: mocks.createServer }));
// eslint-disable-next-line spellcheck/spell-checker -- External SDK module name.
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({ McpServer: mocks.McpServer }));
// eslint-disable-next-line spellcheck/spell-checker -- External SDK module name.
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: mocks.Transport,
}));
vi.mock('../../src/mcp/tools', () => ({ registerMcpTools: mocks.registerTools }));

class MockHttpServer extends EventEmitter {
  unref = vi.fn();
  address = vi.fn(() => ({ port: 39170 }));
  listen = vi.fn((_port: number, _host: string, ready: () => void) => ready());
  close = vi.fn((done: (error?: Error) => void) => done());
}

class MockTransport {
  onclose?: () => void;
  handleRequest = vi.fn<
    (request: IncomingMessage, response: ServerResponse, body: unknown) => Promise<void>
  >(async (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', result: {}, id: 1 }));
  });
  close = vi.fn(async () => this.onclose?.());
}

function dependencies() {
  return {
    getDevices: () => [],
    logs: new LogService(),
    diagnostics: new DiagnosticService(vi.fn()),
    runCommand: vi.fn(),
    allowCustomCommands: () => false,
    confirm: vi.fn(),
    sanitizer: new McpSanitizer(true),
    audit: new McpAudit(vi.fn()),
    log: vi.fn(),
  };
}

function response() {
  const result = {
    headersSent: false,
    writableEnded: false,
    writeHead: vi.fn<(status: number, headers: Record<string, string>) => void>(() => {
      result.headersSent = true;
    }),
    end: vi.fn<(body: string) => void>(() => {
      result.writableEnded = true;
    }),
  };
  return result;
}

describe('LocalMcpServer', () => {
  let httpServer: MockHttpServer;
  let listener: RequestListener;
  let transport: MockTransport;
  let protocol: { connect: ReturnType<typeof vi.fn> };
  let deps: ReturnType<typeof dependencies>;
  let server: LocalMcpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    httpServer = new MockHttpServer();
    transport = new MockTransport();
    protocol = { connect: vi.fn().mockResolvedValue(undefined) };
    mocks.createServer.mockImplementation((handler: RequestListener) => {
      listener = handler;
      return httpServer;
    });
    mocks.Transport.mockImplementation(function () {
      return transport;
    });
    mocks.McpServer.mockImplementation(function () {
      return protocol;
    });
    deps = dependencies();
    server = new LocalMcpServer(deps);
  });

  function request(chunks: (string | Buffer)[], url = '/mcp', method = 'POST') {
    const incoming = Object.assign(Readable.from(chunks), { url, method });
    const outgoing = response();
    listener(incoming as IncomingMessage, outgoing as unknown as ServerResponse);
    return { incoming, outgoing };
  }

  it('starts only once on loopback and releases server and connection references', async () => {
    expect(server.status()).toEqual({
      running: false,
      host: '127.0.0.1',
      port: undefined,
      endpoint: undefined,
    });
    const status = await server.start(39170);
    expect(status).toEqual({
      running: true,
      host: '127.0.0.1',
      port: 39170,
      endpoint: 'http://127.0.0.1:39170/mcp',
    });
    expect(httpServer.listen).toHaveBeenCalledWith(39170, '127.0.0.1', expect.any(Function));
    expect(httpServer.listenerCount('error')).toBe(0);
    expect(httpServer.unref).toHaveBeenCalledOnce();
    const socket = { unref: vi.fn() };
    httpServer.emit('connection', socket);
    expect(socket.unref).toHaveBeenCalledOnce();
    expect(await server.start(39171)).toEqual(status);
    expect(mocks.createServer).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith('Server started at http://127.0.0.1:39170/mcp');

    await server.stop();
    await server.stop();
    expect(httpServer.close).toHaveBeenCalledOnce();
    expect(server.status()).toMatchObject({ running: false, port: undefined, endpoint: undefined });
    expect(deps.log).toHaveBeenLastCalledWith('Server stopped');
  });

  it.each([1023, 65536, 39170.5, NaN, Infinity])(
    'rejects invalid port %s before listening',
    async (port) => {
      await expect(server.start(port)).rejects.toThrow('MCP port must be between 1024 and 65535.');
      expect(mocks.createServer).not.toHaveBeenCalled();
      expect(server.status().running).toBe(false);
    }
  );

  it.each([1024, 65535])('accepts boundary port %s', async (port) => {
    httpServer.address.mockReturnValue({ port });
    expect((await server.start(port)).port).toBe(port);
    await server.stop();
  });

  it('reports listen failures without claiming the server is running', async () => {
    const error = new Error('Port is occupied');
    httpServer.listen.mockImplementation(() => {
      httpServer.emit('error', error);
    });
    await expect(server.start(39170)).rejects.toBe(error);
    expect(server.status().running).toBe(false);
    expect(deps.log).not.toHaveBeenCalled();
    await server.stop();
    expect(httpServer.close).not.toHaveBeenCalled();
  });

  it('propagates close failures and clears the running status', async () => {
    await server.start(39170);
    const error = new Error('Close failed');
    httpServer.close.mockImplementation((done) => done(error));
    await expect(server.stop()).rejects.toBe(error);
    expect(server.status().running).toBe(false);
    expect(deps.log).not.toHaveBeenCalledWith('Server stopped');
  });

  it.each([
    ['/other', 'POST'],
    ['/mcp', 'GET'],
    ['/mcp', 'DELETE'],
  ])('rejects unsupported request %s %s before creating a transport', async (url, method) => {
    await server.start(39170);
    const { outgoing } = request([], url, method);
    expect(outgoing.writeHead).toHaveBeenCalledWith(405, { 'Content-Type': 'application/json' });
    expect(outgoing.end).toHaveBeenCalledWith(
      JSON.stringify({ error: 'Only POST /mcp is supported.' })
    );
    expect(mocks.Transport).not.toHaveBeenCalled();
    await server.stop();
  });

  it('parses streamed JSON, registers tools and closes the stateless transport', async () => {
    await server.start(39170);
    const body = { jsonrpc: '2.0', method: 'tools/list', id: 1 };
    const json = JSON.stringify(body);
    const { incoming, outgoing } = request([Buffer.from(json.slice(0, 12)), json.slice(12)]);

    await vi.waitFor(() => expect(transport.close).toHaveBeenCalledOnce());
    expect(mocks.Transport).toHaveBeenCalledWith({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    expect(mocks.McpServer).toHaveBeenCalledWith(
      { name: 'embedded-device-logger', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    expect(mocks.registerTools).toHaveBeenCalledExactlyOnceWith(protocol, deps);
    expect(protocol.connect).toHaveBeenCalledExactlyOnceWith(transport);
    expect(transport.handleRequest).toHaveBeenCalledWith(incoming, outgoing, body);
    expect(outgoing.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    await server.stop();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['malformed JSON', ['{invalid']],
    ['empty body', []],
    ['body above the size limit', [Buffer.alloc(1048576, ' '), Buffer.from(' ')]],
  ])('returns a generic error for %s', async (_name, chunks) => {
    await server.start(39170);
    const { outgoing } = request(chunks);
    await vi.waitFor(() => expect(outgoing.end).toHaveBeenCalledOnce());
    expect(outgoing.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
    expect(outgoing.end).toHaveBeenCalledWith(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid MCP request.' },
        id: null,
      })
    );
    expect(mocks.Transport).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenLastCalledWith(expect.stringContaining('Request failed:'));
    await server.stop();
  });

  it('accepts JSON at the one-megabyte request boundary', async () => {
    await server.start(39170);
    request([`"${'x'.repeat(1048574)}"`]);
    await vi.waitFor(() => expect(transport.close).toHaveBeenCalledOnce());
    expect(transport.handleRequest.mock.calls[0][2]).toBe('x'.repeat(1048574));
    await server.stop();
  });

  it('reports connection errors and closes the outstanding transport when stopped', async () => {
    await server.start(39170);
    protocol.connect.mockRejectedValue(new Error('Protocol connection failed'));
    const { outgoing } = request(['{}']);
    await vi.waitFor(() => expect(outgoing.end).toHaveBeenCalledOnce());
    expect(deps.log).toHaveBeenLastCalledWith('Request failed: Protocol connection failed');
    expect(transport.handleRequest).not.toHaveBeenCalled();
    expect(transport.close).not.toHaveBeenCalled();
    await server.stop();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('does not write headers or end an already completed failed response', async () => {
    await server.start(39170);
    transport.handleRequest.mockRejectedValue('Transport failed');
    const { outgoing } = request(['{}']);
    outgoing.headersSent = true;
    outgoing.writableEnded = true;
    await vi.waitFor(() =>
      expect(deps.log).toHaveBeenLastCalledWith('Request failed: Transport failed')
    );
    expect(outgoing.writeHead).not.toHaveBeenCalled();
    expect(outgoing.end).not.toHaveBeenCalled();
    await server.stop();
  });

  it('ends an unfinished failed response without overwriting sent headers', async () => {
    await server.start(39170);
    transport.handleRequest.mockRejectedValue(new Error('Transport failed'));
    const { outgoing } = request(['{}']);
    outgoing.headersSent = true;
    await vi.waitFor(() => expect(outgoing.end).toHaveBeenCalledOnce());
    expect(outgoing.writeHead).not.toHaveBeenCalled();
    expect(outgoing.end).toHaveBeenCalledWith(expect.stringContaining('Invalid MCP request.'));
    await server.stop();
  });
});
