/**
 * Provides helpers for storing and retrieving device passwords with workspace-aware keys.
 *
 * @packageDocumentation
 */

import { scrypt, webcrypto, type ScryptOptions } from 'crypto';
import * as vscode from 'vscode';
import type { EmbeddedDevice } from './deviceTree';

interface WorkspaceScope {
  id: string;
  legacyId: string;
  label: string;
}

interface PasswordMetadata {
  key: string;
  host: string;
  username: string;
  workspaceId: string;
  workspaceLabel: string;
}

const PASSWORD_PREFIX = 'embeddedLogger.password.';
const PASSWORD_METADATA_PREFIX = 'embeddedLogger.passwordMetadata.';
const PASSPHRASE_PREFIX = 'embeddedLogger.passphrase.';
const PASSPHRASE_METADATA_PREFIX = 'embeddedLogger.passphraseMetadata.';
const STORAGE_KEY_DERIVATION_VERSION = 'version-1';
const STORAGE_KEY_BYTES = 32;
const SCRYPT_OPTIONS: ScryptOptions = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  maxmem: 64 * 1024 * 1024,
};

type SecretKind = 'password' | 'passphrase';

interface SecretConfig {
  prefix: string;
  metadataPrefix: string;
  legacyKey?: (device: EmbeddedDevice) => string;
  promptLabel: (device: EmbeddedDevice) => string;
}

const SECRET_CONFIG: Record<SecretKind, SecretConfig> = {
  password: {
    prefix: PASSWORD_PREFIX,
    metadataPrefix: PASSWORD_METADATA_PREFIX,
    legacyKey: (device) => `${PASSWORD_PREFIX}${device.id}`,
    promptLabel: (device) => `Enter SSH password for ${device.name}`,
  },
  passphrase: {
    prefix: PASSPHRASE_PREFIX,
    metadataPrefix: PASSPHRASE_METADATA_PREFIX,
    promptLabel: (device) => `Enter passphrase for ${device.name} private key`,
  },
};

/**
 * Manages password and passphrase secrets for devices.
 */
export class PasswordManager {
  /**
   * Creates a password manager for the extension context.
   *
   * @param context The extension context with access to secrets.
   */
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Retrieves a stored password or prompts the user for one.
   *
   * @param device The device to authenticate.
   * @param options Optional prompt hooks for UI updates.
   * @returns The password, if available.
   */
  async getPassword(
    device: EmbeddedDevice,
    options?: { onPrompt?: () => void }
  ): Promise<string | undefined> {
    return this.getSecret('password', device, options);
  }

  /**
   * Retrieves a stored private key passphrase or prompts the user for one.
   *
   * @param device The device to authenticate.
   * @param options Optional prompt hooks for UI updates.
   * @returns The passphrase, if available.
   */
  async getPassphrase(
    device: EmbeddedDevice,
    options?: { onPrompt?: () => void }
  ): Promise<string | undefined> {
    return this.getSecret('passphrase', device, options);
  }

  /**
   * Stores a password in secret storage for the device.
   *
   * @param device The device to associate with the secret.
   * @param password The password to store.
   */
  async storePassword(device: EmbeddedDevice, password: string): Promise<void> {
    await this.storeSecret('password', device, password);
  }

  /**
   * Stores a private key passphrase in secret storage for the device.
   *
   * @param device The device to associate with the secret.
   * @param passphrase The passphrase to store.
   */
  async storePassphrase(device: EmbeddedDevice, passphrase: string): Promise<void> {
    await this.storeSecret('passphrase', device, passphrase);
  }

  private async getSecret(
    kind: SecretKind,
    device: EmbeddedDevice,
    options?: { onPrompt?: () => void }
  ): Promise<string | undefined> {
    const host = device.host.trim();
    const username = device.username.trim();
    const workspaceScope = await this.getWorkspaceScope();
    const config = SECRET_CONFIG[kind];
    const key = await this.buildKey(config.prefix, device, workspaceScope.id);

    const existing = await this.context.secrets.get(key);
    if (existing) {
      await this.saveMetadata(config.metadataPrefix, device.id, {
        key,
        host,
        username,
        workspaceId: workspaceScope.id,
        workspaceLabel: workspaceScope.label,
      });
      return existing;
    }

    const legacyScoped = await this.tryMigrateLegacyScopedSecret(
      config,
      device,
      host,
      username,
      workspaceScope
    );
    if (legacyScoped) {
      return legacyScoped;
    }

    const migrated = await this.tryReuseStoredSecret(kind, device, host, username, workspaceScope);
    if (migrated) {
      return migrated;
    }

    options?.onPrompt?.();
    const input = await vscode.window.showInputBox({
      prompt: config.promptLabel(device),
      password: true,
      ignoreFocusOut: true,
    });

    if (input) {
      await this.storeSecret(kind, device, input);
    }

    return input;
  }

  private async storeSecret(
    kind: SecretKind,
    device: EmbeddedDevice,
    value: string
  ): Promise<void> {
    const host = device.host.trim();
    const username = device.username.trim();
    const workspaceScope = await this.getWorkspaceScope();
    const config = SECRET_CONFIG[kind];
    const key = await this.buildKey(config.prefix, device, workspaceScope.id);

    await this.context.secrets.store(key, value);
    await this.saveMetadata(config.metadataPrefix, device.id, {
      key,
      host,
      username,
      workspaceId: workspaceScope.id,
      workspaceLabel: workspaceScope.label,
    });
  }

  private async tryReuseStoredSecret(
    kind: SecretKind,
    device: EmbeddedDevice,
    host: string,
    username: string,
    workspaceScope: WorkspaceScope
  ): Promise<string | undefined> {
    const config = SECRET_CONFIG[kind];
    const metadata = await this.getMetadata(config.metadataPrefix, device.id);
    const legacyKey = config.legacyKey?.(device);
    const legacyValue = legacyKey ? await this.context.secrets.get(legacyKey) : undefined;

    if (!metadata && legacyValue) {
      const reuseLegacy = await this.promptForReuse(
        device,
        username,
        host,
        'a previous version',
        `${device.name}`,
        kind === 'passphrase' ? 'passphrase' : 'password'
      );

      if (reuseLegacy) {
        await this.storeSecret(kind, device, legacyValue);
        await this.context.secrets.delete(legacyKey!);
        return legacyValue;
      }
      return undefined;
    }

    if (!metadata) {
      return undefined;
    }

    const candidate = await this.context.secrets.get(metadata.key);
    if (!candidate) {
      return undefined;
    }

    const isSameHost = metadata.host === host;
    const isSameUser = metadata.username === username;
    const isSameWorkspace =
      metadata.workspaceId === workspaceScope.id ||
      metadata.workspaceId === workspaceScope.legacyId;

    const requiresPrompt = !isSameHost || !isSameUser || !isSameWorkspace;
    if (requiresPrompt) {
      const reuse = await this.promptForReuse(
        device,
        username,
        host,
        metadata.workspaceLabel || 'another workspace',
        `${metadata.username}@${metadata.host}`,
        kind === 'passphrase' ? 'passphrase' : 'password'
      );
      if (!reuse) {
        return undefined;
      }
    }

    const key = await this.buildKey(config.prefix, device, workspaceScope.id);

    await this.context.secrets.store(key, candidate);
    await this.saveMetadata(config.metadataPrefix, device.id, {
      key,
      host,
      username,
      workspaceId: workspaceScope.id,
      workspaceLabel: workspaceScope.label,
    });
    await this.deleteCurrentWorkspaceLegacyScopedKey(
      config.prefix,
      device.id,
      metadata,
      workspaceScope
    );

    return candidate;
  }

  private async tryMigrateLegacyScopedSecret(
    config: SecretConfig,
    device: EmbeddedDevice,
    host: string,
    username: string,
    workspaceScope: WorkspaceScope
  ): Promise<string | undefined> {
    const legacyKey = await this.buildLegacyScopedKey(
      config.prefix,
      device.id,
      workspaceScope.legacyId,
      host,
      username
    );
    const legacyValue = await this.context.secrets.get(legacyKey);
    if (!legacyValue) {
      return undefined;
    }

    const key = await this.buildKey(config.prefix, device, workspaceScope.id);
    await this.context.secrets.store(key, legacyValue);
    await this.saveMetadata(config.metadataPrefix, device.id, {
      key,
      host,
      username,
      workspaceId: workspaceScope.id,
      workspaceLabel: workspaceScope.label,
    });
    await this.context.secrets.delete(legacyKey);

    return legacyValue;
  }

  private async deleteCurrentWorkspaceLegacyScopedKey(
    prefix: string,
    deviceId: string,
    metadata: PasswordMetadata,
    workspaceScope: WorkspaceScope
  ): Promise<void> {
    if (metadata.workspaceId !== workspaceScope.legacyId) {
      return;
    }

    const legacyKey = await this.buildLegacyScopedKey(
      prefix,
      deviceId,
      metadata.workspaceId,
      metadata.host,
      metadata.username
    );
    if (metadata.key === legacyKey) {
      await this.context.secrets.delete(metadata.key);
    }
  }

  private async buildKey(
    prefix: string,
    device: EmbeddedDevice,
    workspaceId: string
  ): Promise<string> {
    const material = JSON.stringify({
      deviceId: device.id,
      workspaceId,
      host: device.host.trim().toLowerCase(),
      username: device.username.trim(),
    });
    const digest = await this.deriveStorageIdentifier(`${prefix}secret`, material);
    return `${prefix}${device.id}.${digest}`;
  }

  private async buildLegacyScopedKey(
    prefix: string,
    deviceId: string,
    workspaceId: string,
    host: string,
    username: string
  ): Promise<string> {
    const hostHash = await this.legacySha256(host.trim().toLowerCase());
    const userHash = await this.legacySha256(username.trim());
    return `${prefix}${deviceId}.${workspaceId}.${hostHash}.${userHash}`;
  }

  private async getWorkspaceScope(): Promise<WorkspaceScope> {
    const workspaceFile = vscode.workspace.workspaceFile?.fsPath;
    const folderUris = vscode.workspace.workspaceFolders
      ?.map((folder) => folder.uri.toString())
      .sort();
    const identifierSource = workspaceFile ?? folderUris?.join('|') ?? 'global';
    const label =
      vscode.workspace.name ??
      folderUris?.map((folder) => folder.split('/').pop() ?? folder).join(', ') ??
      'global';
    return {
      id: await this.deriveStorageIdentifier('workspace', identifierSource),
      legacyId: await this.legacySha256(identifierSource),
      label,
    };
  }

  private async getMetadata(
    prefix: string,
    deviceId: string
  ): Promise<PasswordMetadata | undefined> {
    const raw = await this.context.secrets.get(`${prefix}${deviceId}`);
    if (!raw) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(raw) as PasswordMetadata;
      if (!parsed?.key || !parsed?.host || !parsed?.username || !parsed?.workspaceId) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async saveMetadata(
    prefix: string,
    deviceId: string,
    metadata: PasswordMetadata
  ): Promise<void> {
    await this.context.secrets.store(`${prefix}${deviceId}`, JSON.stringify(metadata));
  }

  async clearPassword(deviceId: string): Promise<void> {
    await this.clearSecret('password', deviceId);
    await this.clearSecret('passphrase', deviceId);
  }

  private async clearSecret(kind: SecretKind, deviceId: string): Promise<void> {
    const config = SECRET_CONFIG[kind];
    const metadata = await this.getMetadata(config.metadataPrefix, deviceId);
    if (metadata?.key) {
      await this.context.secrets.delete(metadata.key);
    }

    await this.context.secrets.delete(`${config.prefix}${deviceId}`);
    await this.context.secrets.delete(`${config.metadataPrefix}${deviceId}`);
  }

  private async promptForReuse(
    device: EmbeddedDevice,
    username: string,
    host: string,
    source: string,
    storedFor: string,
    secretLabel: string
  ): Promise<boolean> {
    const reuseOption = `Reuse saved ${secretLabel}`;
    const enterNewOption = `Enter a new ${secretLabel}`;
    const message =
      `A saved ${secretLabel} for ${device.name} exists from ${source} (${storedFor}). ` +
      `Do you want to reuse it for ${username}@${host}?`;

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      reuseOption,
      enterNewOption
    );
    return choice === reuseOption;
  }

  private async deriveStorageIdentifier(purpose: string, value: string): Promise<string> {
    const salt = `embeddedLogger.${purpose}.${STORAGE_KEY_DERIVATION_VERSION}`;
    const derived = await this.deriveScrypt(value, salt);
    return `${STORAGE_KEY_DERIVATION_VERSION}.${derived.toString('hex')}`;
  }

  private deriveScrypt(value: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(value, salt, STORAGE_KEY_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      });
    });
  }

  private async legacySha256(value: string): Promise<string> {
    const encoded = new TextEncoder().encode(value);
    const digest = await webcrypto.subtle.digest('SHA-256', encoded);
    return Buffer.from(digest).toString('hex');
  }
}
