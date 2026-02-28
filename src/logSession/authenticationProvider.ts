/**
 * Resolves device and bastion authentication for SSH connections.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import type * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ConnectConfig } from 'ssh2';
import type { BastionConfig, EmbeddedDevice } from '../deviceTree';
import { PasswordManager } from '../passwordManager';

export type AuthenticationResult = Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>;

export interface AuthenticationProviderOptions {
  passwordManager?: PasswordManager;
  onPrompt?: () => void;
}

/**
 * Provides passwords or private keys for devices and optional bastion hosts.
 */
export class AuthenticationProvider {
  private readonly passwordManager: PasswordManager;

  constructor(
    private readonly device: EmbeddedDevice,
    private readonly context: vscode.ExtensionContext,
    private readonly options: AuthenticationProviderOptions = {}
  ) {
    this.passwordManager = options.passwordManager ?? new PasswordManager(context);
  }

  /**
   * Returns authentication material for the target device, prompting if necessary.
   */
  async getDeviceAuthentication(): Promise<AuthenticationResult> {
    const privateKeyPath = this.device.privateKeyPath?.trim();
    if (privateKeyPath) {
      const privateKey = await this.loadPrivateKey(privateKeyPath);
      const passphrase = await this.passwordManager.getPassphrase(this.device, {
        onPrompt: this.options.onPrompt,
      });
      return { privateKey, passphrase: passphrase || undefined };
    }

    const password = await this.passwordManager.getPassword(this.device, {
      onPrompt: this.options.onPrompt,
    });
    if (!password) {
      throw new Error('Password or private key is required to connect to the device.');
    }

    return { password };
  }

  /**
   * Returns normalized bastion configuration if present.
   */
  getBastionConfig(): BastionConfig | undefined {
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

  async getBastionAuthentication(bastion: BastionConfig): Promise<AuthenticationResult> {
    if (bastion.privateKeyPath) {
      const privateKey = await this.loadPrivateKey(bastion.privateKeyPath);
      const bastionDevice = this.getBastionDevice(bastion);
      const passphrase = await this.passwordManager.getPassphrase(bastionDevice, {
        onPrompt: this.options.onPrompt,
      });
      return { privateKey, passphrase: passphrase || undefined };
    }

    const bastionDevice = this.getBastionDevice(bastion);
    const password = await this.passwordManager.getPassword(bastionDevice, {
      onPrompt: this.options.onPrompt,
    });
    if (!password) {
      throw new Error('Password or private key is required to connect to the bastion host.');
    }

    return { password };
  }

  /**
   * Maps bastion configuration into a device-like shape for password storage.
   */
  private getBastionDevice(bastion: BastionConfig): EmbeddedDevice {
    return {
      id: `${this.device.id}-bastion`,
      name: `${this.device.name} bastion`,
      host: bastion.host,
      username: bastion.username,
    };
  }

  /**
   * Loads and validates a private key from disk.
   */
  private async loadPrivateKey(filePath: string): Promise<Buffer> {
    const expanded = this.expandPath(filePath);
    try {
      const content = await fs.readFile(expanded);
      if (!content.length) {
        throw new Error('The private key file is empty.');
      }
      return content;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      const wrappedError = new Error(
        `Failed to read private key from ${expanded}: ${reason}`
      ) as Error & { cause?: unknown };
      wrappedError.cause = err;
      throw wrappedError;
    }
  }

  /**
   * Expands environment and tilde tokens in file paths.
   */
  private expandPath(value: string): string {
    const envExpanded = value.replace(
      /\$\{env:([^}]+)\}/g,
      (_, name: string) => process.env[name] ?? ''
    );
    const tildeExpanded = envExpanded.startsWith('~')
      ? path.join(os.homedir(), envExpanded.slice(1))
      : envExpanded;
    return path.resolve(tildeExpanded);
  }
}
