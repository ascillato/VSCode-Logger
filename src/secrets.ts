/**
 * @file secrets.ts
 * @brief Helper utilities for managing device passwords in VS Code secret storage.
 */

import * as vscode from 'vscode';
import { EmbeddedDevice } from './deviceTree';

const SECRET_PREFIX = 'embeddedLogger.password';

function sanitizeSegment(value: string): string {
    return encodeURIComponent(value.trim());
}

function getWorkspaceScope(): string {
    const workspaceFile = vscode.workspace.workspaceFile?.fsPath;
    if (workspaceFile) {
        return workspaceFile;
    }

    const [firstFolder] = vscode.workspace.workspaceFolders ?? [];
    if (firstFolder) {
        return firstFolder.uri.fsPath;
    }

    return vscode.workspace.name ?? 'untitled-workspace';
}

function buildSecretKey(device: EmbeddedDevice): string {
    const workspaceScope = sanitizeSegment(getWorkspaceScope());
    const host = sanitizeSegment(device.host ?? '');
    const username = sanitizeSegment(device.username ?? '');
    const deviceId = sanitizeSegment(device.id);
    const userHost = sanitizeSegment(`${device.username ?? ''}@${device.host ?? ''}`);

    return `${SECRET_PREFIX}.${workspaceScope}.${deviceId}.${username}.${host}.${userHost}`;
}

function buildLegacySecretKey(device: EmbeddedDevice): string {
    return `${SECRET_PREFIX}.${device.id}`;
}

export async function clearStoredPassword(context: vscode.ExtensionContext, device: EmbeddedDevice): Promise<void> {
    await context.secrets.delete(buildSecretKey(device));
    await context.secrets.delete(buildLegacySecretKey(device));
}

export async function storePassword(
    context: vscode.ExtensionContext,
    device: EmbeddedDevice,
    password: string
): Promise<void> {
    await context.secrets.store(buildSecretKey(device), password);
    await context.secrets.delete(buildLegacySecretKey(device));
}

export async function getPasswordWithWorkspaceScope(
    context: vscode.ExtensionContext,
    device: EmbeddedDevice
): Promise<string | undefined> {
    const scopedKey = buildSecretKey(device);
    const stored = await context.secrets.get(scopedKey);
    if (stored) {
        return stored;
    }

    const legacyKey = buildLegacySecretKey(device);
    const legacyPassword = await context.secrets.get(legacyKey);
    if (legacyPassword) {
        const host = device.host?.trim() ?? '';
        const username = device.username?.trim() ?? '';
        const reuse = await vscode.window.showWarningMessage(
            `A saved password exists for ${device.name}, but the workspace now targets ${username}@${host}. Do you want to reuse it?`,
            { modal: true },
            'Reuse password',
            'Enter new password'
        );

        if (reuse === 'Reuse password') {
            await storePassword(context, device, legacyPassword);
            return legacyPassword;
        }
    }

    const input = await vscode.window.showInputBox({
        prompt: `Enter SSH password for ${device.name} (${device.username}@${device.host})`,
        password: true,
        ignoreFocusOut: true,
    });

    if (input) {
        await storePassword(context, device, input);
    }

    return input;
}

export async function migratePasswordToScopedKey(
    context: vscode.ExtensionContext,
    device: EmbeddedDevice,
    plaintextPassword?: string
): Promise<void> {
    const scopedKey = buildSecretKey(device);
    const existingScoped = await context.secrets.get(scopedKey);
    if (existingScoped) {
        return;
    }

    const legacyKey = buildLegacySecretKey(device);
    const legacyPassword = await context.secrets.get(legacyKey);
    const passwordToStore = legacyPassword ?? plaintextPassword;
    if (!passwordToStore) {
        return;
    }

    await storePassword(context, device, passwordToStore);
}
