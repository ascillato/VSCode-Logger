import * as vscode from 'vscode';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';

export interface LogSessionCallbacks {
    onLine: (line: string) => void;
    onError: (message: string) => void;
    onStatus: (message: string) => void;
    onClose: () => void;
}

/**
 * Handles the SSH connection and streaming of logs from a device.
 */
export class LogSession {
    private client: Client | undefined;
    private stream: ClientChannel | undefined;
    private buffer = '';
    private disposed = false;

    constructor(
        private readonly device: EmbeddedDevice,
        private readonly context: vscode.ExtensionContext,
        private readonly callbacks: LogSessionCallbacks
    ) {}

    async start(): Promise<void> {
        try {
            const password = await this.getPassword();
            if (!password) {
                throw new Error('Password is required to connect to the device.');
            }

            await this.connect(password);
        } catch (err: any) {
            this.callbacks.onError(err?.message ?? String(err));
            this.dispose();
        }
    }

    private async getPassword(): Promise<string | undefined> {
        const key = `embeddedLogger.password.${this.device.id}`;
        const stored = await this.context.secrets.get(key);
        if (stored) {
            return stored;
        }

        const input = await vscode.window.showInputBox({
            prompt: `Enter SSH password for ${this.device.name}`,
            password: true,
            ignoreFocusOut: true,
        });

        if (input) {
            await this.context.secrets.store(key, input);
        }

        return input;
    }

    private async connect(password: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.client = new Client();
            const port = this.device.port ?? 22;
            const logCommand = this.device.logCommand || 'tail -F /var/log/syslog';
            const connectConfig: ConnectConfig = {
                host: this.device.host,
                port,
                username: this.device.username,
                password,
            };

            this.callbacks.onStatus(`Connecting to ${this.device.host}:${port} ...`);

            this.client
                .on('ready', () => {
                    this.callbacks.onStatus('Connected. Streaming logs...');
                    this.client?.exec(logCommand, (err: Error | undefined, stream: ClientChannel) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        this.stream = stream;
                        stream
                            .on('data', (data: Buffer) => this.handleData(data))
                            .on('close', () => this.handleClose())
                            .stderr.on('data', (data: Buffer) => {
                                this.callbacks.onError(data.toString());
                            });
                        resolve();
                    });
                })
                .on('error', (err: Error) => {
                    this.callbacks.onError(`SSH error: ${err.message}`);
                    reject(err);
                })
                .on('close', () => {
                    this.callbacks.onStatus('Connection closed.');
                    this.handleClose();
                })
                .connect(connectConfig);
        });
    }

    private handleData(data: Buffer) {
        this.buffer += data.toString();
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            this.callbacks.onLine(line);
        }
    }

    private handleClose() {
        if (this.disposed) {
            return;
        }
        this.callbacks.onClose();
    }

    dispose() {
        this.disposed = true;
        try {
            this.stream?.close?.();
            this.client?.end();
        } catch (err) {
            console.error(err);
        }
    }
}
