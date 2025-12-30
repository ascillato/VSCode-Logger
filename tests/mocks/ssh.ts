import { EventEmitter } from 'events';
import type { ClientChannel, ConnectConfig } from 'ssh2';

export class MockSshChannel extends EventEmitter {
  readonly stderr = new EventEmitter();

  emitData(data: string): void {
    this.emit('data', Buffer.from(data));
  }

  emitStderr(data: string): void {
    this.stderr.emit('data', Buffer.from(data));
  }

  emitExit(code: number | null = 0, signal: string | null = null): void {
    this.emit('exit', code, signal);
  }

  emitClose(): void {
    this.emit('close');
  }
}

export interface MockClientOptions {
  onExec?: (command: string, stream: MockSshChannel, client: MockSshClient) => void;
  onForwardOut?: (stream: MockSshChannel, client: MockSshClient) => void;
}

export class MockSshClient extends EventEmitter {
  lastConnectConfig: (ConnectConfig & { hostVerifier?: (key: Buffer) => boolean }) | undefined;
  readonly streams: MockSshChannel[] = [];
  private ended = false;

  constructor(private readonly options: MockClientOptions = {}) {
    super();
  }

  connect(config: ConnectConfig & { hostVerifier?: (key: Buffer) => boolean }): this {
    this.lastConnectConfig = config;
    const verified = config.hostVerifier ? config.hostVerifier(Buffer.from('mock-host-key')) : true;

    if (!verified) {
      queueMicrotask(() => this.emit('error', new Error('Host key rejected')));
      return this;
    }

    queueMicrotask(() => this.emit('ready'));
    return this;
  }

  exec(command: string, callback: (err: Error | undefined, stream: ClientChannel) => void): this {
    const stream = new MockSshChannel();
    this.streams.push(stream);
    callback(undefined, stream as unknown as ClientChannel);
    this.options.onExec?.(command, stream, this);
    return this;
  }

  forwardOut(
    _srcIP: string,
    _srcPort: number,
    _dstIP: string,
    _dstPort: number,
    callback: (err: Error | undefined, stream: ClientChannel) => void
  ): void {
    const stream = new MockSshChannel();
    this.streams.push(stream);
    callback(undefined, stream as unknown as ClientChannel);
    this.options.onForwardOut?.(stream, this);
  }

  end(): this {
    if (this.ended) {
      return this;
    }
    this.ended = true;
    this.emit('close');
    return this;
  }
}

export const createMockClient = (options?: MockClientOptions): MockSshClient =>
  new MockSshClient(options);
