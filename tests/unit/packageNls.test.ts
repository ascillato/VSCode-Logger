/* eslint-disable spellcheck/spell-checker */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

interface CommandContribution {
  command: string;
  title?: string;
  shortTitle?: string;
}

interface PackageManifest {
  contributes: {
    commands: CommandContribution[];
    views: {
      embeddedLogger: Array<{
        id: string;
        name: string;
      }>;
    };
    viewsContainers: {
      activitybar: Array<{
        id: string;
        title: string;
      }>;
    };
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const requiredPackageNlsKeys = [
  'embeddedLogger.viewsContainers.activitybar.title',
  'embeddedLogger.views.devicesView.name',
  'embeddedLogger.commands.openLocalLogFile.title',
  'embeddedLogger.commands.editDevicesConfig.title',
  'embeddedLogger.commands.pingAllDevices.title',
] as const;

const titleToolbarCommandKeys = new Map([
  ['embeddedLogger.openLocalLogFile', 'embeddedLogger.commands.openLocalLogFile.title'],
  ['embeddedLogger.editDevicesConfig', 'embeddedLogger.commands.editDevicesConfig.title'],
  ['embeddedLogger.pingAllDevices', 'embeddedLogger.commands.pingAllDevices.title'],
]);

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, fileName), 'utf8')) as T;
}

describe('package NLS manifest contributions', () => {
  it('uses NLS tokens for the Devices view and title-toolbar commands', () => {
    const manifest = readJson<PackageManifest>('package.json');

    expect(manifest.contributes.viewsContainers.activitybar[0]).toEqual(
      expect.objectContaining({
        id: 'embeddedLogger',
        title: '%embeddedLogger.viewsContainers.activitybar.title%',
      })
    );
    expect(manifest.contributes.views.embeddedLogger[0]).toEqual(
      expect.objectContaining({
        id: 'embeddedLogger.devicesView',
        name: '%embeddedLogger.views.devicesView.name%',
      })
    );

    for (const [commandId, nlsKey] of titleToolbarCommandKeys) {
      const command = manifest.contributes.commands.find((item) => item.command === commandId);

      expect(command, commandId).toBeTruthy();
      expect(command?.title, commandId).toBe(`%${nlsKey}%`);
      expect(command?.shortTitle, commandId).toBe(`%${nlsKey}%`);
    }
  });

  it('defines every required package NLS key for each shipped locale', () => {
    const packageNlsFiles = readdirSync(repoRoot).filter((fileName) =>
      /^package\.nls(?:\.[a-z-]+)?\.json$/.test(fileName)
    );

    expect(packageNlsFiles).toContain('package.nls.json');
    expect(packageNlsFiles.length).toBeGreaterThan(1);

    for (const fileName of packageNlsFiles) {
      const bundle = readJson<Record<string, unknown>>(fileName);

      for (const key of requiredPackageNlsKeys) {
        expect(typeof bundle[key], `${fileName}:${key}`).toBe('string');
        expect(bundle[key], `${fileName}:${key}`).not.toBe('');
      }
    }
  });
});
