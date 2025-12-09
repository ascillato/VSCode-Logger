/**
 * @file logSession.ts
 * @brief Manages SSH connectivity and streaming of remote log output.
 * @copyright Copyright (c) 2025 A. Scillato
 */

import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { Client } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';
import { PasswordManager } from './passwordManager';

/**
 * @brief Callback contract used to surface session events to the UI.
 */
export interface LogSessionCallbacks {
    onLine: (line: string) => void;
    onError: (message: string) => void;
    onStatus: (message: string) => void;
    onClose: () => void;
    onHostKeyMismatch?: (details: { expected: string; received: string }) => void;
}

class HostKeyMismatchError extends Error {
    constructor(
        message: string,
        public readonly expected: string,
        public readonly received: string
    ) {
        super(message);
        this.name = 'HostKeyMismatchError';
    }
}

/**
 * @brief Handles the SSH connection and streaming of logs from a device.
 */
export class LogSession {
    private client: Client | undefined;
    private stream: any;
    private buffer = '';
    private disposed = false;
    private closedNotified = false;
    private hostKeyFailure: { expected: string; received: string } | undefined;
    private lastSeenHostFingerprint: { display: string; hex: string } | undefined;
    private readonly passwordManager: PasswordManager;

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
    ) {
        this.passwordManager = new PasswordManager(this.context);
    }

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
            const password = await this.passwordManager.getPassword(this.device);
            if (!password) {
                throw new Error('Password is required to connect to the device.');
            }

            while (!this.disposed) {
                try {
                    await this.connect(password, logCommand);
                    return;
                } catch (err: any) {
                    if (err instanceof HostKeyMismatchError) {
                        const retry = await this.promptToUpdateFingerprint(err.expected, err.received);
                        if (retry) {
                            await this.updateDeviceHostFingerprint(err.received);
                            this.hostKeyFailure = undefined;
                            this.lastSeenHostFingerprint = undefined;
                            continue;
                        }
                    }

                    throw err;
                }
            }
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
     * @brief Opens the SSH connection and starts the remote log command.
     * @param password Password used for authentication.
     * @param logCommand Remote command to execute.
     * @returns Promise that resolves once streaming begins.
     */
    private async connect(password: string, logCommand: string): Promise<void> {
        const expectedFingerprint = this.getExpectedFingerprint();
        this.hostKeyFailure = undefined;
        this.lastSeenHostFingerprint = undefined;
        return new Promise((resolve, reject) => {
            this.client = new Client();
            const port = this.device.port ?? 22;
            const host = this.device.host.trim();
            const username = this.device.username.trim();

            this.callbacks.onStatus(`Connecting to ${host}:${port} ...`);

            this.client
                .on('ready', () => {
                    void this.persistFingerprintIfMissing().catch((err) => {
                        this.callbacks.onError(err?.message ?? String(err));
                    });
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
                    if (this.hostKeyFailure) {
                        const message = `Host key verification failed for ${host}:${port}. Expected ${this.hostKeyFailure.expected} but received ${this.hostKeyFailure.received}.`;
                        reject(new HostKeyMismatchError(message, this.hostKeyFailure.expected, this.hostKeyFailure.received));
                        return;
                    }
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
                    hostHash: 'sha256',
                    hostVerifier: (key) => this.verifyHostKey(key, expectedFingerprint),
                });
        });
    }

    private getExpectedFingerprint(): { display: string; hex: string } | undefined {
        const fingerprint = this.device.hostFingerprint?.trim();
        if (!fingerprint) {
            return undefined;
        }

        const parsed = this.parseFingerprint(fingerprint);
        return parsed;
    }

    private parseFingerprint(value: string): { display: string; hex: string } {
        const trimmed = value.trim();
        if (!trimmed) {
            throw new Error(`Device "${this.device.name}" is missing an SSH host key fingerprint.`);
        }

        const base64Candidate = trimmed.startsWith('SHA256:') ? trimmed.slice(7) : trimmed;
        const base64Pattern = /^[A-Za-z0-9+/=]+$/;
        if (base64Pattern.test(base64Candidate)) {
            try {
                const hex = Buffer.from(base64Candidate, 'base64').toString('hex').toLowerCase();
                if (!hex) {
                    throw new Error();
                }
                return { display: trimmed.startsWith('SHA256:') ? trimmed : `SHA256:${base64Candidate}`, hex };
            } catch {
                // fall through to validation error below
            }
        }

        const hexCandidate = trimmed.replace(/:/g, '').toLowerCase();
        const isValidHex = /^[0-9a-f]+$/.test(hexCandidate) && hexCandidate.length === 64;
        if (isValidHex) {
            return { display: trimmed, hex: hexCandidate };
        }

        throw new Error(
            `Device "${this.device.name}" has an invalid host fingerprint. Provide the SHA256 fingerprint (for example, "SHA256:..." from ssh-keygen).`
        );
    }

    private verifyHostKey(key: string | Buffer, expected?: { display: string; hex: string }): boolean {
        const actual = this.computeHostKeyFingerprints(key);
        this.lastSeenHostFingerprint = actual;

        if (!expected) {
            return true;
        }

        const matches = actual.hex === expected.hex;

        if (!matches) {
            this.hostKeyFailure = { expected: expected.display, received: actual.display };
            this.callbacks.onHostKeyMismatch?.(this.hostKeyFailure);
        }

        return matches;
    }

    private computeHostKeyFingerprints(key: string | Buffer): { display: string; hex: string } {
        if (typeof key === 'string') {
            const normalized = key.replace(/:/g, '').toLowerCase();
            const display = `SHA256:${Buffer.from(normalized, 'hex').toString('base64')}`;
            return { display, hex: normalized };
        }

        const digest = createHash('sha256').update(key).digest();
        return {
            display: `SHA256:${digest.toString('base64')}`,
            hex: digest.toString('hex'),
        };
    }

    private async persistFingerprintIfMissing(): Promise<void> {
        if (this.device.hostFingerprint || !this.lastSeenHostFingerprint) {
            return;
        }

        await this.updateDeviceHostFingerprint(this.lastSeenHostFingerprint.display);
        this.callbacks.onStatus(`Captured SSH host fingerprint for ${this.device.name}.`);
    }

    private async updateDeviceHostFingerprint(fingerprint: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('embeddedLogger');
        const inspected = config.inspect<EmbeddedDevice[]>('devices');
        const target = this.getConfigurationTarget(inspected);
        const baseDevices =
            inspected?.workspaceFolderValue ??
            inspected?.workspaceValue ??
            inspected?.globalValue ??
            inspected?.defaultValue ??
            config.get<EmbeddedDevice[]>('devices', []);
        const devices = Array.isArray(baseDevices) ? [...baseDevices] : [];

        let found = false;
        const updatedDevices = devices.map((device) => {
            if (device.id === this.device.id) {
                found = true;
                return { ...device, hostFingerprint: fingerprint } as EmbeddedDevice;
            }
            return device;
        });

        if (!found) {
            updatedDevices.push({ ...this.device, hostFingerprint: fingerprint });
        }

        await config.update('devices', updatedDevices, target);
        this.device.hostFingerprint = fingerprint;
    }

    private getConfigurationTarget(
        inspected:
            | {
                  workspaceFolderValue?: EmbeddedDevice[];
                  workspaceValue?: EmbeddedDevice[];
                  globalValue?: EmbeddedDevice[];
              }
            | undefined
    ): vscode.ConfigurationTarget {
        if (inspected?.workspaceFolderValue !== undefined) {
            return vscode.ConfigurationTarget.WorkspaceFolder;
        }
        if (inspected?.workspaceValue !== undefined) {
            return vscode.ConfigurationTarget.Workspace;
        }
        if (inspected?.globalValue !== undefined) {
            return vscode.ConfigurationTarget.Global;
        }
        return vscode.ConfigurationTarget.Workspace;
    }

    private async promptToUpdateFingerprint(expected: string, received: string): Promise<boolean> {
        const updateOption = 'Update fingerprint and connect';
        const cancelOption = 'Stop connection';
        const choice = await vscode.window.showWarningMessage(
            `The SSH host fingerprint for ${this.device.name} does not match. Expected ${expected} but received ${received}.`,
            { modal: true },
            updateOption,
            cancelOption
        );

        return choice === updateOption;
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
        if (this.disposed || this.closedNotified) {
            return;
        }
        this.closedNotified = true;
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
