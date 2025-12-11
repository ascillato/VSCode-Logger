/**
 * @file logSession.ts
 * @brief Manages SSH connectivity and streaming of remote log output.
 * @copyright Copyright (c) 2025 A. Scillato
 */

import * as vscode from 'vscode';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
import { BastionConfig, EmbeddedDevice } from './deviceTree';
import { HostEndpoint, getHostEndpoints } from './hostEndpoints';
import { PasswordManager } from './passwordManager';

type ForwardingClient = Client & {
    forwardOut(
        srcIP: string,
        srcPort: number,
        dstIP: string,
        dstPort: number,
        callback: (err: Error | undefined, stream: any) => void
    ): void;
};

type SocketConnectConfig = ConnectConfig & { sock?: any };

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
        public readonly received: string,
        public readonly endpoint: HostEndpoint
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
    private bastionClient: Client | undefined;
    private stream: any;
    private buffer = '';
    private disposed = false;
    private closedNotified = false;
    private hostKeyFailure: { expected: string; received: string } | undefined;
    private bastionHostKeyFailure: { expected: string; received: string } | undefined;
    private lastSeenHostFingerprint: { display: string; hex: string } | undefined;
    private lastSeenBastionFingerprint: { display: string; hex: string } | undefined;
    private activeEndpoint: HostEndpoint | undefined;
    private activeBastionEndpoint: HostEndpoint | undefined;
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
            const authentication = await this.getAuthentication();
            const endpoints = getHostEndpoints(this.device);

            if (endpoints.length === 0) {
                throw new Error(`Device "${this.device.name}" is missing a host.`);
            }

            const maxAttempts = endpoints.length > 1 ? 3 : 1;
            let endpointIndex = 0;
            let attempts = 0;
            let lastError: any;

            while (!this.disposed && attempts < maxAttempts) {
                const endpoint = endpoints[endpointIndex];
                this.activeEndpoint = endpoint;

                try {
                    await this.connect(endpoint, authentication, logCommand);
                    return;
                } catch (err: any) {
                    if (err instanceof HostKeyMismatchError) {
                        const retry = await this.promptToUpdateFingerprint(err.expected, err.received, err.endpoint);
                        if (retry) {
                            await this.updateDeviceHostFingerprint(err.received, err.endpoint);
                            if (err.endpoint.label === 'bastion') {
                                this.bastionHostKeyFailure = undefined;
                                this.lastSeenBastionFingerprint = undefined;
                            } else {
                                this.hostKeyFailure = undefined;
                                this.lastSeenHostFingerprint = undefined;
                            }
                            continue;
                        }
                    }

                    lastError = err;
                    attempts++;

                    if (endpoints.length > 1) {
                        endpointIndex = (endpointIndex + 1) % endpoints.length;
                        continue;
                    }

                    break;
                }
            }

            throw lastError ?? new Error('Failed to connect to the device.');
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
        const bastion = this.device.bastion;
        if (bastion) {
            if (!bastion.host?.trim()) {
                return `Device "${this.device.name}" is missing a bastion host.`;
            }
            if (!bastion.username?.trim()) {
                return `Device "${this.device.name}" is missing a bastion username.`;
            }
            if (bastion.port !== undefined && (!Number.isInteger(bastion.port) || bastion.port <= 0)) {
                return `Device "${this.device.name}" has an invalid bastion port.`;
            }
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

    private async getAuthentication(): Promise<Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>> {
        const privateKeyPath = this.device.privateKeyPath?.trim();
        if (privateKeyPath) {
            const privateKey = await this.loadPrivateKey(privateKeyPath);
            const passphrase = await this.passwordManager.getPassphrase(this.device);
            return { privateKey, passphrase: passphrase || undefined };
        }

        const password = await this.passwordManager.getPassword(this.device);
        if (!password) {
            throw new Error('Password or private key is required to connect to the device.');
        }

        return { password };
    }

    private getBastionConfig(): BastionConfig | undefined {
        const bastion = this.device.bastion;
        if (!bastion?.host?.trim() || !bastion.username?.trim()) {
            return undefined;
        }

        return {
            ...bastion,
            host: bastion.host.trim(),
            username: bastion.username.trim(),
            port: bastion.port ?? 22,
            hostFingerprint: bastion.hostFingerprint?.trim(),
            privateKeyPath: bastion.privateKeyPath?.trim(),
        };
    }

    private async getBastionAuthentication(
        bastion: BastionConfig
    ): Promise<Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>> {
        if (bastion.privateKeyPath) {
            const privateKey = await this.loadPrivateKey(bastion.privateKeyPath);
            const bastionDevice = this.getBastionDevice(bastion);
            const passphrase = await this.passwordManager.getPassphrase(bastionDevice);
            return { privateKey, passphrase: passphrase || undefined };
        }

        const bastionDevice = this.getBastionDevice(bastion);
        const password = await this.passwordManager.getPassword(bastionDevice);
        if (!password) {
            throw new Error('Password or private key is required to connect to the bastion host.');
        }

        return { password };
    }

    private getBastionDevice(bastion: BastionConfig): EmbeddedDevice {
        return {
            id: `${this.device.id}-bastion`,
            name: `${this.device.name} bastion`,
            host: bastion.host,
            username: bastion.username,
        } as EmbeddedDevice;
    }

    private async loadPrivateKey(filePath: string): Promise<Buffer> {
        const expanded = this.expandPath(filePath);
        try {
            const content = await fs.readFile(expanded);
            if (!content.length) {
                throw new Error('The private key file is empty.');
            }
            return content;
        } catch (err: any) {
            const reason = err?.message ?? String(err);
            throw new Error(`Failed to read private key from ${expanded}: ${reason}`);
        }
    }

    private expandPath(value: string): string {
        const envExpanded = value.replace(/\$\{env:([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
        const tildeExpanded = envExpanded.startsWith('~')
            ? path.join(os.homedir(), envExpanded.slice(1))
            : envExpanded;
        return path.resolve(tildeExpanded);
    }

    /**
     * @brief Opens the SSH connection and starts the remote log command.
     * @param authentication Authentication configuration for the SSH connection.
     * @param logCommand Remote command to execute.
     * @returns Promise that resolves once streaming begins.
     */
    private async connect(
        endpoint: HostEndpoint,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        logCommand: string
    ): Promise<void> {
        const bastion = this.getBastionConfig();
        if (!bastion) {
            return this.connectToEndpoint(endpoint, authentication, logCommand);
        }

        const bastionAuthentication = await this.getBastionAuthentication(bastion);
        return this.connectThroughBastion(bastion, bastionAuthentication, endpoint, authentication, logCommand);
    }

    private connectThroughBastion(
        bastion: BastionConfig,
        bastionAuthentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        endpoint: HostEndpoint,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        logCommand: string
    ): Promise<void> {
        const bastionEndpoint: HostEndpoint = {
            host: bastion.host,
            fingerprint: bastion.hostFingerprint,
            label: 'bastion',
        };
        const expectedBastionFingerprint = this.getExpectedFingerprint(bastionEndpoint);
        this.bastionHostKeyFailure = undefined;
        this.lastSeenBastionFingerprint = undefined;
        this.activeBastionEndpoint = bastionEndpoint;

        return new Promise((resolve, reject) => {
            const bastionClient = new Client() as ForwardingClient;
            this.bastionClient = bastionClient;
            const bastionPort = bastion.port ?? 22;

            this.callbacks.onStatus(`Connecting to bastion ${bastion.host}:${bastionPort} ...`);

            bastionClient
                .on('ready', () => {
                    void this.persistBastionFingerprintIfMissing().catch((err) => {
                        this.callbacks.onError(err?.message ?? String(err));
                    });
                    this.callbacks.onStatus(
                        `Connected to bastion. Tunneling to ${endpoint.host}:${this.device.port ?? 22} ...`
                    );
                    bastionClient.forwardOut('127.0.0.1', 0, endpoint.host, this.device.port ?? 22, (err: Error | undefined, stream: any) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        void this.connectToEndpoint(endpoint, authentication, logCommand, stream)
                            .then(resolve)
                            .catch((connectionError) => {
                                bastionClient.end();
                                reject(connectionError);
                            });
                    });
                })
                .on('error', (err) => {
                    if (this.bastionHostKeyFailure) {
                        const message =
                            `Host key verification failed for bastion ${bastion.host}:${bastionPort}. Expected ${this.bastionHostKeyFailure.expected} but received ${this.bastionHostKeyFailure.received}.`;
                        reject(
                            new HostKeyMismatchError(
                                message,
                                this.bastionHostKeyFailure.expected,
                                this.bastionHostKeyFailure.received,
                                bastionEndpoint
                            )
                        );
                        return;
                    }
                    this.callbacks.onError(`SSH error: ${err.message}`);
                    reject(err);
                })
                .on('close', () => {
                    if (!this.closedNotified && !this.disposed) {
                        this.callbacks.onStatus('Bastion connection closed.');
                    }
                })
                .connect({
                    host: bastion.host,
                    port: bastionPort,
                    username: bastion.username,
                    ...bastionAuthentication,
                    hostHash: 'sha256',
                    hostVerifier: (key) => this.verifyBastionHostKey(key, expectedBastionFingerprint),
                });
        });
    }

    private connectToEndpoint(
        endpoint: HostEndpoint,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        logCommand: string,
        sock?: any
    ): Promise<void> {
        const expectedFingerprint = this.getExpectedFingerprint(endpoint);
        this.hostKeyFailure = undefined;
        this.lastSeenHostFingerprint = undefined;
        this.activeEndpoint = endpoint;
        return new Promise((resolve, reject) => {
            this.client = new Client();
            const port = this.device.port ?? 22;
            const host = endpoint.host;
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
                        reject(
                            new HostKeyMismatchError(
                                message,
                                this.hostKeyFailure.expected,
                                this.hostKeyFailure.received,
                                endpoint
                            )
                        );
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
                    sock,
                    ...authentication,
                    hostHash: 'sha256',
                    hostVerifier: (key) => this.verifyHostKey(key, expectedFingerprint),
                } as SocketConnectConfig);
        });
    }

    private getExpectedFingerprint(endpoint: HostEndpoint): { display: string; hex: string } | undefined {
        const fingerprint = endpoint.fingerprint;
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

    private verifyBastionHostKey(key: string | Buffer, expected?: { display: string; hex: string }): boolean {
        const actual = this.computeHostKeyFingerprints(key);
        this.lastSeenBastionFingerprint = actual;

        if (!expected) {
            return true;
        }

        const matches = actual.hex === expected.hex;

        if (!matches) {
            this.bastionHostKeyFailure = { expected: expected.display, received: actual.display };
            this.callbacks.onHostKeyMismatch?.(this.bastionHostKeyFailure);
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
        if (!this.activeEndpoint || this.activeEndpoint.fingerprint || !this.lastSeenHostFingerprint) {
            return;
        }

        await this.updateDeviceHostFingerprint(this.lastSeenHostFingerprint.display, this.activeEndpoint);
        this.callbacks.onStatus(`Captured SSH host fingerprint for ${this.device.name}.`);
    }

    private async persistBastionFingerprintIfMissing(): Promise<void> {
        if (
            !this.activeBastionEndpoint ||
            this.activeBastionEndpoint.fingerprint ||
            !this.lastSeenBastionFingerprint
        ) {
            return;
        }

        await this.updateDeviceHostFingerprint(this.lastSeenBastionFingerprint.display, this.activeBastionEndpoint);
        this.callbacks.onStatus(`Captured SSH host fingerprint for ${this.device.name} bastion.`);
    }

    private async updateDeviceHostFingerprint(fingerprint: string, endpoint: HostEndpoint): Promise<void> {
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
        const bastionConfig = this.getBastionConfig();

        let found = false;
        const updatedDevices = devices.map((device) => {
            if (device.id === this.device.id) {
                found = true;
                return {
                    ...device,
                    hostFingerprint: endpoint.label === 'primary' ? fingerprint : device.hostFingerprint,
                    secondaryHostFingerprint:
                        endpoint.label === 'secondary' ? fingerprint : device.secondaryHostFingerprint,
                    bastion:
                        endpoint.label === 'bastion'
                            ? bastionConfig
                                ? { ...bastionConfig, hostFingerprint: fingerprint }
                                : device.bastion
                            : device.bastion,
                } as EmbeddedDevice;
            }
            return device;
        });

        if (!found) {
            updatedDevices.push({
                ...this.device,
                hostFingerprint: endpoint.label === 'primary' ? fingerprint : this.device.hostFingerprint,
                secondaryHostFingerprint:
                    endpoint.label === 'secondary' ? fingerprint : this.device.secondaryHostFingerprint,
                bastion:
                    endpoint.label === 'bastion'
                        ? bastionConfig
                            ? { ...bastionConfig, hostFingerprint: fingerprint }
                            : this.device.bastion
                        : this.device.bastion,
            });
        }

        await config.update('devices', updatedDevices, target);
        if (endpoint.label === 'primary') {
            this.device.hostFingerprint = fingerprint;
        } else if (endpoint.label === 'secondary') {
            this.device.secondaryHostFingerprint = fingerprint;
        } else if (endpoint.label === 'bastion') {
            this.device.bastion = bastionConfig
                ? { ...bastionConfig, hostFingerprint: fingerprint }
                : this.device.bastion;
        }
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

    private async promptToUpdateFingerprint(
        expected: string,
        received: string,
        endpoint: HostEndpoint
    ): Promise<boolean> {
        const updateOption = 'Update fingerprint and connect';
        const cancelOption = 'Stop connection';
        const label = endpoint.label === 'bastion' ? `${this.device.name} bastion` : this.device.name;
        const hostDescription = endpoint.label === 'bastion' ? 'bastion host' : 'device';
        const choice = await vscode.window.showWarningMessage(
            `The SSH host fingerprint for ${label} (${hostDescription}) does not match. Expected ${expected} but received ${received}.`,
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
            this.bastionClient?.end();
        } catch (err) {
            console.error(err);
        }
    }
}
