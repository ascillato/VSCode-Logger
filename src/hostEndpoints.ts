import { EmbeddedDevice } from './deviceTree';

export type HostEndpointLabel = 'primary' | 'secondary';

export interface HostEndpoint {
    host: string;
    fingerprint?: string;
    label: HostEndpointLabel;
}

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
