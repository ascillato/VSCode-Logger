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

    const selectionAnchors = {
        remote: undefined,
        rightLocal: undefined,
        rightRemote: undefined,
    };

    const elements = {
        status: document.getElementById('status'),
        explorer: document.getElementById('explorer'),
        remotePane: document.getElementById('remotePane'),
        rightPane: document.getElementById('rightPane'),
        remotePath: document.getElementById('remotePath'),
        localPath: document.getElementById('localPath'),
        remoteOpenTerminal: document.getElementById('remoteOpenTerminal'),
        localOpenTerminal: document.getElementById('localOpenTerminal'),
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
        contextSelect: document.getElementById('contextSelect'),
        contextRun: document.getElementById('contextRun'),
        contextRename: document.getElementById('contextRename'),
        contextDuplicate: document.getElementById('contextDuplicate'),
        contextDelete: document.getElementById('contextDelete'),
        contextPermissions: document.getElementById('contextPermissions'),
        confirmDialog: document.getElementById('confirmDialog'),
        confirmMessage: document.getElementById('confirmMessage'),
        confirmYes: document.getElementById('confirmYes'),
        confirmCancel: document.getElementById('confirmCancel'),
        confirmDismiss: document.getElementById('confirmDismiss'),
        permissionsDialog: document.getElementById('permissionsDialog'),
        permissionsTarget: document.getElementById('permissionsTarget'),
        permissionsOwner: document.getElementById('permissionsOwner'),
        permissionsGroup: document.getElementById('permissionsGroup'),
        permissionsError: document.getElementById('permissionsError'),
        permissionsSave: document.getElementById('permissionsSave'),
        permissionsCancel: document.getElementById('permissionsCancel'),
        permissionsDismiss: document.getElementById('permissionsDismiss'),
        permOwnerRead: document.getElementById('permOwnerRead'),
        permOwnerWrite: document.getElementById('permOwnerWrite'),
        permOwnerExec: document.getElementById('permOwnerExec'),
        permGroupRead: document.getElementById('permGroupRead'),
        permGroupWrite: document.getElementById('permGroupWrite'),
        permGroupExec: document.getElementById('permGroupExec'),
        permOtherRead: document.getElementById('permOtherRead'),
        permOtherWrite: document.getElementById('permOtherWrite'),
        permOtherExec: document.getElementById('permOtherExec'),
    };

    const contextMenuState = {
        side: 'remote',
    };

    const permissionsState = {
        side: 'remote',
        info: undefined,
        paths: [],
    };

    const confirmationState = {
        resolver: undefined,
    };

    const pending = {
        inputs: new Map(),
        permissions: new Map(),
    };

    function createRequestId() {
        return (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function createSnapshot() {
        return { path: '', parentPath: '', isRoot: true, entries: [], location: 'remote', selected: [] };
    }

    function setStatus(message, isError = false) {
        elements.status.textContent = message || '';
        elements.status.classList.toggle('status--error', Boolean(isError));
    }

    function resetStatus() {
        if (state.connectionState === 'connected') {
            setStatus('Connected', false);
        }
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

    function getSelectedEntries(snapshot) {
        return snapshot.selected ?? [];
    }

    function getSelectionAnchorKey(side) {
        if (side === 'remote') {
            return 'remote';
        }
        return getActiveRightLocation() === 'local' ? 'rightLocal' : 'rightRemote';
    }

    function getSelectionAnchor(side) {
        return selectionAnchors[getSelectionAnchorKey(side)];
    }

    function setSelectionAnchor(side, entry) {
        selectionAnchors[getSelectionAnchorKey(side)] = entry ? entry.name : undefined;
    }

    function resetSelectionAnchors() {
        selectionAnchors.remote = undefined;
        selectionAnchors.rightLocal = undefined;
        selectionAnchors.rightRemote = undefined;
    }

    function clearSelectionAnchorByRequestId(requestId) {
        if (requestId === requestIds.remote) {
            selectionAnchors.remote = undefined;
        } else if (requestId === requestIds.local) {
            selectionAnchors.rightLocal = undefined;
        } else if (requestId === requestIds.rightRemote) {
            selectionAnchors.rightRemote = undefined;
        }
    }

    function isSelected(snapshot, entry) {
        return getSelectedEntries(snapshot).some((selectedEntry) => selectedEntry.name === entry.name);
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
        if (snapshot.entries.length === 0) {
            const emptyRow = document.createElement('div');
            emptyRow.className = 'list__empty';
            emptyRow.textContent = 'Folder empty';
            frag.appendChild(emptyRow);
        }
        const selectedEntries = getSelectedEntries(snapshot);
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

            const selected = selectedEntries.some((selectedEntry) => selectedEntry.name === entry.name);
            if (selected) {
                row.classList.add('entry--selected');
            }

            row.appendChild(nameCell);
            row.appendChild(sizeCell);
            row.appendChild(permissionCell);
            row.appendChild(modifiedCell);
            row.addEventListener('click', (event) => handleEntryClick(side, snapshot, entry, event));
            row.addEventListener('contextmenu', (event) => handleEntryContextMenu(side, entry, event));
            frag.appendChild(row);
        });
        container.appendChild(frag);
    }

    function handleEntryClick(side, snapshot, entry, event) {
        hideContextMenu();
        if (state.connectionState !== 'connected') {
            return;
        }
        const anchorName = getSelectionAnchor(side) || getSelectedEntries(snapshot)[0]?.name;
        if (event?.shiftKey) {
            const targetIndex = snapshot.entries.findIndex((item) => item.name === entry.name);
            const anchorIndex = anchorName
                ? snapshot.entries.findIndex((item) => item.name === anchorName)
                : -1;
            if (anchorIndex >= 0 && targetIndex >= 0) {
                const start = Math.min(anchorIndex, targetIndex);
                const end = Math.max(anchorIndex, targetIndex);
                const range = snapshot.entries.slice(start, end + 1);
                setSelection(side, range, entry);
                return;
            }
            setSingleSelection(side, entry);
            return;
        }
        if (event?.ctrlKey || event?.metaKey) {
            toggleEntrySelection(side, snapshot, entry);
            return;
        }
        if (entry.type === 'directory') {
            const nextPath = getEntryPath(snapshot, entry);
            const location = side === 'remote' ? 'remote' : getActiveRightLocation();
            requestList(location, nextPath, side === 'remote' ? requestIds.remote : getActiveRequestId());
            clearSelection(side);
            return;
        }

        setSingleSelection(side, entry);
    }

    function clearSelection(side) {
        if (side === 'remote') {
            state.remote.selected = [];
        } else if (side === 'right') {
            const snapshot = getActiveRightSnapshot();
            snapshot.selected = [];
        }
        setSelectionAnchor(side, undefined);
        updateButtons();
    }

    function setSelection(side, entries, anchorEntry) {
        const target = side === 'remote'
            ? state.remote
            : getActiveRightLocation() === 'local'
            ? state.rightLocal
            : state.rightRemote;
        target.selected = entries;
        setSelectionAnchor(side, anchorEntry ?? entries[entries.length - 1]);
        renderLists();
    }

    function toggleEntrySelection(side, snapshot, entry) {
        const selected = getSelectedEntries(snapshot);
        const exists = selected.findIndex((item) => item.name === entry.name);
        if (exists >= 0) {
            selected.splice(exists, 1);
        } else {
            selected.push(entry);
        }
        setSelection(side, [...selected], entry);
    }

    function setSingleSelection(side, entry) {
        setSelection(side, [entry], entry);
    }

    function handleEntryContextMenu(side, entry, event) {
        event.preventDefault();
        if (state.connectionState !== 'connected') {
            hideContextMenu();
            return;
        }
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        if (!isSelected(snapshot, entry)) {
            setSingleSelection(side, entry);
        }
        contextMenuState.side = side;
        updateContextMenuOptions(side);
        showContextMenu(event.clientX, event.clientY);
    }

    function updateContextMenuOptions(side) {
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const selected = getSelectedEntries(snapshot);
        const selectedCount = selected.length;
        const disableSingleOnly = selectedCount !== 1;
        const selectedEntry = selectedCount === 1 ? selected[0] : undefined;
        const isRemoteLocation = side === 'remote' || getActiveRightLocation() === 'remote';

        if (elements.contextRun) {
            const canRun = Boolean(
                selectedEntry &&
                    selectedEntry.type === 'file' &&
                    selectedEntry.isExecutable &&
                    isRemoteLocation
            );
            elements.contextRun.disabled = !canRun;
            elements.contextRun.classList.toggle('context-menu__item--disabled', !canRun);
            elements.contextRun.classList.toggle('context-menu__item--hidden', !canRun);
        }

        [elements.contextRename, elements.contextDuplicate].forEach((el) => {
            if (!el) {
                return;
            }
            el.disabled = disableSingleOnly;
            el.classList.toggle('context-menu__item--disabled', disableSingleOnly);
        });
    }

    function showContextMenu(x, y) {
        if (!elements.contextMenu) {
            return;
        }
        elements.contextMenu.style.left = `${x}px`;
        elements.contextMenu.style.top = `${y}px`;
        elements.contextMenu.classList.add('context-menu--visible');
        elements.contextMenu.setAttribute('aria-hidden', 'false');

        const menuRect = elements.contextMenu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 8;
        let adjustedX = x;
        let adjustedY = y;

        if (menuRect.right > viewportWidth - padding) {
            adjustedX = Math.max(padding, viewportWidth - menuRect.width - padding);
        }
        if (menuRect.bottom > viewportHeight - padding) {
            adjustedY = Math.max(padding, viewportHeight - menuRect.height - padding);
        }

        elements.contextMenu.style.left = `${adjustedX}px`;
        elements.contextMenu.style.top = `${adjustedY}px`;
    }

    function hideContextMenu() {
        if (!elements.contextMenu) {
            return;
        }
        elements.contextMenu.classList.remove('context-menu--visible');
        elements.contextMenu.setAttribute('aria-hidden', 'true');
    }

    function setPermissionsError(message) {
        elements.permissionsError.textContent = message || '';
    }

    function hidePermissionsDialog() {
        if (!elements.permissionsDialog) {
            return;
        }
        elements.permissionsDialog.classList.add('dialog--hidden');
        elements.permissionsDialog.setAttribute('aria-hidden', 'true');
        permissionsState.info = undefined;
        permissionsState.paths = [];
        setPermissionsError('');
    }

    function showPermissionsDialog(info, side) {
        if (!elements.permissionsDialog) {
            return;
        }
        permissionsState.info = info;
        permissionsState.side = side;
        elements.permissionsTarget.textContent = '';
        const prefix = document.createElement('span');
        const selectedCount = permissionsState.paths.length || 1;
        prefix.textContent = selectedCount > 1
            ? `Change ${selectedCount} items from ${info.location}: `
            : `Change ${info.type} from ${info.location}: `;
        const target = document.createElement('strong');
        const suffix = document.createElement('span');
        if (selectedCount > 1) {
            target.textContent = `${info.name} (+${selectedCount - 1} more)`;
            suffix.textContent = '';
        } else {
            target.textContent = info.name;
            suffix.textContent = '';
        }
        elements.permissionsTarget.append(prefix, target, suffix);

        const bits = info.mode & 0o777;
        elements.permOwnerRead.checked = Boolean(bits & 0o400);
        elements.permOwnerWrite.checked = Boolean(bits & 0o200);
        elements.permOwnerExec.checked = Boolean(bits & 0o100);
        elements.permGroupRead.checked = Boolean(bits & 0o40);
        elements.permGroupWrite.checked = Boolean(bits & 0o20);
        elements.permGroupExec.checked = Boolean(bits & 0o10);
        elements.permOtherRead.checked = Boolean(bits & 0o4);
        elements.permOtherWrite.checked = Boolean(bits & 0o2);
        elements.permOtherExec.checked = Boolean(bits & 0o1);

        elements.permissionsOwner.value = info.ownerName || (info.owner !== undefined ? String(info.owner) : '');
        elements.permissionsGroup.value = info.groupName || (info.group !== undefined ? String(info.group) : '');
        setPermissionsError('');

        elements.permissionsDialog.classList.remove('dialog--hidden');
        elements.permissionsDialog.setAttribute('aria-hidden', 'false');
    }

    function parseIdValue(value) {
        const trimmed = value.trim();
        if (!trimmed) {
            return { valid: true, value: undefined };
        }
        const numeric = Number(trimmed);
        if (Number.isInteger(numeric) && numeric >= 0) {
            return { valid: true, value: numeric };
        }
        if (/^[\w.-]+$/.test(trimmed)) {
            return { valid: true, value: trimmed };
        }
        return { valid: false };
    }

    function buildModeFromDialog() {
        let mode = 0;
        mode |= elements.permOwnerRead.checked ? 0o400 : 0;
        mode |= elements.permOwnerWrite.checked ? 0o200 : 0;
        mode |= elements.permOwnerExec.checked ? 0o100 : 0;
        mode |= elements.permGroupRead.checked ? 0o40 : 0;
        mode |= elements.permGroupWrite.checked ? 0o20 : 0;
        mode |= elements.permGroupExec.checked ? 0o10 : 0;
        mode |= elements.permOtherRead.checked ? 0o4 : 0;
        mode |= elements.permOtherWrite.checked ? 0o2 : 0;
        mode |= elements.permOtherExec.checked ? 0o1 : 0;
        return mode;
    }

    function requestPermissions(side) {
        if (state.connectionState !== 'connected') {
            return;
        }
        resetStatus();
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const selected = getSelectedEntries(snapshot);
        if (!selected.length) {
            return;
        }

        const requestId = createRequestId();
        const paths = selected.map((entry) => getEntryPath(snapshot, entry));
        pending.permissions.set(requestId, { side, paths });
        const location = side === 'remote' ? 'remote' : getActiveRightLocation();
        vscode.postMessage({
            type: 'requestPermissionsInfo',
            location,
            path: paths[0],
            requestId,
        });
    }

    function handlePermissionsInfo(message) {
        const stateInfo = pending.permissions.get(message.requestId) || { side: 'remote', paths: [] };
        pending.permissions.delete(message.requestId);
        permissionsState.paths = stateInfo.paths || [];
        showPermissionsDialog(message.info, stateInfo.side);
    }

    function updatePaths() {
        elements.remotePath.textContent = state.remote.path;
        elements.localPath.textContent = getActiveRightSnapshot().path;
    }

    function updateButtons() {
        const remoteSelected = getSelectedEntries(state.remote).length > 0;
        const rightSnapshot = getActiveRightSnapshot();
        const rightSelected = getSelectedEntries(rightSnapshot).length > 0;
        const disabled = state.connectionState !== 'connected';

        elements.remoteHome.disabled = disabled;
        elements.remoteToLocal.disabled = disabled || !remoteSelected;
        elements.remoteUp.disabled = disabled || state.remote.isRoot;
        elements.remoteRefresh.disabled = disabled;
        elements.remoteNewFolder.disabled = disabled;
        elements.remoteNewFile.disabled = disabled;
        elements.remoteOpenTerminal.disabled = disabled;

        elements.localHome.disabled = disabled;
        elements.localToRemote.disabled = disabled || !rightSelected;
        elements.localUp.disabled = disabled || rightSnapshot.isRoot;
        elements.localRefresh.disabled = disabled;
        elements.localNewFolder.disabled = disabled;
        elements.localNewFile.disabled = disabled;
        elements.localOpenTerminal.disabled = disabled;
        elements.rightMode.disabled = disabled;
    }

    function requestList(location, path, requestId) {
        vscode.postMessage({ type: 'listEntries', location, path, requestId });
    }

    function handleInit(payload) {
        state.remoteHome = payload.remoteHome;
        state.localHome = payload.localHome;
        state.remote = { ...payload.remote, selected: [] };
        state.rightLocal = { ...payload.local, selected: [] };
        state.rightRemote = { ...payload.remote, selected: [] };
        resetSelectionAnchors();
        renderLists();
    }

    function handleListResponse(message) {
        const snapshot = { ...message.snapshot, selected: [] };
        if (message.requestId === requestIds.remote) {
            state.remote = snapshot;
        } else if (message.requestId === requestIds.local) {
            state.rightLocal = snapshot;
        } else if (message.requestId === requestIds.rightRemote) {
            state.rightRemote = snapshot;
        }
        clearSelectionAnchorByRequestId(message.requestId);
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
        resetStatus();
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
        resetStatus();
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
        resetStatus();
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const location = side === 'remote' ? 'remote' : getActiveRightLocation();
        requestList(location, snapshot.path, side === 'remote' ? requestIds.remote : getActiveRequestId());
        clearSelection(side === 'remote' ? 'remote' : 'right');
    }

    async function createEntry(side, kind) {
        resetStatus();
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

    function runSelected(side) {
        resetStatus();
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const location = side === 'remote' ? 'remote' : getActiveRightLocation();
        if (location !== 'remote') {
            return;
        }
        const selected = getSelectedEntries(snapshot);
        if (selected.length !== 1) {
            return;
        }
        const [entry] = selected;
        if (entry.type !== 'file' || !entry.isExecutable) {
            return;
        }
        vscode.postMessage({
            type: 'runEntry',
            location,
            path: getEntryPath(snapshot, entry),
            requestId: side === 'remote' ? requestIds.remote : getActiveRequestId(),
        });
    }

    async function deleteSelected(side) {
        resetStatus();
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const selected = getSelectedEntries(snapshot);
        if (!selected.length) {
            return;
        }
        const locationLabel = side === 'remote' ? 'remote' : getActiveRightLocation();
        const first = selected[0];
        const targetType = selected.length > 1 ? `${selected.length} items` : first.type === 'directory' ? 'folder' : 'file';
        const nameLabel = selected.length > 1 ? `${first.name} (+${selected.length - 1} more)` : first.name;
        const confirmed = await requestConfirmation(
            `Delete ${targetType} from ${locationLabel}:`,
            nameLabel
        );
        if (!confirmed) {
            return;
        }
        vscode.postMessage({
            type: selected.length > 1 ? 'deleteEntries' : 'deleteEntry',
            location: side === 'remote' ? 'remote' : getActiveRightLocation(),
            path: selected.length === 1 ? getEntryPath(snapshot, first) : undefined,
            paths: selected.length === 1 ? undefined : selected.map((entry) => getEntryPath(snapshot, entry)),
            requestId: side === 'remote' ? requestIds.remote : getActiveRequestId(),
        });
    }

    async function renameSelected(side) {
        resetStatus();
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const selected = getSelectedEntries(snapshot);
        if (selected.length !== 1) {
            return;
        }
        const [entry] = selected;
        const newName = await requestInput('New name', entry.name);
        if (!newName) {
            return;
        }
        vscode.postMessage({
            type: 'renameEntry',
            location: side === 'remote' ? 'remote' : getActiveRightLocation(),
            path: getEntryPath(snapshot, entry),
            newName,
            requestId: side === 'remote' ? requestIds.remote : getActiveRequestId(),
        });
    }

    function duplicateSelected(side) {
        resetStatus();
        const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
        const selected = getSelectedEntries(snapshot);
        if (selected.length !== 1) {
            return;
        }
        const [entry] = selected;
        vscode.postMessage({
            type: 'duplicateEntry',
            location: side === 'remote' ? 'remote' : getActiveRightLocation(),
            path: getEntryPath(snapshot, entry),
            requestId: side === 'remote' ? requestIds.remote : getActiveRequestId(),
        });
    }

    function copyBetweenPanels(direction) {
        resetStatus();
        if (direction === 'remoteToRight') {
            const selected = getSelectedEntries(state.remote);
            if (!selected.length) {
                return;
            }
            const destination = getActiveRightSnapshot();
            vscode.postMessage({
                type: 'copyEntries',
                items: selected.map((entry) => ({ location: 'remote', path: getEntryPath(state.remote, entry) })),
                toDirectory: { location: getActiveRightLocation(), path: destination.path },
                requestId: getActiveRequestId(),
            });
        } else {
            const snapshot = getActiveRightSnapshot();
            const selected = getSelectedEntries(snapshot);
            if (!selected.length) {
                return;
            }
            vscode.postMessage({
                type: 'copyEntries',
                items: selected.map((entry) => ({ location: getActiveRightLocation(), path: getEntryPath(snapshot, entry) })),
                toDirectory: { location: 'remote', path: state.remote.path },
                requestId: requestIds.remote,
            });
        }
    }

    function openTerminal(side) {
        if (state.connectionState !== 'connected') {
            return;
        }
        resetStatus();
        if (side === 'remote') {
            vscode.postMessage({ type: 'openTerminal', location: 'remote', path: state.remote.path || '/' });
            return;
        }

        const snapshot = getActiveRightSnapshot();
        vscode.postMessage({ type: 'openTerminal', location: getActiveRightLocation(), path: snapshot.path });
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
    elements.remoteOpenTerminal.addEventListener('click', () => openTerminal('remote'));
    elements.localOpenTerminal.addEventListener('click', () => openTerminal('right'));

    elements.contextRun.addEventListener('click', () => {
        hideContextMenu();
        runSelected(contextMenuState.side);
    });
    elements.contextRename.addEventListener('click', () => {
        hideContextMenu();
        renameSelected(contextMenuState.side);
    });
    elements.contextDuplicate.addEventListener('click', () => {
        hideContextMenu();
        duplicateSelected(contextMenuState.side);
    });
    elements.contextPermissions.addEventListener('click', () => {
        hideContextMenu();
        requestPermissions(contextMenuState.side);
    });
    elements.contextDelete.addEventListener('click', () => {
        hideContextMenu();
        deleteSelected(contextMenuState.side);
    });

    elements.contextSelect.addEventListener('click', () => {
        hideContextMenu();
        const snapshot = contextMenuState.side === 'remote' ? state.remote : getActiveRightSnapshot();
        const selected = getSelectedEntries(snapshot);
        if (selected.length) {
            setSelection(contextMenuState.side, [...selected], selected[selected.length - 1]);
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !elements.confirmDialog.classList.contains('dialog--hidden')) {
            hideConfirmation(false);
        }
    });

    elements.confirmYes.addEventListener('click', () => hideConfirmation(true));
    elements.confirmCancel.addEventListener('click', () => hideConfirmation(false));
    elements.confirmDismiss.addEventListener('click', () => hideConfirmation(false));
    elements.confirmDialog.addEventListener('click', (event) => {
        if (event.target === elements.confirmDialog) {
            hideConfirmation(false);
        }
    });

    elements.permissionsCancel.addEventListener('click', () => {
        hidePermissionsDialog();
    });
    elements.permissionsDismiss.addEventListener('click', () => {
        hidePermissionsDialog();
    });
    elements.permissionsSave.addEventListener('click', () => {
        if (!permissionsState.info) {
            return;
        }
        const ownerValue = parseIdValue(elements.permissionsOwner.value);
        if (!ownerValue.valid) {
            setPermissionsError('Owner must be a name or non-negative integer.');
            return;
        }
        const groupValue = parseIdValue(elements.permissionsGroup.value);
        if (!groupValue.valid) {
            setPermissionsError('Group must be a name or non-negative integer.');
            return;
        }

        const mode = buildModeFromDialog();
        const location = permissionsState.info.location;
        const requestId = location === 'remote'
            ? (permissionsState.side === 'remote' ? requestIds.remote : requestIds.rightRemote)
            : requestIds.local;
        const paths = permissionsState.paths && permissionsState.paths.length > 0
            ? permissionsState.paths
            : [permissionsState.info.path];
        vscode.postMessage({
            type: paths.length > 1 ? 'updatePermissionsBatch' : 'updatePermissions',
            location,
            path: paths.length === 1 ? paths[0] : undefined,
            paths: paths.length === 1 ? undefined : paths,
            mode,
            owner: ownerValue.value,
            group: groupValue.value,
            requestId,
        });
        hidePermissionsDialog();
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

    function requestConfirmation(message, strongText) {
        return new Promise((resolve) => {
            confirmationState.resolver = resolve;
            elements.confirmMessage.textContent = '';
            const messageWrapper = document.createElement('div');
            const prefix = document.createElement('span');
            prefix.textContent = `${message} `;
            const target = document.createElement('strong');
            target.textContent = strongText || '';
            const suffix = document.createElement('span');
            suffix.textContent = ' ?';
            messageWrapper.append(prefix, target, suffix);
            elements.confirmMessage.appendChild(messageWrapper);
            elements.confirmDialog.classList.remove('dialog--hidden');
            elements.confirmDialog.setAttribute('aria-hidden', 'false');
            elements.confirmYes.focus();
        });
    }

    function hideConfirmation(result = false) {
        elements.confirmDialog.classList.add('dialog--hidden');
        elements.confirmDialog.setAttribute('aria-hidden', 'true');
        if (confirmationState.resolver) {
            confirmationState.resolver(Boolean(result));
            confirmationState.resolver = undefined;
        }
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
            case 'inputResult': {
                const resolver = pending.inputs.get(message.requestId);
                if (typeof resolver === 'function') {
                    resolver(message.value || '');
                }
                pending.inputs.delete(message.requestId);
                break;
            }
            case 'permissionsInfo':
                handlePermissionsInfo(message);
                break;
        }
    });

    vscode.postMessage({ type: 'requestInit' });
})();
