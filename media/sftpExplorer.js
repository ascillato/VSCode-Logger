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
        remotePath: document.getElementById('remotePath'),
        localPath: document.getElementById('localPath'),
        remoteList: document.getElementById('remoteList'),
        localList: document.getElementById('localList'),
        remoteHome: document.getElementById('remoteHome'),
        remoteUp: document.getElementById('remoteUp'),
        remoteDelete: document.getElementById('remoteDelete'),
        remoteRename: document.getElementById('remoteRename'),
        remoteDuplicate: document.getElementById('remoteDuplicate'),
        remoteToLocal: document.getElementById('remoteToLocal'),
        localHome: document.getElementById('localHome'),
        localUp: document.getElementById('localUp'),
        localDelete: document.getElementById('localDelete'),
        localRename: document.getElementById('localRename'),
        localDuplicate: document.getElementById('localDuplicate'),
        localToRemote: document.getElementById('localToRemote'),
        rightMode: document.getElementById('rightMode'),
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
        renderPane(elements.remoteList, state.remote, (entry) => handleEntryClick('remote', state.remote, entry));
        renderPane(elements.localList, getActiveRightSnapshot(), (entry) => handleEntryClick('right', getActiveRightSnapshot(), entry));
        updatePaths();
        updateButtons();
    }

    function renderPane(container, snapshot, onClick) {
        container.innerHTML = '';
        const frag = document.createDocumentFragment();
        snapshot.entries.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'entry';
            row.setAttribute('role', 'treeitem');
            row.dataset.type = entry.type;
            row.textContent = entry.name;

            const selected = snapshot.selected?.name === entry.name;
            if (selected) {
                row.classList.add('entry--selected');
            }

            row.addEventListener('click', () => onClick(entry));
            frag.appendChild(row);
        });
        container.appendChild(frag);
    }

    function handleEntryClick(side, snapshot, entry) {
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

        if (side === 'remote') {
            state.remote.selected = entry;
        } else if (getActiveRightLocation() === 'local') {
            state.rightLocal.selected = entry;
        } else {
            state.rightRemote.selected = entry;
        }
        renderLists();
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
        elements.remoteDelete.disabled = disabled || !remoteSelected;
        elements.remoteRename.disabled = disabled || !remoteSelected;
        elements.remoteDuplicate.disabled = disabled || !remoteSelected;
        elements.remoteToLocal.disabled = disabled || !remoteSelected;
        elements.remoteUp.disabled = disabled || state.remote.isRoot;

        elements.localHome.disabled = disabled;
        elements.localDelete.disabled = disabled || !rightSelected;
        elements.localRename.disabled = disabled || !rightSelected;
        elements.localDuplicate.disabled = disabled || !rightSelected;
        elements.localToRemote.disabled = disabled || !rightSelected;
        elements.localUp.disabled = disabled || rightSnapshot.isRoot;
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

        elements.explorer.classList.toggle('explorer--disabled', disconnected || reconnecting);
        elements.remotePane.classList.toggle('pane--disconnected', disconnected);
        elements.remotePane.classList.toggle('pane--reconnecting', reconnecting);

        updateButtons();
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
    elements.remoteDelete.addEventListener('click', () => deleteSelected('remote'));
    elements.localDelete.addEventListener('click', () => deleteSelected('right'));
    elements.remoteRename.addEventListener('click', () => renameSelected('remote'));
    elements.localRename.addEventListener('click', () => renameSelected('right'));
    elements.remoteDuplicate.addEventListener('click', () => duplicateSelected('remote'));
    elements.localDuplicate.addEventListener('click', () => duplicateSelected('right'));
    elements.remoteToLocal.addEventListener('click', () => copyBetweenPanels('remoteToRight'));
    elements.localToRemote.addEventListener('click', () => copyBetweenPanels('rightToRemote'));

    elements.rightMode.addEventListener('change', (event) => {
        state.rightMode = event.target.value === 'remote' ? 'remote' : 'local';
        clearSelection('right');
        updatePaths();
        updateButtons();
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
