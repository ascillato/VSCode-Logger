(function () {
    const vscode = acquireVsCodeApi();

    const requestIds = {
        remote: 'remote',
        local: 'local',
        rightRemote: 'rightRemote',
    };

    const state = {
        remoteHome: '/',
        localHome: '',
        remote: createSnapshot(),
        rightMode: 'local',
        rightLocal: createSnapshot(),
        rightRemote: createSnapshot(),
        connectionState: 'connected',
    };

    const elements = {
        status: document.getElementById('status'),
        explorer: document.getElementById('explorer'),
        remotePane: document.getElementById('remotePane'),
        rightPane: document.getElementById('rightPane'),
        remotePath: document.getElementById('remotePath'),
        localPath: document.getElementById('localPath'),
        remoteList: document.getElementById('remoteList'),
        localList: document.getElementById('localList'),
        remoteHome: document.getElementById('remoteHome'),
        remoteUp: document.getElementById('remoteUp'),
        remoteRefresh: document.getElementById('remoteRefresh'),
        remoteNewFolder: document.getElementById('remoteNewFolder'),
        remoteNewFile: document.getElementById('remoteNewFile'),
        remoteToLocal: document.getElementById('remoteToLocal'),
        localHome: document.getElementById('localHome'),
        localUp: document.getElementById('localUp'),
        localRefresh: document.getElementById('localRefresh'),
        localNewFolder: document.getElementById('localNewFolder'),
        localNewFile: document.getElementById('localNewFile'),
        localToRemote: document.getElementById('localToRemote'),
        rightMode: document.getElementById('rightMode'),
        contextMenu: document.getElementById('contextMenu'),
        contextRename: document.getElementById('contextRename'),
        contextDuplicate: document.getElementById('contextDuplicate'),
        contextDelete: document.getElementById('contextDelete'),
    };

    const contextMenuState = {
        side: 'remote',
    };

    const pending = {
        confirmations: new Map(),
        inputs: new Map(),
    };

    function createRequestId() {
        return (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function createSnapshot() {
        return { path: '', parentPath: '', isRoot: true, entries: [], location: 'remote', selected: undefined };
    }

    function setStatus(message, isError = false) {
        elements.status.textContent = message || '';
        elements.status.classList.toggle('status--error', Boolean(isError));
    }

    function formatSize(entry) {
        if (entry.type === 'directory') {
            return '—';
        }
        const size = typeof entry.size === 'number' ? entry.size : 0;
        if (size < 1024) {
            return `${size} B`;
        }
        const units = ['KB', 'MB', 'GB', 'TB'];
        let value = size / 1024;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }
        return `${value.toFixed(1)} ${units[unitIndex]}`;
    }

    function formatPermissions(entry) {
        return entry.permissions || '—';
    }

    function formatModified(entry) {
        if (!entry.modified) {
            return '—';
        }
        const value = typeof entry.modified === 'number' ? entry.modified : Number(entry.modified);
        if (!Number.isFinite(value)) {
            return '—';
        }
        return new Date(value).toLocaleString();
    }

    function getEntryIcon(entry) {
        if (entry.type === 'directory') {
            return '📁';
        }
        return entry.isExecutable ? '📜' : '📄';
    }

    function getEntryPath(snapshot, entry) {
        if (!snapshot.path || snapshot.path === '/') {
            return `/${entry.name}`;
        }
        if (snapshot.path.endsWith('/')) {
            return `${snapshot.path}${entry.name}`;
        }
        return `${snapshot.path}/${entry.name}`;
    }

    function renderLists() {
        renderPane(elements.remoteList, state.remote, 'remote');
        renderPane(elements.localList, getActiveRightSnapshot(), 'right');
        updatePaths();
        updateButtons();
    }

    function renderPane(container, snapshot, side) {
        container.innerHTML = '';
        const maxNameLength = snapshot.entries.reduce((max, entry) => Math.max(max, entry.name.length), 0);
        const nameWidth = Math.min(Math.max(maxNameLength, 1), 32);
        container.style.setProperty('--name-col-width', `${nameWidth}ch`);

        const frag = document.createDocumentFragment();
        snapshot.entries.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'entry';
            row.setAttribute('role', 'treeitem');
            row.dataset.type = entry.type;
            if (entry.type === 'file' && entry.isExecutable) {
                row.classList.add('entry--executable');
            }

            const nameCell = document.createElement('div');
            nameCell.className = 'entry__cell entry__cell--name';
            const icon = document.createElement('span');
            icon.className = 'entry__icon';
            icon.textContent = getEntryIcon(entry);
            const name = document.createElement('span');
            name.className = 'entry__name';
            const needsTruncate = entry.name.length > 32;
            name.textContent = needsTruncate ? `${entry.name.slice(0, 29)}...` : entry.name;
            if (needsTruncate) {
                name.title = entry.name;
            }
            nameCell.appendChild(icon);
            nameCell.appendChild(name);

            const sizeCell = document.createElement('div');
            sizeCell.className = 'entry__cell entry__cell--size';
            sizeCell.textContent = formatSize(entry);

            const permissionCell = document.createElement('div');
            permissionCell.className = 'entry__cell entry__cell--permissions';
            permissionCell.textContent = formatPermissions(entry);

            const modifiedCell = document.createElement('div');
            modifiedCell.className = 'entry__cell entry__cell--modified';
            modifiedCell.textContent = formatModified(entry);

            const selected = snapshot.selected?.name === entry.name;
            if (selected) {
                row.classList.add('entry--selected');
            }

            row.appendChild(nameCell);
            row.appendChild(sizeCell);
            row.appendChild(permissionCell);
            row.appendChild(modifiedCell);
            row.addEventListener('click', () => handleEntryClick(side, snapshot, entry));
            row.addEventListener('contextmenu', (event) => handleEntryContextMenu(side, entry, event));
            frag.appendChild(row);
        });
        container.appendChild(frag);
    }

    function handleEntryClick(side, snapshot, entry) {
        hideContextMenu();
        if (state.connectionState !== 'connected') {
            return;
        }
        if (entry.type === 'directory') {
            const nextPath = getEntryPath(snapshot, entry);
            const location = side === 'remote' ? 'remote' : getActiveRightLocation();
            requestList(location, nextPath, side === 'remote' ? requestIds.remote : getActiveRequestId());
            clearSelection(side);
            return;
        }

        setSelection(side, entry);
    }

    function clearSelection(side) {
        if (side === 'remote') {
            state.remote.selected = undefined;
        } else if (side === 'right') {
            const snapshot = getActiveRightSnapshot();
            snapshot.selected = undefined;
        }
        updateButtons();
    }

    function setSelection(side, entry) {
        if (side === 'remote') {
            state.remote.selected = entry;
        } else if (getActiveRightLocation() === 'local') {
            state.rightLocal.selected = entry;
        } else {
            state.rightRemote.selected = entry;
        }
        renderLists();
    }

    function handleEntryContextMenu(side, entry, event) {
        event.preventDefault();
        if (state.connectionState !== 'connected') {
            hideContextMenu();
            return;
        }
        setSelection(side, entry);
        contextMenuState.side = side;
        showContextMenu(event.clientX, event.clientY);
    }

    function showContextMenu(x, y) {
        if (!elements.contextMenu) {
            return;
        }
        elements.contextMenu.style.left = `${x}px`;
        elements.contextMenu.style.top = `${y}px`;
        elements.contextMenu.classList.add('context-menu--visible');
        elements.contextMenu.setAttribute('aria-hidden', 'false');
    }

    function hideContextMenu() {
        if (!elements.contextMenu) {
            return;
        }
        elements.contextMenu.classList.remove('context-menu--visible');
        elements.contextMenu.setAttribute('aria-hidden', 'true');
    }

    function updatePaths() {
        elements.remotePath.textContent = state.remote.path;
        elements.localPath.textContent = getActiveRightSnapshot().path;
    }

    function updateButtons() {
        const remoteSelected = Boolean(state.remote.selected);
        const rightSnapshot = getActiveRightSnapshot();
        const rightSelected = Boolean(rightSnapshot.selected);
        const disabled = state.connectionState !== 'connected';

        elements.remoteHome.disabled = disabled;
        elements.remoteToLocal.disabled = disabled || !remoteSelected;
        elements.remoteUp.disabled = disabled || state.remote.isRoot;
        elements.remoteRefresh.disabled = disabled;
        elements.remoteNewFolder.disabled = disabled;
        elements.remoteNewFile.disabled = disabled;

        elements.localHome.disabled = disabled;
        elements.localToRemote.disabled = disabled || !rightSelected;
        elements.localUp.disabled = disabled || rightSnapshot.isRoot;
        elements.localRefresh.disabled = disabled;
        elements.localNewFolder.disabled = disabled;
        elements.localNewFile.disabled = disabled;
        elements.rightMode.disabled = disabled;
    }

    function requestList(location, path, requestId) {
        vscode.postMessage({ type: 'listEntries', location, path, requestId });
    }

    function handleInit(payload) {
        state.remoteHome = payload.remoteHome;
        state.localHome = payload.localHome;
        state.remote = { ...payload.remote, selected: undefined };
        state.rightLocal = { ...payload.local, selected: undefined };
        state.rightRemote = { ...payload.remote, selected: undefined };
        renderLists();
    }

    function handleListResponse(message) {
        const snapshot = { ...message.snapshot, selected: undefined };
        if (message.requestId === requestIds.remote) {
            state.remote = snapshot;
        } else if (message.requestId === requestIds.local) {
            state.rightLocal = snapshot;
        } else if (message.requestId === requestIds.rightRemote) {
            state.rightRemote = snapshot;
        }
        renderLists();
    }

    function applyConnectionStatus(payload) {
        state.connectionState = payload.state;
        setStatus(payload.message, false);

        const disconnected = payload.state === 'disconnected';
        const reconnecting = payload.state === 'reconnecting';

        const disableUi = disconnected || reconnecting;
        elements.explorer.classList.toggle('explorer--disabled', disableUi);

        [elements.remotePane, elements.rightPane].forEach((pane) => {
            if (!pane) {
                return;
            }
            pane.classList.toggle('pane--disconnected', disconnected);
            pane.classList.toggle('pane--reconnecting', reconnecting);
        });

        [elements.remoteList, elements.localList].forEach((list) => {
            if (!list) {
                return;
            }
            list.classList.toggle('list--disconnected', disconnected);
            list.classList.toggle('list--reconnecting', reconnecting);
        });

        updateButtons();
        hideContextMenu();
    }

    function getActiveRightSnapshot() {
        return state.rightMode === 'local' ? state.rightLocal : state.rightRemote;
    }

    function getActiveRightLocation() {
        return state.rightMode === 'local' ? 'local' : 'remote';
    }

    function getActiveRequestId() {
        return state.rightMode === 'local' ? requestIds.local : requestIds.rightRemote;
    }

    function goHome(side) {
        if (side === 'remote') {
            requestList('remote', state.remoteHome, requestIds.remote);
            clearSelection('remote');
        } else {
            const location = getActiveRightLocation();
            const targetPath = location === 'local' ? state.localHome : state.remoteHome;
            requestList(location, targetPath, getActiveRequestId());
            clearSelection('right');
        }
    }

    function goUp(side) {
        if (side === 'remote') {
            if (state.remote.isRoot) {
                return;
            }
            requestList('remote', state.remote.parentPath, requestIds.remote);
            clearSelection('remote');
        } else {
            const snapshot = getActiveRightSnapshot();
            if (snapshot.isRoot) {
                return;
            }
            requestList(getActiveRightLocation(), snapshot.parentPath, getActiveRequestId());
            clearSelection('right');
        }
    }

    function refresh(side) {
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const location = side === 'remote' ? 'remote' : getActiveRightLocation();
        requestList(location, snapshot.path, side === 'remote' ? requestIds.remote : getActiveRequestId());
        clearSelection(side === 'remote' ? 'remote' : 'right');
    }

    async function createEntry(side, kind) {
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const location = side === 'remote' ? 'remote' : getActiveRightLocation();
        const requestId = side === 'remote' ? requestIds.remote : getActiveRequestId();
        const label = kind === 'directory' ? 'folder' : 'file';
        const name = await requestInput(`New ${label} name`);
        if (!name) {
            return;
        }
        vscode.postMessage({
            type: kind === 'directory' ? 'createDirectory' : 'createFile',
            location,
            path: snapshot.path,
            name,
            requestId,
        });
    }

    async function deleteSelected(side) {
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        if (!snapshot.selected) {
            return;
        }
        const confirmed = await requestConfirmation(`Delete ${snapshot.selected.name}?`);
        if (!confirmed) {
            return;
        }
        vscode.postMessage({
            type: 'deleteEntry',
            location: side === 'remote' ? 'remote' : getActiveRightLocation(),
            path: getEntryPath(snapshot, snapshot.selected),
            requestId: side === 'remote' ? requestIds.remote : getActiveRequestId(),
        });
    }

    async function renameSelected(side) {
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        if (!snapshot.selected) {
            return;
        }
        const newName = await requestInput('New name', snapshot.selected.name);
        if (!newName) {
            return;
        }
        vscode.postMessage({
            type: 'renameEntry',
            location: side === 'remote' ? 'remote' : getActiveRightLocation(),
            path: getEntryPath(snapshot, snapshot.selected),
            newName,
            requestId: side === 'remote' ? requestIds.remote : getActiveRequestId(),
        });
    }

    function duplicateSelected(side) {
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        if (!snapshot.selected) {
            return;
        }
        vscode.postMessage({
            type: 'duplicateEntry',
            location: side === 'remote' ? 'remote' : getActiveRightLocation(),
            path: getEntryPath(snapshot, snapshot.selected),
            requestId: side === 'remote' ? requestIds.remote : getActiveRequestId(),
        });
    }

    function copyBetweenPanels(direction) {
        if (direction === 'remoteToRight') {
            if (!state.remote.selected) {
                return;
            }
            const destination = getActiveRightSnapshot();
            vscode.postMessage({
                type: 'copyEntry',
                from: { location: 'remote', path: getEntryPath(state.remote, state.remote.selected) },
                toDirectory: { location: getActiveRightLocation(), path: destination.path },
                requestId: getActiveRequestId(),
            });
        } else {
            const snapshot = getActiveRightSnapshot();
            if (!snapshot.selected) {
                return;
            }
            vscode.postMessage({
                type: 'copyEntry',
                from: { location: getActiveRightLocation(), path: getEntryPath(snapshot, snapshot.selected) },
                toDirectory: { location: 'remote', path: state.remote.path },
                requestId: requestIds.remote,
            });
        }
    }

    elements.remoteHome.addEventListener('click', () => goHome('remote'));
    elements.localHome.addEventListener('click', () => goHome('right'));
    elements.remoteUp.addEventListener('click', () => goUp('remote'));
    elements.localUp.addEventListener('click', () => goUp('right'));
    elements.remoteRefresh.addEventListener('click', () => refresh('remote'));
    elements.localRefresh.addEventListener('click', () => refresh('right'));
    elements.remoteNewFolder.addEventListener('click', () => createEntry('remote', 'directory'));
    elements.localNewFolder.addEventListener('click', () => createEntry('right', 'directory'));
    elements.remoteNewFile.addEventListener('click', () => createEntry('remote', 'file'));
    elements.localNewFile.addEventListener('click', () => createEntry('right', 'file'));
    elements.remoteToLocal.addEventListener('click', () => copyBetweenPanels('remoteToRight'));
    elements.localToRemote.addEventListener('click', () => copyBetweenPanels('rightToRemote'));

    elements.contextRename.addEventListener('click', () => {
        hideContextMenu();
        renameSelected(contextMenuState.side);
    });
    elements.contextDuplicate.addEventListener('click', () => {
        hideContextMenu();
        duplicateSelected(contextMenuState.side);
    });
    elements.contextDelete.addEventListener('click', () => {
        hideContextMenu();
        deleteSelected(contextMenuState.side);
    });

    document.addEventListener('click', (event) => {
        if (!elements.contextMenu) {
            return;
        }
        if (!elements.contextMenu.contains(event.target)) {
            hideContextMenu();
        }
    });

    [elements.remoteList, elements.localList].forEach((list) => {
        list?.addEventListener('scroll', hideContextMenu);
    });

    window.addEventListener('resize', hideContextMenu);

    elements.rightMode.addEventListener('change', (event) => {
        state.rightMode = event.target.value === 'remote' ? 'remote' : 'local';
        clearSelection('right');
        updatePaths();
        updateButtons();
        hideContextMenu();
        renderLists();
    });

    function requestConfirmation(message) {
        return new Promise((resolve) => {
            const requestId = createRequestId();
            pending.confirmations.set(requestId, resolve);
            vscode.postMessage({ type: 'requestConfirmation', message, requestId });
        });
    }

    function requestInput(promptText, value = '') {
        return new Promise((resolve) => {
            const requestId = createRequestId();
            pending.inputs.set(requestId, resolve);
            vscode.postMessage({ type: 'requestInput', prompt: promptText, value, requestId });
        });
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'init':
                handleInit(message);
                break;
            case 'listResponse':
                handleListResponse(message);
                break;
            case 'connectionStatus':
                applyConnectionStatus(message);
                break;
            case 'status':
                setStatus(message.message, false);
                break;
            case 'error':
                setStatus(message.message, true);
                break;
            case 'confirmationResult': {
                const resolver = pending.confirmations.get(message.requestId);
                if (typeof resolver === 'function') {
                    resolver(Boolean(message.confirmed));
                }
                pending.confirmations.delete(message.requestId);
                break;
            }
            case 'inputResult': {
                const resolver = pending.inputs.get(message.requestId);
                if (typeof resolver === 'function') {
                    resolver(message.value || '');
                }
                pending.inputs.delete(message.requestId);
                break;
            }
        }
    });

    vscode.postMessage({ type: 'requestInit' });
})();
