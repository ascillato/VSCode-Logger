/**
 * Manages SSH log streaming sessions, host-key verification, and reconnection logic.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import { Client } from 'ssh2';
import type { ClientChannel } from 'ssh2';
import type { BastionConfig, EmbeddedDevice } from '../deviceTree';
import type { HostEndpoint } from '../hostEndpoints';
import { getHostEndpoints } from '../hostEndpoints';
import type { PasswordManager } from '../passwordManager';
import type { LogSessionCallbacks } from './types';
import type { ClientFactory } from './connectionManager';
import { ConnectionManager } from './connectionManager';
import { HostKeyVerifier } from './hostKeyVerifier';
import { FingerprintPersistence } from './fingerprintPersistence';
import { AuthenticationProvider } from './authenticationProvider';
import { ReconnectionController } from './reconnectionController';
import type { HostKeyMismatchError } from './errors';
import type { AuthenticationResult } from './authenticationProvider';

interface ForwardingClient extends Client {
  forwardOut(
    srcIP: string,
    srcPort: number,
    dstIP: string,
    dstPort: number,
    callback: (err: Error | undefined, stream: ClientChannel) => void
  ): void;
}

export interface LogSessionDependencies {
  createClient?: () => Client;
  createForwardingClient?: () => ForwardingClient;
  passwordManager?: PasswordManager;
  authenticationProvider?: AuthenticationProvider;
}

/**
 * Coordinates connection, streaming, and reconnection for a device log session.
 */
export class LogSession {
  private readonly callbacks: LogSessionCallbacks;
  private readonly authenticator: AuthenticationProvider;
  private readonly fingerprintPersistence: FingerprintPersistence;
  private readonly clientFactory: ClientFactory;
  private readonly hostVerifier: HostKeyVerifier;
  private readonly bastionVerifier?: HostKeyVerifier;
  private readonly connectionManager: ConnectionManager;
  private connection:
    | { client: Client; bastionClient?: Client; stream?: ClientChannel }
    | undefined;
  private readonly buffer: { value: string } = { value: '' };
  private readonly attachedStreams = new WeakSet<ClientChannel>();
  private disposed = false;
  private closedNotified = false;
  private hasConnected = false;
  private bastionConfig: BastionConfig | undefined;

  constructor(
    private readonly device: EmbeddedDevice,
    private readonly context: vscode.ExtensionContext,
    callbacks: LogSessionCallbacks,
    private readonly dependencies: LogSessionDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.authenticator =
      dependencies.authenticationProvider ??
      new AuthenticationProvider(this.device, this.context, {
        passwordManager: dependencies.passwordManager,
        onPrompt: (): void =>
          this.callbacks.onStatus('Waiting for the user to enter the password…'),
      });

    this.hostVerifier = new HostKeyVerifier(
      this.device.name,
      'device',
      callbacks.onHostKeyMismatch
    );
    this.bastionConfig = this.authenticator.getBastionConfig();
    this.bastionVerifier = this.bastionConfig
      ? new HostKeyVerifier(`${this.device.name} bastion`, 'bastion', callbacks.onHostKeyMismatch)
      : undefined;
    this.fingerprintPersistence = new FingerprintPersistence(
      this.device,
      this.context,
      () => this.bastionConfig
    );
    const defaultCreateClient = (): Client => new Client();
    const defaultCreateForwardingClient = (): ForwardingClient => new Client() as ForwardingClient;
    this.clientFactory = {
      createClient: dependencies.createClient ?? defaultCreateClient,
      createForwardingClient: dependencies.createForwardingClient ?? defaultCreateForwardingClient,
    };
    this.connectionManager = new ConnectionManager(
      {
        onStatus: (message): void => {
          if (!this.disposed) {
            this.callbacks.onStatus(message);
          }
        },
        onError: (message): void => {
          if (!this.disposed) {
            this.callbacks.onError(message);
          }
        },
        onClose: (): void => this.handleClose(),
      },
      this.fingerprintPersistence,
      this.hostVerifier,
      this.clientFactory,
      this.bastionVerifier
    );
  }

  /**
   * Validates configuration, resolves authentication, and attempts to connect with retries.
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
      const authentication = await this.authenticator.getDeviceAuthentication();
      this.bastionConfig = this.authenticator.getBastionConfig();
      const bastionAuthentication = this.bastionConfig
        ? await this.authenticator.getBastionAuthentication(this.bastionConfig)
        : undefined;
      const endpoints = getHostEndpoints(this.device);

      if (endpoints.length === 0) {
        throw new Error(`Device "${this.device.name}" is missing a host.`);
      }

      const maxAttempts = endpoints.length > 1 ? 3 : 1;

      const reconnectController = new ReconnectionController({
        endpoints,
        maxAttempts,
        isDisposed: (): boolean => this.disposed,
        connect: async (endpoint): Promise<void> =>
          this.connect(endpoint, authentication, bastionAuthentication, logCommand),
        onHostKeyMismatch: async (error): Promise<boolean> => this.handleHostKeyMismatch(error),
      });

      await reconnectController.connect();
    } catch (err: unknown) {
      this.callbacks.onError(this.getErrorMessage(err));
      this.dispose();
    }
  }

  /**
   * Releases SSH resources and stops active streams.
   */
  dispose(): void {
    this.disposed = true;
    this.hasConnected = false;
    try {
      this.connection?.stream?.close?.();
      this.connection?.client?.end();
      this.connection?.bastionClient?.end();
    } catch (err: unknown) {
      console.error(err);
    }
  }

  private validateDeviceConfiguration(): string | undefined {
    const host = this.device.host?.trim();
    const username = this.device.username?.trim();
    if (!host) {
      return `Device "${this.device.name}" is missing a host.`;
    }
    if (!username) {
      return `Device "${this.device.name}" is missing a username.`;
    }
    if (
      this.device.port !== undefined &&
      (!Number.isInteger(this.device.port) || this.device.port <= 0)
    ) {
      return `Device "${this.device.name}" has an invalid port.`;
    }
    const bastion = this.bastionConfig;
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

  private getLogCommand(): string {
    const command = (this.device.logCommand ?? 'tail -F /var/log/syslog').trim();
    if (/\r|\n/.test(command)) {
      throw new Error('Log command must not contain control characters or new lines.');
    }
    return command;
  }

  /**
   * Opens the SSH connection (with optional bastion) and wires the log stream callbacks.
   */
  private async connect(
    endpoint: HostEndpoint,
    authentication: AuthenticationResult,
    bastionAuthentication: AuthenticationResult | undefined,
    logCommand: string
  ): Promise<void> {
    this.hostVerifier.reset();
    this.bastionVerifier?.reset();

    const connection = await this.connectionManager.connect({
      endpoint,
      authentication,
      logCommand,
      device: this.device,
      bastion: this.bastionConfig,
      bastionAuthentication,
      onStreamReady: (stream): void => this.attachStream(stream),
    });

    this.connection = connection;
    this.hasConnected = true;

    this.attachStream(connection.stream);
  }

  /**
   * Prompts the user to update a fingerprint and returns whether to retry.
   */
  private async handleHostKeyMismatch(error: HostKeyMismatchError): Promise<boolean> {
    const retry = await this.promptToUpdateFingerprint(
      error.expected,
      error.received,
      error.endpoint
    );
    if (retry) {
      await this.fingerprintPersistence.updateDeviceHostFingerprint(error.received, error.endpoint);
      this.hostVerifier.reset();
      this.bastionVerifier?.reset();
      return true;
    }
    return false;
  }

  private attachStream(stream: ClientChannel): void {
    if (!stream || this.attachedStreams.has(stream)) {
      return;
    }
    this.attachedStreams.add(stream);
    this.hasConnected = true;
    stream
      .on('data', (data: Buffer) => this.handleData(data))
      .on('close', () => this.handleClose())
      .stderr.on('data', (data: Buffer) => {
        if (this.disposed) {
          return;
        }
        this.callbacks.onError(data.toString());
      });
  }

  private handleData(data: Buffer): void {
    if (this.disposed) {
      return;
    }
    this.buffer.value += data.toString();
    let idx: number;
    while ((idx = this.buffer.value.indexOf('\n')) !== -1) {
      const line = this.buffer.value.slice(0, idx);
      this.buffer.value = this.buffer.value.slice(idx + 1);
      this.callbacks.onLine(line);
    }
  }

  private handleClose(): void {
    if (this.disposed || this.closedNotified || !this.hasConnected) {
      return;
    }
    this.closedNotified = true;
    this.callbacks.onClose();
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

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return typeof err === 'string' ? err : String(err);
  }
}
