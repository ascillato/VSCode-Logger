(function () {
    const vscode = acquireVsCodeApi();

    const state = {
        devices: [],
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

    function hideContextMenu() {
        contextMenu.classList.add('hidden');
    }

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

    function createIconSpan(symbol) {
        const span = document.createElement('span');
        span.className = 'command-icon';
        span.textContent = symbol;
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    function renderDevices() {
        deviceList.innerHTML = '';
        if (!state.devices.length) {
            const empty = document.createElement('div');
            empty.textContent = 'No devices configured. Update "embeddedLogger.devices" in settings.';
            deviceList.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        state.devices.forEach((device) => {
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
                webButton.appendChild(document.createTextNode('Open WEB Browser'));
                webButton.title = `Open the configured web URL for ${device.name}`;
                webButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    vscode.postMessage({
                        type: 'openWebBrowser',
                        deviceId: device.id,
                    });
                });
                list.appendChild(webButton);
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

            fragment.appendChild(card);
        });

        deviceList.appendChild(fragment);
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'initDevices':
                state.devices = message.devices || [];
                renderDevices();
                break;
            case 'devicesUpdated':
                state.devices = message.devices || [];
                renderDevices();
                break;
        }
    });

    vscode.postMessage({ type: 'requestInit' });
})();
