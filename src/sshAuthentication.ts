/**
 * @file sshAuthentication.ts
 * @brief Helpers for resolving SSH authentication for devices.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { EmbeddedDevice } from './deviceTree';

export type SshAuthentication =
    | { type: 'password'; password: string }
    | { type: 'key'; privateKey: Buffer; passphrase?: string };

export function getPasswordSecretKey(deviceId: string): string {
    return `embeddedLogger.password.${deviceId}`;
}

export function getPrivateKeyPassphraseSecretKey(deviceId: string): string {
    return `embeddedLogger.privateKeyPassphrase.${deviceId}`;
}

export async function resolveSshAuthentication(
    device: EmbeddedDevice,
    context: vscode.ExtensionContext
): Promise<SshAuthentication> {
    if (device.privateKeyPath?.trim()) {
        const privateKey = await readPrivateKey(device.privateKeyPath);
        const passphrase = await getPrivateKeyPassphrase(device, context);
        return { type: 'key', privateKey, passphrase: passphrase ?? undefined };
    }

    const password = await getPassword(device, context);
    if (!password) {
        throw new Error('Password is required to connect to the device.');
    }

    return { type: 'password', password };
}

async function getPassword(device: EmbeddedDevice, context: vscode.ExtensionContext): Promise<string | undefined> {
    const key = getPasswordSecretKey(device.id);
    const stored = await context.secrets.get(key);
    if (stored) {
        return stored;
    }

    const input = await vscode.window.showInputBox({
        prompt: `Enter SSH password for ${device.name}`,
        password: true,
        ignoreFocusOut: true,
    });

    if (input) {
        await context.secrets.store(key, input);
    }

    return input;
}

async function getPrivateKeyPassphrase(
    device: EmbeddedDevice,
    context: vscode.ExtensionContext
): Promise<string | undefined> {
    const key = getPrivateKeyPassphraseSecretKey(device.id);
    const stored = await context.secrets.get(key);
    if (stored !== undefined) {
        return stored;
    }

    if (device.privateKeyPassphrase) {
        await context.secrets.store(key, device.privateKeyPassphrase);
        return device.privateKeyPassphrase;
    }

    const input = await vscode.window.showInputBox({
        prompt: `Enter passphrase for SSH key (${device.name})`,
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'Leave empty if your key is not encrypted',
    });

    if (input !== undefined) {
        await context.secrets.store(key, input);
    }

    return input;
}

async function readPrivateKey(rawPath: string): Promise<Buffer> {
    const expanded = rawPath.startsWith('~') ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;
    const resolved = path.resolve(expanded);

    try {
        return await fs.readFile(resolved);
    } catch (err: any) {
        throw new Error(`Failed to read private key at ${resolved}: ${err?.message ?? err}`);
    }
}
