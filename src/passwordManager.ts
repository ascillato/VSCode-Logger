/**
 * @file passwordManager.ts
 * @brief Provides helpers for storing and retrieving device passwords with workspace-aware keys.
 */

import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { EmbeddedDevice } from './deviceTree';

interface WorkspaceScope {
    id: string;
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

export class PasswordManager {
    constructor(private readonly context: vscode.ExtensionContext) {}

    async getPassword(device: EmbeddedDevice): Promise<string | undefined> {
        const host = device.host.trim();
        const username = device.username.trim();
        const workspaceScope = this.getWorkspaceScope();
        const key = this.buildKey(device, workspaceScope.id);

        const existing = await this.context.secrets.get(key);
        if (existing) {
            await this.saveMetadata(device.id, {
                key,
                host,
                username,
                workspaceId: workspaceScope.id,
                workspaceLabel: workspaceScope.label,
            });
            return existing;
        }

        const migrated = await this.tryReuseStoredPassword(device, host, username, workspaceScope);
        if (migrated) {
            return migrated;
        }

        const input = await vscode.window.showInputBox({
            prompt: `Enter SSH password for ${device.name}`,
            password: true,
            ignoreFocusOut: true,
        });

        if (input) {
            await this.storePassword(device, input);
        }

        return input;
    }

    async storePassword(device: EmbeddedDevice, password: string): Promise<void> {
        const host = device.host.trim();
        const username = device.username.trim();
        const workspaceScope = this.getWorkspaceScope();
        const key = this.buildKey(device, workspaceScope.id);

        await this.context.secrets.store(key, password);
        await this.saveMetadata(device.id, {
            key,
            host,
            username,
            workspaceId: workspaceScope.id,
            workspaceLabel: workspaceScope.label,
        });
    }

    private async tryReuseStoredPassword(
        device: EmbeddedDevice,
        host: string,
        username: string,
        workspaceScope: WorkspaceScope
    ): Promise<string | undefined> {
        const metadata = await this.getMetadata(device.id);
        const legacyKey = `${PASSWORD_PREFIX}${device.id}`;
        const legacyPassword = await this.context.secrets.get(legacyKey);

        if (!metadata && legacyPassword) {
            const reuseLegacy = await this.promptForReuse(
                device,
                username,
                host,
                'a previous version',
                `${device.name}`
            );

            if (reuseLegacy) {
                await this.storePassword(device, legacyPassword);
                await this.context.secrets.delete(legacyKey);
                return legacyPassword;
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
        const isSameWorkspace = metadata.workspaceId === workspaceScope.id;

        const requiresPrompt = !isSameHost || !isSameUser || !isSameWorkspace;
        if (requiresPrompt) {
            const reuse = await this.promptForReuse(
                device,
                username,
                host,
                metadata.workspaceLabel || 'another workspace',
                `${metadata.username}@${metadata.host}`
            );
            if (!reuse) {
                return undefined;
            }
        }

        await this.context.secrets.store(
            this.buildKey(device, workspaceScope.id),
            candidate
        );
        await this.saveMetadata(device.id, {
            key: this.buildKey(device, workspaceScope.id),
            host,
            username,
            workspaceId: workspaceScope.id,
            workspaceLabel: workspaceScope.label,
        });

        return candidate;
    }

    private buildKey(device: EmbeddedDevice, workspaceId: string): string {
        const hostHash = this.hashValue(device.host.trim().toLowerCase());
        const userHash = this.hashValue(device.username.trim());
        return `${PASSWORD_PREFIX}${device.id}.${workspaceId}.${hostHash}.${userHash}`;
    }

    private getWorkspaceScope(): WorkspaceScope {
        const workspaceFile = vscode.workspace.workspaceFile?.fsPath;
        const folderUris = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()).sort();
        const identifierSource = workspaceFile ?? folderUris?.join('|') ?? 'global';
        const label = vscode.workspace.name ?? folderUris?.map((folder) => folder.split('/').pop() ?? folder).join(', ') ?? 'global';
        return {
            id: this.hashValue(identifierSource),
            label,
        };
    }

    private async getMetadata(deviceId: string): Promise<PasswordMetadata | undefined> {
        const raw = await this.context.secrets.get(`${PASSWORD_METADATA_PREFIX}${deviceId}`);
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

    private async saveMetadata(deviceId: string, metadata: PasswordMetadata): Promise<void> {
        await this.context.secrets.store(
            `${PASSWORD_METADATA_PREFIX}${deviceId}`,
            JSON.stringify(metadata)
        );
    }

    async clearPassword(deviceId: string): Promise<void> {
        const metadata = await this.getMetadata(deviceId);
        if (metadata?.key) {
            await this.context.secrets.delete(metadata.key);
        }

        await this.context.secrets.delete(`${PASSWORD_PREFIX}${deviceId}`);
        await this.context.secrets.delete(`${PASSWORD_METADATA_PREFIX}${deviceId}`);
    }

    private async promptForReuse(
        device: EmbeddedDevice,
        username: string,
        host: string,
        source: string,
        storedFor: string
    ): Promise<boolean> {
        const reuseOption = 'Reuse saved password';
        const enterNewOption = 'Enter a new password';
        const message = `A saved password for ${device.name} exists from ${source} (${storedFor}). ` +
            `Do you want to reuse it for ${username}@${host}?`;

        const choice = await vscode.window.showWarningMessage(message, { modal: true }, reuseOption, enterNewOption);
        return choice === reuseOption;
    }

    private hashValue(value: string): string {
        return createHash('sha256').update(value).digest('hex');
    }
}
