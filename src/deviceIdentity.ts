/**
 * Helpers for generating and repairing stable device identifiers.
 *
 * @packageDocumentation
 */

type DeviceIdentitySource = {
  id?: unknown;
  name?: unknown;
  host?: unknown;
};

function normalizeExistingDeviceId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toDeviceIdSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getDeviceIdSeed(device: DeviceIdentitySource, index: number): string {
  const name = typeof device.name === 'string' ? device.name.trim() : '';
  if (name) {
    return name;
  }

  const host = typeof device.host === 'string' ? device.host.trim() : '';
  if (host) {
    return host;
  }

  return `device-${index + 1}`;
}

export function createUniqueDeviceId(seed: string, unavailableIds: ReadonlySet<string>): string {
  const base = toDeviceIdSlug(seed) || 'device';
  if (!unavailableIds.has(base)) {
    return base;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!unavailableIds.has(candidate)) {
      return candidate;
    }
  }
}

export function ensureUniqueDeviceIds<T extends DeviceIdentitySource>(
  devices: readonly T[]
): Array<T & { id: string }> {
  const normalizedIds = devices.map((device) => normalizeExistingDeviceId(device.id));
  const idCounts = new Map<string, number>();

  for (const id of normalizedIds) {
    if (!id) {
      continue;
    }
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const reservedUniqueIds = new Set<string>();
  for (const [id, count] of idCounts) {
    if (count === 1) {
      reservedUniqueIds.add(id);
    }
  }

  const usedIds = new Set<string>();

  return devices.map((device, index) => {
    const currentId = normalizedIds[index];
    let id: string;

    const unavailableIds = new Set([...usedIds, ...reservedUniqueIds]);

    if (currentId && idCounts.get(currentId) === 1 && !usedIds.has(currentId)) {
      id = currentId;
    } else if (currentId && !unavailableIds.has(currentId)) {
      id = currentId;
    } else {
      id = createUniqueDeviceId(currentId || getDeviceIdSeed(device, index), unavailableIds);
    }

    usedIds.add(id);
    return { ...device, id };
  });
}
