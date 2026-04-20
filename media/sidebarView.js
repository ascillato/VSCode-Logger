/**
 * Renders the sidebar Webview listing devices and exposes device actions to the extension host.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 */

(function () {
  const vscode = acquireVsCodeApi();
  const i18n = window.embeddedLoggerI18n || {};

  function t(keyPath, values = {}) {
    const value = keyPath.split('.').reduce((current, key) => current?.[key], i18n);
    const template = typeof value === 'string' ? value : keyPath;
    return template.replace(/\{([^}]+)\}/g, (match, key) =>
      values[key] === undefined ? match : String(values[key])
    );
  }

  const state = {
    devices: [],
    groups: [],
    expandedGroups: {},
    expandedDevices: {},
    isDevicePingEnabled: false,
  };

  const deviceList = document.getElementById('deviceList');

  const contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu hidden';
  const contextMenuList = document.createElement('div');
  contextMenuList.className = 'context-menu__list';
  contextMenu.appendChild(contextMenuList);
  contextMenu.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('click', (event) => {
    if (!contextMenu.contains(event.target)) {
      hideContextMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideContextMenu();
    }
  });
  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('scroll', hideContextMenu, true);
  document.body.appendChild(contextMenu);

  /**
   * Hides the context menu for device items.
   */
  function hideContextMenu() {
    contextMenu.classList.add('hidden');
  }

  /**
   * Creates a button entry for the context menu.
   */
  function createContextMenuItem(label, onClick) {
    const item = document.createElement('button');
    item.className = 'context-menu__item';
    item.type = 'button';
    item.textContent = label;
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      hideContextMenu();
      onClick();
    });
    return item;
  }

  /**
   * Opens the device context menu with copy actions.
   */
  function openDeviceContextMenu(device, clientX, clientY) {
    const urlToCopy = device.webBrowserUrl || device.host;
    contextMenuList.innerHTML = '';
    contextMenuList.appendChild(
      createContextMenuItem(t('sidebar.copyUrl'), () =>
        vscode.postMessage({ type: 'copyDeviceUrl', deviceId: device.id, url: urlToCopy })
      )
    );
    contextMenuList.appendChild(
      createContextMenuItem(t('sidebar.copyName'), () =>
        vscode.postMessage({ type: 'copyDeviceName', deviceId: device.id, name: device.name })
      )
    );

    contextMenu.style.left = `${clientX}px`;
    contextMenu.style.top = `${clientY}px`;
    contextMenu.classList.remove('hidden');

    const menuRect = contextMenu.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - menuRect.width - 4);
    const maxTop = Math.max(0, window.innerHeight - menuRect.height - 4);
    contextMenu.style.left = `${Math.min(clientX, maxLeft)}px`;
    contextMenu.style.top = `${Math.min(clientY, maxTop)}px`;
  }

  /**
   * Produces an icon span used in device rows.
   */
  function createIconSpan(symbol) {
    const span = document.createElement('span');
    span.className = 'command-icon';
    span.textContent = symbol;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function createDeviceColorSwatch(color) {
    const swatch = document.createElement('span');
    swatch.className = 'device-color';
    swatch.style.backgroundColor = color || 'var(--vscode-tab-activeForeground)';
    swatch.setAttribute('aria-hidden', 'true');
    return swatch;
  }

  function getTrimmedGroupName(device) {
    return typeof device.group === 'string' ? device.group.trim() : '';
  }

  function formatPingCompletedAt(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  function getPingStatusTitle(device) {
    if (device.pingStatus === 'pending') {
      return t('sidebar.pingInProgress');
    }

    const baseTitle =
      device.pingStatus === 'ok' ? t('sidebar.pingReachable') : t('sidebar.pingUnreachable');
    if (device.pingShowDetailedTooltip === true && typeof device.pingCompletedAt === 'number') {
      return `${baseTitle}\n${formatPingCompletedAt(device.pingCompletedAt)}`;
    }

    return baseTitle;
  }

  function getPingStatusSymbol(status) {
    if (status === 'pending') {
      return '⚫';
    }
    if (status === 'ok') {
      return '🟢';
    }
    return '🔴';
  }

  function createDeviceCard(device) {
    const card = document.createElement('div');
    card.className = 'device-card';

    const sshCommands = device.sshCommands || [];
    const commandsSection = document.createElement('details');
    commandsSection.className = 'command-group';
    commandsSection.open = Boolean(state.expandedDevices[device.id]);
    commandsSection.addEventListener('toggle', () => {
      state.expandedDevices[device.id] = commandsSection.open;
    });

    const summary = document.createElement('summary');
    summary.className = 'command-summary';
    summary.addEventListener('click', (event) => event.stopPropagation());

    const info = document.createElement('div');
    info.className = 'device-info';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = device.name;
    const attachDeviceContextMenu = (element) => {
      element.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDeviceContextMenu(device, event.clientX, event.clientY);
      });
    };

    attachDeviceContextMenu(title);
    info.appendChild(createDeviceColorSwatch(device.color));
    info.appendChild(title);

    const subtitle = document.createElement('span');
    subtitle.className = 'subtitle';
    subtitle.textContent = device.host;
    attachDeviceContextMenu(subtitle);
    info.appendChild(subtitle);

    if (
      state.isDevicePingEnabled &&
      (device.pingStatus === 'pending' ||
        device.pingStatus === 'ok' ||
        device.pingStatus === 'error')
    ) {
      const pingStatus = document.createElement('span');
      pingStatus.className = `ping-status ping-status--${device.pingStatus}`;
      pingStatus.textContent = getPingStatusSymbol(device.pingStatus);
      pingStatus.title = getPingStatusTitle(device);
      pingStatus.setAttribute('aria-label', pingStatus.title);
      info.appendChild(pingStatus);
    }

    summary.appendChild(info);
    commandsSection.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'command-list';

    const openLogsButton = document.createElement('button');
    openLogsButton.className = 'command-button';
    openLogsButton.appendChild(createIconSpan('📄'));
    openLogsButton.appendChild(document.createTextNode(t('sidebar.openLogs')));
    openLogsButton.title = t('sidebar.openLogsFor', { name: device.name });
    openLogsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: 'openDevice', deviceId: device.id });
    });
    list.appendChild(openLogsButton);

    if (device.enableSshTerminal) {
      const terminalButton = document.createElement('button');
      terminalButton.className = 'command-button';
      terminalButton.appendChild(createIconSpan('🖥️'));
      terminalButton.appendChild(document.createTextNode(t('sidebar.openSshTerminal')));
      terminalButton.title = t('sidebar.openSshTerminalFor', { name: device.name });
      terminalButton.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: 'openSshTerminal',
          deviceId: device.id,
        });
      });
      list.appendChild(terminalButton);
    }

    if (device.enableSftpExplorer) {
      const sftpButton = document.createElement('button');
      sftpButton.className = 'command-button';
      sftpButton.appendChild(createIconSpan('📁'));
      sftpButton.appendChild(document.createTextNode(t('sidebar.openSftpExplorer')));
      sftpButton.title = t('sidebar.browseAndTransferFilesFor', { name: device.name });
      sftpButton.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: 'openSftpExplorer',
          deviceId: device.id,
        });
      });
      list.appendChild(sftpButton);
    }

    if (device.enableWebBrowser) {
      const webButton = document.createElement('button');
      webButton.className = 'command-button';
      webButton.appendChild(createIconSpan('🌐'));
      webButton.appendChild(document.createTextNode(t('sidebar.openExternalWebBrowser')));
      webButton.title = t('sidebar.openExternalWebBrowserFor', { name: device.name });
      webButton.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: 'openWebBrowser',
          deviceId: device.id,
        });
      });
      list.appendChild(webButton);
    }

    if (device.enableEmbeddedWebBrowser) {
      const embeddedWebButton = document.createElement('button');
      embeddedWebButton.className = 'command-button';
      embeddedWebButton.appendChild(createIconSpan('🌐'));
      embeddedWebButton.appendChild(document.createTextNode(t('sidebar.openEmbeddedWebBrowser')));
      embeddedWebButton.title = t('sidebar.openEmbeddedWebBrowserFor', { name: device.name });
      embeddedWebButton.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: 'openEmbeddedWebBrowser',
          deviceId: device.id,
        });
      });
      list.appendChild(embeddedWebButton);
    }

    sshCommands.forEach((cmd) => {
      const commandButton = document.createElement('button');
      commandButton.className = 'command-button';
      commandButton.textContent = cmd.name;
      commandButton.title =
        cmd.command || (cmd.copyAndRunScript ? t('sidebar.copyScriptCommandTitle') : cmd.name);
      commandButton.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: 'runDeviceCommand',
          deviceId: device.id,
          commandName: cmd.name,
          command: cmd.command,
          openSshPanel: cmd.openSshPanel === true,
          rerunOnReconnection: cmd.rerunOnReconnection === true,
          copyAndRunScript: cmd.copyAndRunScript === true,
          script: cmd.script,
        });
      });
      list.appendChild(commandButton);
    });

    commandsSection.appendChild(list);
    card.appendChild(commandsSection);
    return card;
  }

  function createGroupSection(group) {
    const section = document.createElement('details');
    section.className = 'device-group';
    section.open = Boolean(state.expandedGroups[group.name]);
    section.addEventListener('toggle', () => {
      state.expandedGroups[group.name] = section.open;
    });

    const summary = document.createElement('summary');
    summary.className = 'device-group__summary';

    const chevron = document.createElement('span');
    chevron.className = 'device-group__chevron';
    chevron.textContent = '>';
    chevron.setAttribute('aria-hidden', 'true');
    summary.appendChild(chevron);

    const title = document.createElement('span');
    title.className = 'device-group__title';
    title.textContent = group.name;
    summary.appendChild(title);

    section.appendChild(summary);

    const devicesContainer = document.createElement('div');
    devicesContainer.className = 'device-group__devices';
    group.devices.forEach((device) => {
      devicesContainer.appendChild(createDeviceCard(device));
    });
    section.appendChild(devicesContainer);
    return section;
  }

  /**
   * Renders the device list with action buttons and context menus.
   */
  function renderDevices() {
    deviceList.innerHTML = '';
    if (!state.devices.length && !state.groups.length) {
      const empty = document.createElement('div');
      empty.textContent = t('sidebar.noDevicesConfigured');
      deviceList.appendChild(empty);
      return;
    }

    const groupedDeviceMap = new Map();
    state.groups.forEach((group) => {
      groupedDeviceMap.set(group.name, []);
    });

    const ungroupedDevices = [];
    state.devices.forEach((device) => {
      const groupName = getTrimmedGroupName(device);
      if (groupName && groupedDeviceMap.has(groupName)) {
        groupedDeviceMap.get(groupName).push(device);
        return;
      }
      ungroupedDevices.push(device);
    });

    const fragment = document.createDocumentFragment();
    state.groups.forEach((group) => {
      fragment.appendChild(
        createGroupSection({
          name: group.name,
          devices: groupedDeviceMap.get(group.name) || [],
        })
      );
    });

    ungroupedDevices.forEach((device) => {
      fragment.appendChild(createDeviceCard(device));
    });

    deviceList.appendChild(fragment);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'initDevices':
        state.devices = message.devices || [];
        state.groups = message.groups || [];
        state.isDevicePingEnabled = message.isDevicePingEnabled === true;
        renderDevices();
        break;
      case 'devicesUpdated':
        state.devices = message.devices || [];
        state.groups = message.groups || [];
        state.isDevicePingEnabled = message.isDevicePingEnabled === true;
        renderDevices();
        break;
    }
  });

  vscode.postMessage({ type: 'requestInit' });
})();
