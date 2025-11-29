/**
 * @file ssh2.d.ts
 * @brief Minimal type declarations for the ssh2 package used by the extension.
 * @copyright Copyright (c) 2025 A. Scillato
 */

declare module 'ssh2' {
    import { EventEmitter } from 'events';

    export interface ConnectConfig {
        host: string;
        port?: number;
        username: string;
        password?: string;
    }

    export interface ClientChannel extends EventEmitter {
        on(event: 'data', listener: (data: Buffer) => void): this;
        on(event: 'close', listener: () => void): this;
        stderr: EventEmitter & { on(event: 'data', listener: (data: Buffer) => void): this };
        close(): void;
    }

    export class Client extends EventEmitter {
        on(event: 'ready', listener: () => void): this;
        on(event: 'error', listener: (err: Error) => void): this;
        on(event: 'close', listener: () => void): this;
        connect(config: ConnectConfig): this;
        exec(command: string, callback: (err: Error | undefined, stream: ClientChannel) => void): void;
        end(): void;
    }
}
