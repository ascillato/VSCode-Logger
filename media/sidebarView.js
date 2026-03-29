/**
 * Renders the sidebar Webview listing devices and exposes device actions to the extension host.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 */

(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    devices: [],
    groups: [],
    expandedGroups: {},
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
      createContextMenuItem('Copy URL', () =>
        vscode.postMessage({ type: 'copyDeviceUrl', deviceId: device.id, url: urlToCopy })
      )
    );
    contextMenuList.appendChild(
      createContextMenuItem('Copy Name', () =>
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

  function createGroupIcon() {
    const icon = document.createElement('span');
    icon.className = 'group-icon';
    icon.setAttribute('aria-hidden', 'true');

    const plus = document.createElement('span');
    plus.className = 'group-icon__plus';
    plus.textContent = '+';
    icon.appendChild(plus);
    return icon;
  }

  function createDeviceCard(device) {
    const card = document.createElement('div');
    card.className = 'device-card';

    const sshCommands = device.sshCommands || [];
    const commandsSection = document.createElement('details');
    commandsSection.className = 'command-group';
    commandsSection.open = false;

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

    summary.appendChild(info);
    commandsSection.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'command-list';

    const openLogsButton = document.createElement('button');
    openLogsButton.className = 'command-button';
    openLogsButton.appendChild(createIconSpan('📄'));
    openLogsButton.appendChild(document.createTextNode('Open Logs'));
    openLogsButton.title = `Open logs for ${device.name}`;
    openLogsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: 'openDevice', deviceId: device.id });
    });
    list.appendChild(openLogsButton);

    if (device.enableSshTerminal) {
      const terminalButton = document.createElement('button');
      terminalButton.className = 'command-button';
      terminalButton.appendChild(createIconSpan('🖥️'));
      terminalButton.appendChild(document.createTextNode('Open SSH Terminal'));
      terminalButton.title = `Open an SSH terminal session for ${device.name}`;
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
      sftpButton.appendChild(document.createTextNode('Open SFTP Explorer'));
      sftpButton.title = `Browse and transfer files for ${device.name}`;
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
      webButton.appendChild(document.createTextNode('Open External Web Browser'));
      webButton.title = `Open the configured web URL for ${device.name} in an external browser`;
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
      embeddedWebButton.appendChild(document.createTextNode('Open Embedded Web Browser'));
      embeddedWebButton.title = `Open the configured web URL for ${device.name} in VS Code`;
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
      commandButton.title = cmd.command;
      commandButton.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: 'runDeviceCommand',
          deviceId: device.id,
          commandName: cmd.name,
          command: cmd.command,
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
    summary.appendChild(createGroupIcon());

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
      empty.textContent = 'No devices configured. Update "embeddedLogger.devices" in settings.';
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
        renderDevices();
        break;
      case 'devicesUpdated':
        state.devices = message.devices || [];
        state.groups = message.groups || [];
        renderDevices();
        break;
    }
  });

  vscode.postMessage({ type: 'requestInit' });
})();
