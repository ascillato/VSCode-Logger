/**
 * Helpers for resolving device host endpoints and fingerprints.
 *
 * @packageDocumentation
 */

import { EmbeddedDevice } from './deviceTree';

/**
 * Labels the origin of a host endpoint.
 */
export type HostEndpointLabel = 'primary' | 'secondary' | 'bastion';

/**
 * Describes a host endpoint and its known fingerprint.
 */
export interface HostEndpoint {
    host: string;
    fingerprint?: string;
    label: HostEndpointLabel;
}

/**
 * Builds the list of configured host endpoints for a device.
 *
 * @param device The device configuration to inspect.
 * @returns The resolved endpoint list in connection order.
 */
export function getHostEndpoints(device: EmbeddedDevice): HostEndpoint[] {
    const endpoints: HostEndpoint[] = [];
    const primary = device.host?.trim();
    if (primary) {
        endpoints.push({ host: primary, fingerprint: device.hostFingerprint?.trim(), label: 'primary' });
    }

    const secondary = device.secondaryHost?.trim();
    if (secondary) {
        endpoints.push({ host: secondary, fingerprint: device.secondaryHostFingerprint?.trim(), label: 'secondary' });
    }

    return endpoints;
}
