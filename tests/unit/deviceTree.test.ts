import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import { DeviceTreeDataProvider } from '../../src/deviceTree';
import {
  ThemeIcon,
  createExtensionContext,
  resetWorkspaceConfiguration,
  workspace,
} from '../mocks/vscode';

describe('deviceTree', () => {
  beforeEach(() => {
    resetWorkspaceConfiguration();
  });

  it('returns a placeholder item when no devices or groups are configured', async () => {
    const provider = new DeviceTreeDataProvider(createExtensionContext());

    const items = await provider.getChildren();
    const [item] = items;

    expect(items).toHaveLength(1);
    expect(item.label).toBe('No devices configured. Update "embeddedLogger.devices" in settings.');
    expect(item.tooltip).toBe('Open settings to configure embedded devices.');
    expect(item.command).toEqual({
      command: 'workbench.action.openSettings',
      title: 'Open Settings',
      arguments: ['embeddedLogger.devices'],
    });
  });

  it('returns group items first and ungrouped devices afterwards', async () => {
    await workspace.getConfiguration('embeddedLogger').update('groups', [{ name: 'Lab' }]);
    await workspace.getConfiguration('embeddedLogger').update('devices', [
      {
        id: 'grouped-device',
        group: 'Lab',
        name: 'Grouped Device',
        host: '10.0.0.10',
        username: 'root',
      },
      {
        id: 'ungrouped-device',
        name: 'Ungrouped Device',
        host: '10.0.0.11',
        username: 'root',
        color: '#123456',
      },
      {
        id: 'unknown-group-device',
        group: 'Unknown',
        name: 'Unknown Group Device',
        host: '10.0.0.12',
        username: 'root',
      },
    ]);

    const provider = new DeviceTreeDataProvider(createExtensionContext());

    const rootItems = await provider.getChildren();
    const [groupItem, ungroupedItem, unknownGroupItem] = rootItems;

    expect(rootItems).toHaveLength(3);
    expect(groupItem.label).toBe('Lab');
    expect(groupItem.tooltip).toBe('Lab group');
    expect(groupItem.iconPath).toEqual(new ThemeIcon('package'));
    expect(groupItem.contextValue).toBe('embeddedLoggerDeviceGroup');

    expect(ungroupedItem.label).toBe('Ungrouped Device');
    expect(ungroupedItem.description).toBe('10.0.0.11');
    expect(ungroupedItem.tooltip).toBe('Ungrouped Device (10.0.0.11)');
    expect(ungroupedItem.command).toEqual({
      command: 'embeddedLogger.openDevice',
      title: 'Open Device Logs',
      arguments: [
        expect.objectContaining({
          id: 'ungrouped-device',
        }),
      ],
    });
    expect(ungroupedItem.contextValue).toBe('embeddedLoggerDevice');
    expect(ungroupedItem.iconPath).toEqual({
      light: expect.objectContaining({
        scheme: 'data',
      }),
      dark: expect.objectContaining({
        scheme: 'data',
      }),
    });

    expect(unknownGroupItem.label).toBe('Unknown Group Device');

    const groupedChildren = await provider.getChildren(groupItem);

    expect(groupedChildren).toHaveLength(1);
    expect(groupedChildren[0].label).toBe('Grouped Device');
    expect(provider.getTreeItem(groupedChildren[0])).toBe(groupedChildren[0]);
  });

  it('fires a tree refresh event', () => {
    const provider = new DeviceTreeDataProvider(createExtensionContext());
    const listener = vi.fn();

    provider.onDidChangeTreeData(listener);
    provider.refresh();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(undefined);
  });
});
