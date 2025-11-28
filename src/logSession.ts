/**
 * @file logSession.ts
 * @brief Manages SSH connectivity and streaming of remote log output.
 * @copyright Copyright (c) 2024 Scallant
 */

import * as vscode from 'vscode';
import { Client } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';

/**
 * @brief Callback contract used to surface session events to the UI.
 */
export interface LogSessionCallbacks {
    onLine: (line: string) => void;
    onError: (message: string) => void;
    onStatus: (message: string) => void;
    onClose: () => void;
}

/**
 * @brief Handles the SSH connection and streaming of logs from a device.
 */
export class LogSession {
    private client: Client | undefined;
    private stream: any;
    private buffer = '';
    private disposed = false;

    /**
     * @brief Creates a new log session.
     * @param device Device configuration providing connection details.
     * @param context Extension context used to access secret storage.
     * @param callbacks Hooks used to emit updates back to the UI.
     */
    constructor(
        private readonly device: EmbeddedDevice,
        private readonly context: vscode.ExtensionContext,
        private readonly callbacks: LogSessionCallbacks
    ) {}

    /**
     * @brief Starts the SSH session and begins streaming logs.
     */
    async start(): Promise<void> {
        try {
            if (!vscode.workspace.isTrusted) {
                throw new Error('Workspace trust is required before connecting to devices.');
            }

            const validationError = this.validateDeviceConfiguration();
            if (validationError) {
                throw new Error(validationError);
            }

            const logCommand = this.getLogCommand();
            const password = await this.getPassword();
            if (!password) {
                throw new Error('Password is required to connect to the device.');
            }

            await this.connect(password, logCommand);
        } catch (err: any) {
            this.callbacks.onError(err?.message ?? String(err));
            this.dispose();
        }
    }

    /**
     * @brief Validates the device configuration for required fields.
     * @returns A user-facing error message when invalid, otherwise undefined.
     */
    private validateDeviceConfiguration(): string | undefined {
        const host = this.device.host?.trim();
        const username = this.device.username?.trim();
        if (!host) {
            return `Device "${this.device.name}" is missing a host.`;
        }
        if (!username) {
            return `Device "${this.device.name}" is missing a username.`;
        }
        if (this.device.port !== undefined && (!Number.isInteger(this.device.port) || this.device.port <= 0)) {
            return `Device "${this.device.name}" has an invalid port.`;
        }
        return undefined;
    }

    /**
     * @brief Determines the log command to execute on the remote device.
     * @returns Sanitized log command string.
     * @throws Error when the command contains invalid characters.
     */
    private getLogCommand(): string {
        const command = (this.device.logCommand ?? 'tail -F /var/log/syslog').trim();
        if (/\r|\n/.test(command)) {
            throw new Error('Log command must not contain control characters or new lines.');
        }
        return command;
    }

    /**
     * @brief Retrieves the password for the device, prompting the user if necessary.
     * @returns The stored or newly entered password, or undefined when missing.
     */
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

    /**
     * @brief Opens the SSH connection and starts the remote log command.
     * @param password Password used for authentication.
     * @param logCommand Remote command to execute.
     * @returns Promise that resolves once streaming begins.
     */
    private async connect(password: string, logCommand: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client = new Client();
            const port = this.device.port ?? 22;
            const host = this.device.host.trim();
            const username = this.device.username.trim();

            this.callbacks.onStatus(`Connecting to ${host}:${port} ...`);

            this.client
                .on('ready', () => {
                    this.callbacks.onStatus('Connected. Streaming logs...');
                    this.client?.exec(logCommand, (err, stream) => {
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
                .on('error', (err) => {
                    this.callbacks.onError(`SSH error: ${err.message}`);
                    reject(err);
                })
                .on('close', () => {
                    this.callbacks.onStatus('Connection closed.');
                    this.handleClose();
                })
                .connect({
                    host,
                    port,
                    username,
                    password,
                });
        });
    }

    /**
     * @brief Processes data buffers from the SSH stream and emits complete lines.
     * @param data Chunk of data received from the remote stream.
     */
    private handleData(data: Buffer) {
        this.buffer += data.toString();
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            this.callbacks.onLine(line);
        }
    }

    /**
     * @brief Handles stream closures and notifies callbacks if not disposed.
     */
    private handleClose() {
        if (this.disposed) {
            return;
        }
        this.callbacks.onClose();
    }

    /**
     * @brief Disposes SSH resources and prevents further callbacks.
     */
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
