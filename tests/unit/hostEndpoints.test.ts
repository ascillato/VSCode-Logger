import { describe, expect, it } from 'vitest';

import { getHostEndpoints } from '../../src/hostEndpoints';

describe('hostEndpoints', () => {
  it('trims configured hosts and omits blank primary or secondary endpoints', () => {
    expect(
      getHostEndpoints({
        id: 'device-1',
        name: 'Device One',
        host: ' primary.local ',
        hostFingerprint: ' SHA256:primary ',
        secondaryHost: ' ',
        secondaryHostFingerprint: ' SHA256:secondary ',
        username: 'root',
      })
    ).toEqual([
      {
        host: 'primary.local',
        fingerprint: 'SHA256:primary',
        label: 'primary',
      },
    ]);

    expect(
      getHostEndpoints({
        id: 'device-2',
        name: 'Device Two',
        host: ' ',
        secondaryHost: ' backup.local ',
        username: 'root',
      })
    ).toEqual([
      {
        host: 'backup.local',
        fingerprint: undefined,
        label: 'secondary',
      },
    ]);
  });
});
