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
        privateKey?: string | Buffer;
        passphrase?: string;
        hostHash?: string;
        hostVerifier?: (key: string | Buffer) => boolean;
    }

    export interface ClientChannel extends EventEmitter {
        on(event: 'data', listener: (data: Buffer) => void): this;
        on(event: 'exit', listener: (code: number | null, signal: string | null) => void): this;
        on(event: 'close', listener: () => void): this;
        stderr: EventEmitter & { on(event: 'data', listener: (data: Buffer) => void): this };
        write(data: string | Buffer): void;
        end(): void;
        close(): void;
        setWindow(rows: number, cols: number, height: number, width: number): void;
    }

    export class Client extends EventEmitter {
        on(event: 'ready', listener: () => void): this;
        on(event: 'error', listener: (err: Error) => void): this;
        on(event: 'close', listener: () => void): this;
        connect(config: ConnectConfig): this;
        shell(
            options: { term: string; cols: number; rows: number },
            callback: (err: Error | undefined, stream: ClientChannel) => void
        ): void;
        exec(command: string, callback: (err: Error | undefined, stream: ClientChannel) => void): void;
        end(): void;
    }
}
