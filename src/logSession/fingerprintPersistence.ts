/**
 * Persists SSH host fingerprints into workspace configuration and local device state.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import type { BastionConfig, EmbeddedDevice } from '../deviceTree';
import type { HostEndpoint } from '../hostEndpoints';

/**
 * Writes newly seen fingerprints back to configuration while keeping the in-memory device updated.
 */
export class FingerprintPersistence {
  constructor(
    private readonly device: EmbeddedDevice,
    private readonly context: vscode.ExtensionContext,
    private readonly bastionConfigProvider: () => BastionConfig | undefined
  ) {}

  /**
   * Saves the fingerprint when none exists for the endpoint.
   */
  async persistIfMissing(
    endpoint: HostEndpoint | undefined,
    lastSeen: { display: string; hex: string } | undefined
  ): Promise<void> {
    if (!endpoint || endpoint.fingerprint || !lastSeen) {
      return;
    }

    await this.updateDeviceHostFingerprint(lastSeen.display, endpoint);
  }

  /**
   * Updates the relevant device fingerprint in configuration and local state.
   */
  async updateDeviceHostFingerprint(fingerprint: string, endpoint: HostEndpoint): Promise<void> {
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
    const bastionConfig = this.bastionConfigProvider();

    let found = false;
    const updatedDevices = devices.map((device) => {
      if (device.id === this.device.id) {
        found = true;
        return this.mapDevice(device, endpoint, fingerprint, bastionConfig);
      }
      return device;
    });

    if (!found) {
      updatedDevices.push(this.mapDevice(this.device, endpoint, fingerprint, bastionConfig));
    }

    await config.update('devices', updatedDevices, target);
    endpoint.fingerprint = fingerprint;
    this.updateLocalDevice(endpoint, fingerprint, bastionConfig);
  }

  /**
   * Chooses the correct configuration scope for updating device fingerprints.
   */
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

  /**
   * Returns a device record updated with the new fingerprint for the provided endpoint.
   */
  private mapDevice(
    device: EmbeddedDevice,
    endpoint: HostEndpoint,
    fingerprint: string,
    bastionConfig: BastionConfig | undefined
  ): EmbeddedDevice {
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

  /**
   * Updates the cached device instance with the persisted fingerprint.
   */
  private updateLocalDevice(
    endpoint: HostEndpoint,
    fingerprint: string,
    bastionConfig: BastionConfig | undefined
  ): void {
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
}
