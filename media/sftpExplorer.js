/**
 * Implements the SFTP explorer Webview, handling directory listings, selections, and file actions.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 */

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
    sftpPresetsRemote: [],
    sftpPresetsLocal: [],
    presetsDialogLocation: 'remote',
    searchDrafts: {
      remote: createSearchOptions(),
      rightLocal: createSearchOptions(),
      rightRemote: createSearchOptions(),
    },
  };

  const isTestMode = document.body?.dataset.testMode === 'true';
  const isLinuxHost = /^lin/.test(document.body?.dataset.hostOs || '');

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
    remotePresetToggle: document.getElementById('remotePresetToggle'),
    remotePresetMenu: document.getElementById('remotePresetMenu'),
    remotePresetManage: document.getElementById('remotePresetManage'),
    localPath: document.getElementById('localPath'),
    rightPresetToggle: document.getElementById('rightPresetToggle'),
    rightPresetMenu: document.getElementById('rightPresetMenu'),
    rightPresetManage: document.getElementById('rightPresetManage'),
    remoteOpenTerminal: document.getElementById('remoteOpenTerminal'),
    localOpenTerminal: document.getElementById('localOpenTerminal'),
    remoteList: document.getElementById('remoteList'),
    localList: document.getElementById('localList'),
    remoteQuickSearch: document.getElementById('remoteQuickSearch'),
    localQuickSearch: document.getElementById('localQuickSearch'),
    remoteHome: document.getElementById('remoteHome'),
    remoteUp: document.getElementById('remoteUp'),
    remoteRefresh: document.getElementById('remoteRefresh'),
    remoteNewFolder: document.getElementById('remoteNewFolder'),
    remoteNewFile: document.getElementById('remoteNewFile'),
    remoteFind: document.getElementById('remoteFind'),
    remoteToLocal: document.getElementById('remoteToLocal'),
    localHome: document.getElementById('localHome'),
    localUp: document.getElementById('localUp'),
    localRefresh: document.getElementById('localRefresh'),
    localNewFolder: document.getElementById('localNewFolder'),
    localNewFile: document.getElementById('localNewFile'),
    localFind: document.getElementById('localFind'),
    localToRemote: document.getElementById('localToRemote'),
    rightMode: document.getElementById('rightMode'),
    contextMenu: document.getElementById('contextMenu'),
    contextSelect: document.getElementById('contextSelect'),
    contextRun: document.getElementById('contextRun'),
    contextViewContent: document.getElementById('contextViewContent'),
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
    sftpPresetsDialog: document.getElementById('sftpPresetsDialog'),
    sftpPresetsList: document.getElementById('sftpPresetsList'),
    sftpPresetsSave: document.getElementById('sftpPresetsSave'),
    sftpPresetsCancel: document.getElementById('sftpPresetsCancel'),
    sftpPresetsDismiss: document.getElementById('sftpPresetsDismiss'),
    findDialog: document.getElementById('findDialog'),
    findDialogTarget: document.getElementById('findDialogTarget'),
    findDialogDismiss: document.getElementById('findDialogDismiss'),
    findDialogCancel: document.getElementById('findDialogCancel'),
    findDialogSubmit: document.getElementById('findDialogSubmit'),
    findDialogError: document.getElementById('findDialogError'),
    findByName: document.getElementById('findByName'),
    findNameCaseSensitive: document.getElementById('findNameCaseSensitive'),
    findBySize: document.getElementById('findBySize'),
    findTimeDays: document.getElementById('findTimeDays'),
    findByPermissions: document.getElementById('findByPermissions'),
    findExcludePath: document.getElementById('findExcludePath'),
    findIncludeSubdirectories: document.getElementById('findIncludeSubdirectories'),
    findByContent: document.getElementById('findByContent'),
    findContentCaseSensitive: document.getElementById('findContentCaseSensitive'),
    findContentWholeWord: document.getElementById('findContentWholeWord'),
    findContentExactLine: document.getElementById('findContentExactLine'),
    findCommandPreview: document.getElementById('findCommandPreview'),
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
    searchPreviewRequestId: undefined,
  };

  const searchDialogState = {
    side: 'remote',
    location: 'remote',
    requestId: requestIds.remote,
    draftKey: 'remote',
    basePath: '',
    previewRequestId: undefined,
    submitting: false,
  };

  const presetInputs = [];
  const presetLimit = 10;

  const quickSearch = {
    delay: 1200,
    remote: {
      term: '',
      timer: undefined,
      lastInput: 0,
    },
    right: {
      term: '',
      timer: undefined,
      lastInput: 0,
    },
  };

  if (isTestMode) {
    quickSearch.delay = 10000;
  }

  const pendingAutoSelect = new Set();

  /**
   * Generates a unique identifier for correlating list requests.
   */
  function createRequestId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createSnapshot() {
    return {
      path: '',
      parentPath: '',
      isRoot: true,
      entries: [],
      location: 'remote',
      selected: [],
      search: undefined,
      emptyMessage: '',
    };
  }

  function createSearchOptions() {
    return {
      name: '',
      nameCaseSensitive: false,
      sizeValue: '',
      sizeMode: 'exactly',
      timeKind: 'modified',
      timeComparator: 'inLast',
      timeDays: '',
      permissions: '',
      excludePath: '',
      includeSubdirectories: true,
      content: '',
      contentCaseSensitive: false,
      contentWholeWordOnly: false,
      contentExactLineMatch: false,
    };
  }

  function setStatus(message, isError = false) {
    elements.status.textContent = message || '';
    elements.status.classList.toggle('status--error', Boolean(isError));
    elements.status.classList.toggle(
      'status--waiting',
      message === 'Waiting for the user to enter the password…' && !isError
    );
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
    if (entry.fullPath) {
      return entry.fullPath;
    }
    if (!snapshot.path || snapshot.path === '/') {
      return `/${entry.name}`;
    }
    if (snapshot.path.endsWith('/')) {
      return `${snapshot.path}${entry.name}`;
    }
    return `${snapshot.path}/${entry.name}`;
  }

  function getSearchDraftKeyForSide(side) {
    if (side === 'remote') {
      return 'remote';
    }
    return getActiveRightLocation() === 'local' ? 'rightLocal' : 'rightRemote';
  }

  function getSearchDraftForSide(side) {
    return state.searchDrafts[getSearchDraftKeyForSide(side)];
  }

  function getSelectedEntries(snapshot) {
    return snapshot.selected ?? [];
  }

  function getQuickSearchState(side) {
    return side === 'remote' ? quickSearch.remote : quickSearch.right;
  }

  function getQuickSearchLabel(side) {
    return side === 'remote' ? elements.remoteQuickSearch : elements.localQuickSearch;
  }

  function setQuickSearchLabel(side, term) {
    const label = getQuickSearchLabel(side);
    if (!label) {
      return;
    }
    label.textContent = term;
    const isVisible = term.length > 0;
    label.classList.toggle('quick-search--visible', isVisible);
    label.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
  }

  function clearQuickSearch(side) {
    const stateForSide = getQuickSearchState(side);
    if (stateForSide.timer) {
      clearTimeout(stateForSide.timer);
      stateForSide.timer = undefined;
    }
    stateForSide.term = '';
    stateForSide.lastInput = 0;
    setQuickSearchLabel(side, '');
  }

  function scheduleQuickSearchClear(side) {
    const stateForSide = getQuickSearchState(side);
    if (stateForSide.timer) {
      clearTimeout(stateForSide.timer);
    }
    stateForSide.timer = setTimeout(() => {
      clearQuickSearch(side);
    }, quickSearch.delay);
  }

  function postTestMessage(type, payload) {
    if (!isTestMode) {
      return;
    }
    vscode.postMessage({ type, ...payload });
  }

  function buildTestState() {
    const rightSnapshot = getActiveRightSnapshot();
    return {
      connectionState: state.connectionState,
      focusedSide: getFocusedListSide(),
      quickSearch: {
        remote: quickSearch.remote.term,
        right: quickSearch.right.term,
      },
      remote: {
        path: state.remote.path,
        selected: getSelectedEntries(state.remote).map((entry) => entry.name),
      },
      right: {
        path: rightSnapshot.path,
        selected: getSelectedEntries(rightSnapshot).map((entry) => entry.name),
        mode: state.rightMode,
      },
      search: {
        dialogOpen: !elements.findDialog?.classList.contains('dialog--hidden'),
        remoteActive: Boolean(state.remote.search),
        rightActive: Boolean(rightSnapshot.search),
        previewCommand: elements.findCommandPreview?.textContent || '',
        previewError: elements.findDialogError?.textContent || '',
      },
    };
  }

  function postTestState(requestId) {
    postTestMessage('testState', { requestId, state: buildTestState() });
  }

  function selectEntryByName(side, name) {
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    const match = snapshot.entries.find((entry) => entry.name === name);
    if (match) {
      selectEntryAndReveal(side, match);
    }
  }

  function performContextSelect(side) {
    hideContextMenu();
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    const selected = getSelectedEntries(snapshot);
    if (selected.length) {
      setSelection(side, [...selected], selected[selected.length - 1]);
      focusList(side);
      requestAnimationFrame(() => focusList(side));
    }
  }

  function simulateTestKey(payload) {
    const side = payload.side || 'remote';
    focusList(side);
    const event = new KeyboardEvent('keydown', {
      key: payload.key,
      code: payload.code || payload.key,
      ctrlKey: Boolean(payload.ctrlKey),
      metaKey: Boolean(payload.metaKey),
      altKey: Boolean(payload.altKey),
      shiftKey: Boolean(payload.shiftKey),
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
  }

  function handleTestCommand(message) {
    if (!isTestMode) {
      return;
    }
    const side = message.side || 'remote';
    switch (message.command) {
      case 'simulateKey':
        simulateTestKey(message);
        break;
      case 'selectEntry':
        selectEntryByName(side, message.name);
        break;
      case 'clearQuickSearch':
        clearQuickSearch(side);
        break;
      case 'clearSelection':
        clearSelection(side === 'remote' ? 'remote' : 'right');
        break;
      case 'getState':
        postTestState(message.requestId);
        break;
      case 'confirmDialog':
        hideConfirmation(message.confirmed !== false);
        break;
      case 'contextSelect':
        performContextSelect(side);
        break;
      case 'focusSide':
        focusList(side);
        break;
      case 'openFindDialog':
        openFindDialog(side);
        break;
      case 'setFindOptions':
        applyFindOptions(message.options || {});
        break;
      case 'submitFind':
        submitFindDialog();
        break;
      case 'setRightMode':
        elements.rightMode.value = message.mode === 'remote' ? 'remote' : 'local';
        elements.rightMode.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      default:
        break;
    }
  }

  function scheduleAutoSelect(requestId) {
    pendingAutoSelect.add(requestId);
  }

  function consumeAutoSelect(requestId) {
    if (!pendingAutoSelect.has(requestId)) {
      return false;
    }
    pendingAutoSelect.delete(requestId);
    return true;
  }

  function getFocusedListSide() {
    const active = document.activeElement;
    if (active === elements.remoteList) {
      return 'remote';
    }
    if (active === elements.localList) {
      return 'right';
    }
    return undefined;
  }

  function focusList(side) {
    const list = side === 'remote' ? elements.remoteList : elements.localList;
    list?.focus();
  }

  function ensureSelectionForSide(side) {
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    if (snapshot.selected.length) {
      return;
    }
    const firstEntry = snapshot.entries[0];
    if (firstEntry) {
      setSingleSelection(side, firstEntry);
    }
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof HTMLElement)) {
      return false;
    }
    if (target.closest('input, textarea, select')) {
      return true;
    }
    let current = target;
    while (current) {
      if (current.isContentEditable) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function isQuickSearchKey(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }
    if (event.key === ' ' || event.code === 'Space') {
      return false;
    }
    return event.key.length === 1;
  }

  function getCssSafeValue(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
  }

  function selectEntryAndReveal(side, entry) {
    setSingleSelection(side, entry);
    requestAnimationFrame(() => {
      const list = side === 'remote' ? elements.remoteList : elements.localList;
      const selector = `.entry[data-name="${getCssSafeValue(entry.name)}"]`;
      const row = list?.querySelector(selector);
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  function performQuickSearch(side, key) {
    const stateForSide = getQuickSearchState(side);
    const now = Date.now();
    if (now - stateForSide.lastInput > quickSearch.delay) {
      stateForSide.term = '';
    }
    stateForSide.lastInput = now;
    stateForSide.term += key.toLowerCase();
    setQuickSearchLabel(side, stateForSide.term);
    scheduleQuickSearchClear(side);

    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    const match = snapshot.entries.find((entry) =>
      entry.name.toLowerCase().startsWith(stateForSide.term)
    );
    if (match) {
      selectEntryAndReveal(side, match);
    }
  }

  function isQuickSearchActive(side) {
    return getQuickSearchState(side).term.length > 0;
  }

  function selectNextQuickSearchMatch(side) {
    const stateForSide = getQuickSearchState(side);
    const term = stateForSide.term;
    if (!term) {
      return false;
    }
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    if (!snapshot.entries.length) {
      return false;
    }
    const normalizedTerm = term.toLowerCase();
    const selected = getSelectedEntries(snapshot);
    const anchorName = getSelectionAnchor(side) || selected[selected.length - 1]?.name;
    const startIndex = anchorName
      ? snapshot.entries.findIndex((entry) => entry.name === anchorName)
      : -1;
    let match = undefined;
    for (let index = startIndex + 1; index < snapshot.entries.length; index += 1) {
      const entry = snapshot.entries[index];
      if (entry.name.toLowerCase().startsWith(normalizedTerm)) {
        match = entry;
        break;
      }
    }
    if (!match) {
      match = snapshot.entries.find((entry) => entry.name.toLowerCase().startsWith(normalizedTerm));
    }
    if (!match) {
      return false;
    }
    selectEntryAndReveal(side, match);
    stateForSide.lastInput = Date.now();
    scheduleQuickSearchClear(side);
    return true;
  }

  function moveSelectionByOffset(side, offset) {
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    if (!snapshot.entries.length) {
      return false;
    }
    const selected = getSelectedEntries(snapshot);
    if (!selected.length) {
      return false;
    }
    const anchorName = getSelectionAnchor(side) || selected[selected.length - 1]?.name;
    if (!anchorName) {
      return false;
    }
    const currentIndex = snapshot.entries.findIndex((entry) => entry.name === anchorName);
    if (currentIndex < 0) {
      return false;
    }
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= snapshot.entries.length) {
      return false;
    }
    selectEntryAndReveal(side, snapshot.entries[nextIndex]);
    return true;
  }

  function getSelectionAnchorKey(side) {
    if (side === 'remote') {
      return 'remote';
    }
    return getActiveRightLocation() === 'local' ? 'rightLocal' : 'rightRemote';
  }

  function getSelectionAnchorKeyForRequestId(requestId) {
    if (requestId === requestIds.remote) {
      return 'remote';
    }
    if (requestId === requestIds.local) {
      return 'rightLocal';
    }
    return 'rightRemote';
  }

  function getSelectionAnchor(side) {
    return selectionAnchors[getSelectionAnchorKey(side)];
  }

  function setSelectionAnchor(side, entry) {
    selectionAnchors[getSelectionAnchorKey(side)] = entry ? entry.name : undefined;
  }

  function setSelectionAnchorForRequestId(requestId, entry) {
    selectionAnchors[getSelectionAnchorKeyForRequestId(requestId)] = entry ? entry.name : undefined;
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

  /**
   * Renders both left and right explorer panes and updates toolbar state.
   */
  function renderLists() {
    elements.remoteList.classList.toggle('list--search-results', Boolean(state.remote.search));
    elements.localList.classList.toggle(
      'list--search-results',
      Boolean(getActiveRightSnapshot().search)
    );
    renderPane(elements.remoteList, state.remote, 'remote');
    renderPane(elements.localList, getActiveRightSnapshot(), 'right');
    updatePaths();
    updateButtons();
  }

  /**
   * Renders a single list pane using the provided snapshot and side identifier.
   */
  function renderPane(container, snapshot, side) {
    container.innerHTML = '';
    const maxNameLength = snapshot.entries.reduce(
      (max, entry) => Math.max(max, entry.name.length),
      0
    );
    const nameWidth = Math.min(Math.max(maxNameLength, 1), 32);
    container.style.setProperty('--name-col-width', `${nameWidth}ch`);

    const frag = document.createDocumentFragment();
    if (snapshot.entries.length === 0) {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'list__empty';
      emptyRow.textContent = snapshot.emptyMessage || 'Folder empty';
      frag.appendChild(emptyRow);
    }
    const selectedEntries = getSelectedEntries(snapshot);
    snapshot.entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'entry';
      row.setAttribute('role', 'treeitem');
      row.dataset.type = entry.type;
      row.dataset.name = entry.name;
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

      const relativePathCell = document.createElement('div');
      relativePathCell.className = 'entry__cell entry__cell--relative-path';
      relativePathCell.textContent = entry.relativePath || entry.name;
      if (entry.relativePath) {
        relativePathCell.title = entry.relativePath;
      }

      const selected = selectedEntries.some((selectedEntry) => selectedEntry.name === entry.name);
      if (selected) {
        row.classList.add('entry--selected');
      }

      if (snapshot.search) {
        row.classList.add('entry--search-result');
      }

      row.appendChild(nameCell);
      row.appendChild(sizeCell);
      row.appendChild(permissionCell);
      row.appendChild(modifiedCell);
      if (snapshot.search) {
        row.appendChild(relativePathCell);
      }
      row.addEventListener('click', (event) => handleEntryClick(side, snapshot, entry, event));
      row.addEventListener('contextmenu', (event) => handleEntryContextMenu(side, entry, event));
      frag.appendChild(row);
    });
    container.appendChild(frag);
  }

  /**
   * Handles click selection logic for entries, supporting multi-select and range selection.
   */
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
      const requestId = side === 'remote' ? requestIds.remote : getActiveRequestId();
      scheduleAutoSelect(requestId);
      requestList(location, nextPath, requestId);
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
    const target =
      side === 'remote'
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
    const location = resolveLocationForSide(side, snapshot);
    const selected = getSelectedEntries(snapshot);
    const selectedCount = selected.length;
    const disableSingleOnly = selectedCount !== 1;
    const selectedEntry = selectedCount === 1 ? selected[0] : undefined;
    const isRemoteLocation = location === 'remote';
    const isLocalLocation = location === 'local';

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

    if (elements.contextViewContent) {
      const canView = Boolean(
        selectedEntry && selectedEntry.type === 'file' && (isRemoteLocation || isLocalLocation)
      );
      elements.contextViewContent.disabled = !canView;
      elements.contextViewContent.classList.toggle('context-menu__item--disabled', !canView);
      elements.contextViewContent.classList.toggle('context-menu__item--hidden', !canView);
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
    prefix.textContent =
      selectedCount > 1
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

    elements.permissionsOwner.value =
      info.ownerName || (info.owner !== undefined ? String(info.owner) : '');
    elements.permissionsGroup.value =
      info.groupName || (info.group !== undefined ? String(info.group) : '');
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
    elements.remotePath.value = state.remote.path;
    elements.localPath.value = getActiveRightSnapshot().path;
  }

  function normalizePresets(values) {
    const sanitized = Array.isArray(values) ? values : [];
    return Array.from({ length: presetLimit }, (_, index) => sanitized[index] ?? '');
  }

  function renderPresetMenu(menu, values) {
    if (!menu) {
      return;
    }
    const options = normalizePresets(values).filter((entry) => entry);
    menu.innerHTML = '';
    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-menu__empty';
      empty.textContent = 'No presets saved';
      menu.appendChild(empty);
      return;
    }
    options.forEach((entry) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'preset-menu__item';
      item.textContent = entry;
      item.dataset.value = entry;
      menu.appendChild(item);
    });
  }

  function setPresetMenuOpen(side, isOpen) {
    const menu = side === 'remote' ? elements.remotePresetMenu : elements.rightPresetMenu;
    const toggle = side === 'remote' ? elements.remotePresetToggle : elements.rightPresetToggle;
    if (!menu || !toggle) {
      return;
    }
    menu.classList.toggle('preset-menu--open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function closePresetMenus() {
    setPresetMenuOpen('remote', false);
    setPresetMenuOpen('right', false);
  }

  function togglePresetMenu(side) {
    const menu = side === 'remote' ? elements.remotePresetMenu : elements.rightPresetMenu;
    if (!menu) {
      return;
    }
    const isOpen = menu.classList.contains('preset-menu--open');
    closePresetMenus();
    if (!isOpen) {
      setPresetMenuOpen(side, true);
    }
  }

  function selectPreset(side, value) {
    if (!value) {
      return;
    }
    if (side === 'remote') {
      elements.remotePath.value = value;
      submitPath('remote');
    } else {
      elements.localPath.value = value;
      submitPath('right');
    }
  }

  function buildPresetRows(values) {
    if (!elements.sftpPresetsList) {
      return;
    }
    presetInputs.length = 0;
    elements.sftpPresetsList.innerHTML = '';
    normalizePresets(values).forEach((value) => {
      const row = document.createElement('div');
      row.className = 'preset-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'preset-row__input';
      input.value = value;
      input.spellcheck = false;
      input.placeholder = '/var/log';
      row.appendChild(input);
      elements.sftpPresetsList.appendChild(row);
      presetInputs.push({ input });
    });
  }

  function openPresetsDialog() {
    const values =
      state.presetsDialogLocation === 'remote' ? state.sftpPresetsRemote : state.sftpPresetsLocal;
    buildPresetRows(values);
    elements.sftpPresetsDialog.classList.remove('dialog--hidden');
    elements.sftpPresetsDialog.setAttribute('aria-hidden', 'false');
    presetInputs[0]?.input?.focus();
  }

  function hidePresetsDialog() {
    elements.sftpPresetsDialog.classList.add('dialog--hidden');
    elements.sftpPresetsDialog.setAttribute('aria-hidden', 'true');
  }

  function savePresets() {
    const values = presetInputs.map(({ input }) => input.value.trim());
    vscode.postMessage({
      type: 'saveSftpPresets',
      location: state.presetsDialogLocation,
      presets: values,
    });
    hidePresetsDialog();
  }

  function getRadioValue(name, fallback) {
    const selected = document.querySelector(`input[name="${name}"]:checked`);
    return selected?.value || fallback;
  }

  function setRadioValue(name, value) {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) {
      input.checked = true;
    }
  }

  function collectFindOptions() {
    return {
      name: elements.findByName.value.trim(),
      nameCaseSensitive: elements.findNameCaseSensitive.checked,
      sizeValue: elements.findBySize.value.trim(),
      sizeMode: getRadioValue('findSizeMode', 'exactly'),
      timeKind: getRadioValue('findTimeKind', 'modified'),
      timeComparator: getRadioValue('findTimeComparator', 'inLast'),
      timeDays: elements.findTimeDays.value.trim(),
      permissions: elements.findByPermissions.value.trim(),
      excludePath: elements.findExcludePath.value.trim(),
      includeSubdirectories: elements.findIncludeSubdirectories.checked,
      content: elements.findByContent.value.trim(),
      contentCaseSensitive: elements.findContentCaseSensitive.checked,
      contentWholeWordOnly: elements.findContentWholeWord.checked,
      contentExactLineMatch: elements.findContentExactLine.checked,
    };
  }

  function applyFindOptions(options) {
    elements.findByName.value = options.name || '';
    elements.findNameCaseSensitive.checked = Boolean(options.nameCaseSensitive);
    elements.findBySize.value = options.sizeValue || '';
    setRadioValue('findSizeMode', options.sizeMode || 'exactly');
    setRadioValue('findTimeKind', options.timeKind || 'modified');
    setRadioValue('findTimeComparator', options.timeComparator || 'inLast');
    elements.findTimeDays.value = options.timeDays || '';
    elements.findByPermissions.value = options.permissions || '';
    elements.findExcludePath.value = options.excludePath || '';
    elements.findIncludeSubdirectories.checked = options.includeSubdirectories !== false;
    elements.findByContent.value = options.content || '';
    elements.findContentCaseSensitive.checked = Boolean(options.contentCaseSensitive);
    elements.findContentWholeWord.checked = Boolean(options.contentWholeWordOnly);
    elements.findContentExactLine.checked = Boolean(options.contentExactLineMatch);
    scheduleSearchPreview();
  }

  function setFindDialogError(message) {
    elements.findDialogError.textContent = message || '';
    elements.findDialogSubmit.disabled =
      state.connectionState !== 'connected' || Boolean(message) || searchDialogState.submitting;
  }

  function scheduleSearchPreview() {
    if (!elements.findDialog || elements.findDialog.classList.contains('dialog--hidden')) {
      return;
    }
    const draft = collectFindOptions();
    state.searchDrafts[searchDialogState.draftKey] = draft;
    const requestId = createRequestId();
    searchDialogState.previewRequestId = requestId;
    pending.searchPreviewRequestId = requestId;
    vscode.postMessage({
      type: 'previewSearchCommand',
      location: searchDialogState.location,
      basePath: searchDialogState.basePath,
      options: draft,
      requestId,
    });
  }

  function closeSearchMode(side) {
    if (state.connectionState !== 'connected') {
      return;
    }
    resetStatus();
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    if (!snapshot.search) {
      return;
    }

    const requestId = side === 'remote' ? requestIds.remote : getActiveRequestId();
    requestList(snapshot.location, snapshot.search.basePath, requestId);
    clearSelection(side === 'remote' ? 'remote' : 'right');
  }

  function openFindDialog(side) {
    if (state.connectionState !== 'connected') {
      return;
    }
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    if (snapshot.search) {
      closeSearchMode(side);
      return;
    }
    const location = side === 'remote' ? 'remote' : getActiveRightLocation();
    if (location === 'local' && !isLinuxHost) {
      return;
    }

    searchDialogState.side = side;
    searchDialogState.location = location;
    searchDialogState.requestId = side === 'remote' ? requestIds.remote : getActiveRequestId();
    searchDialogState.draftKey = getSearchDraftKeyForSide(side);
    searchDialogState.basePath = snapshot.path;
    searchDialogState.submitting = false;

    const titleLocation = location === 'remote' ? 'remote' : 'local';
    elements.findDialogTarget.textContent = `Find files from ${titleLocation}: ${snapshot.path}`;
    applyFindOptions(snapshot.search?.options || getSearchDraftForSide(side));
    elements.findCommandPreview.textContent = snapshot.search?.command || '';
    setFindDialogError('');
    elements.findDialog.classList.remove('dialog--hidden');
    elements.findDialog.setAttribute('aria-hidden', 'false');
    elements.findByName.focus();
    scheduleSearchPreview();
  }

  function hideFindDialog() {
    elements.findDialog.classList.add('dialog--hidden');
    elements.findDialog.setAttribute('aria-hidden', 'true');
    searchDialogState.submitting = false;
    setFindDialogError('');
  }

  function submitFindDialog() {
    if (state.connectionState !== 'connected') {
      return;
    }
    if (elements.findDialogSubmit.disabled) {
      return;
    }
    searchDialogState.submitting = true;
    setFindDialogError(elements.findDialogError.textContent);
    const options = collectFindOptions();
    state.searchDrafts[searchDialogState.draftKey] = options;
    vscode.postMessage({
      type: 'searchEntries',
      location: searchDialogState.location,
      basePath: searchDialogState.basePath,
      options,
      requestId: searchDialogState.requestId,
    });
    hideFindDialog();
  }

  function handleSearchCommandPreview(message) {
    if (message.requestId !== pending.searchPreviewRequestId) {
      return;
    }
    elements.findCommandPreview.textContent = message.command || '';
    setFindDialogError(message.error || '');
  }

  function updateButtons() {
    const remoteSelected = getSelectedEntries(state.remote).length > 0;
    const rightSnapshot = getActiveRightSnapshot();
    const rightSelected = getSelectedEntries(rightSnapshot).length > 0;
    const disabled = state.connectionState !== 'connected';
    const rightLocation = getActiveRightLocation();
    const showLocalFind = rightLocation === 'remote' || isLinuxHost;

    elements.remoteHome.disabled = disabled;
    elements.remoteToLocal.disabled = disabled || !remoteSelected;
    elements.remoteUp.disabled = disabled || state.remote.isRoot;
    elements.remoteRefresh.disabled = disabled;
    elements.remoteNewFolder.disabled = disabled;
    elements.remoteNewFile.disabled = disabled;
    elements.remoteFind.disabled = disabled;
    elements.remoteOpenTerminal.disabled = disabled;
    elements.remotePath.disabled = disabled;
    elements.remotePresetToggle.disabled = disabled;
    elements.remotePresetManage.disabled = disabled;

    elements.localHome.disabled = disabled;
    elements.localToRemote.disabled = disabled || !rightSelected;
    elements.localUp.disabled = disabled || rightSnapshot.isRoot;
    elements.localRefresh.disabled = disabled;
    elements.localNewFolder.disabled = disabled;
    elements.localNewFile.disabled = disabled;
    elements.localFind.disabled = disabled;
    elements.localOpenTerminal.disabled = disabled;
    elements.localPath.disabled = disabled;
    elements.rightPresetToggle.disabled = disabled;
    elements.rightPresetManage.disabled = disabled;
    elements.rightMode.disabled = disabled;

    elements.remoteFind.classList.toggle('action--search-active', Boolean(state.remote.search));
    elements.localFind.classList.toggle('action--search-active', Boolean(rightSnapshot.search));
    elements.localFind.classList.toggle('action--hidden', !showLocalFind);
    elements.localFind.title = 'find files';
    elements.localFind.setAttribute('aria-label', 'find files');

    if (disabled) {
      closePresetMenus();
    }
  }

  /**
   * Requests a directory listing from the extension host.
   */
  function requestList(location, path, requestId) {
    vscode.postMessage({ type: 'listEntries', location, path, requestId });
  }

  function submitPath(side) {
    if (state.connectionState !== 'connected') {
      return;
    }

    resetStatus();
    const input = side === 'remote' ? elements.remotePath : elements.localPath;
    const targetPath = input.value.trim();
    if (!targetPath) {
      updatePaths();
      return;
    }

    const location = side === 'remote' ? 'remote' : getActiveRightLocation();
    const requestId = side === 'remote' ? requestIds.remote : getActiveRequestId();
    requestList(location, targetPath, requestId);
    clearSelection(side === 'remote' ? 'remote' : 'right');
  }

  function handleInit(payload) {
    state.remoteHome = payload.remoteHome;
    state.localHome = payload.localHome;
    state.remote = { ...payload.remote, selected: [] };
    state.rightLocal = { ...payload.local, selected: [] };
    state.rightRemote = { ...payload.remote, selected: [] };
    state.sftpPresetsRemote = Array.isArray(payload.sftpPresetsRemote)
      ? payload.sftpPresetsRemote
      : [];
    state.sftpPresetsLocal = Array.isArray(payload.sftpPresetsLocal)
      ? payload.sftpPresetsLocal
      : [];
    renderPresetMenu(elements.remotePresetMenu, state.sftpPresetsRemote);
    renderPresetMenu(
      elements.rightPresetMenu,
      state.rightMode === 'local' ? state.sftpPresetsLocal : state.sftpPresetsRemote
    );
    resetSelectionAnchors();
    renderLists();
    if (isTestMode) {
      postTestMessage('testReady', {});
    }
  }

  /**
   * Applies a list response to the appropriate snapshot and updates the UI.
   */
  function handleListResponse(message) {
    const snapshot = { ...message.snapshot, selected: [] };
    if (message.requestId === requestIds.remote) {
      state.remote = snapshot;
      if (snapshot.search) {
        state.searchDrafts.remote = snapshot.search.options;
      }
    } else if (message.requestId === requestIds.local) {
      state.rightLocal = snapshot;
      if (snapshot.search) {
        state.searchDrafts.rightLocal = snapshot.search.options;
      }
    } else if (message.requestId === requestIds.rightRemote) {
      state.rightRemote = snapshot;
      if (snapshot.search) {
        state.searchDrafts.rightRemote = snapshot.search.options;
      }
    }
    clearSelectionAnchorByRequestId(message.requestId);
    const shouldAutoSelect = consumeAutoSelect(message.requestId);
    if (shouldAutoSelect && snapshot.entries.length) {
      const firstEntry = snapshot.entries[0];
      snapshot.selected = [firstEntry];
      setSelectionAnchorForRequestId(message.requestId, firstEntry);
      if (message.requestId === requestIds.remote || message.requestId === getActiveRequestId()) {
        const side = message.requestId === requestIds.remote ? 'remote' : 'right';
        requestAnimationFrame(() => focusList(side));
      }
    }
    renderLists();
    if (isTestMode) {
      postTestMessage('testListResponse', { requestId: message.requestId, path: snapshot.path });
    }
  }

  /**
   * Updates connection status banners and buttons based on host feedback.
   */
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

  function resolveLocationForSide(side, snapshot) {
    if (side === 'remote') {
      return 'remote';
    }
    if (snapshot?.location === 'remote') {
      return 'remote';
    }
    return getActiveRightLocation();
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

  function goUp(side, options = {}) {
    resetStatus();
    const autoSelectFirst = Boolean(options.autoSelectFirst);
    if (side === 'remote') {
      if (state.remote.isRoot) {
        return;
      }
      if (autoSelectFirst) {
        scheduleAutoSelect(requestIds.remote);
      }
      requestList('remote', state.remote.parentPath, requestIds.remote);
      clearSelection('remote');
    } else {
      const snapshot = getActiveRightSnapshot();
      if (snapshot.isRoot) {
        return;
      }
      if (autoSelectFirst) {
        scheduleAutoSelect(getActiveRequestId());
      }
      requestList(getActiveRightLocation(), snapshot.parentPath, getActiveRequestId());
      clearSelection('right');
    }
  }

  function refresh(side) {
    resetStatus();
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    if (snapshot.search) {
      vscode.postMessage({
        type: 'searchEntries',
        location: snapshot.location,
        basePath: snapshot.search.basePath,
        options: snapshot.search.options,
        requestId: side === 'remote' ? requestIds.remote : getActiveRequestId(),
      });
      clearSelection(side === 'remote' ? 'remote' : 'right');
      return;
    }
    const location = side === 'remote' ? 'remote' : getActiveRightLocation();
    requestList(
      location,
      snapshot.path,
      side === 'remote' ? requestIds.remote : getActiveRequestId()
    );
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
    const location = resolveLocationForSide(side, snapshot);
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

  function viewContent(side) {
    resetStatus();
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    const location = resolveLocationForSide(side, snapshot);
    const selected = getSelectedEntries(snapshot);
    if (selected.length !== 1) {
      return;
    }
    const [entry] = selected;
    if (entry.type !== 'file') {
      return;
    }

    vscode.postMessage({ type: 'viewContent', location, path: getEntryPath(snapshot, entry) });
  }

  function openSelectedEntry(side) {
    resetStatus();
    const snapshot = side === 'remote' ? state.remote : getActiveRightSnapshot();
    const selected = getSelectedEntries(snapshot);
    if (selected.length !== 1) {
      return;
    }
    const [entry] = selected;
    if (entry.type === 'directory') {
      const nextPath = getEntryPath(snapshot, entry);
      const location = side === 'remote' ? 'remote' : getActiveRightLocation();
      const requestId = side === 'remote' ? requestIds.remote : getActiveRequestId();
      scheduleAutoSelect(requestId);
      requestList(location, nextPath, requestId);
      clearSelection(side === 'remote' ? 'remote' : 'right');
      return;
    }
    viewContent(side);
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
    const targetType =
      selected.length > 1
        ? `${selected.length} items`
        : first.type === 'directory'
          ? 'folder'
          : 'file';
    const nameLabel =
      selected.length > 1 ? `${first.name} (+${selected.length - 1} more)` : first.name;
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
      paths:
        selected.length === 1 ? undefined : selected.map((entry) => getEntryPath(snapshot, entry)),
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
        items: selected.map((entry) => ({
          location: 'remote',
          path: getEntryPath(state.remote, entry),
        })),
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
        items: selected.map((entry) => ({
          location: getActiveRightLocation(),
          path: getEntryPath(snapshot, entry),
        })),
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
      vscode.postMessage({
        type: 'openTerminal',
        location: 'remote',
        path: state.remote.path || '/',
      });
      return;
    }

    const snapshot = getActiveRightSnapshot();
    vscode.postMessage({
      type: 'openTerminal',
      location: getActiveRightLocation(),
      path: snapshot.path,
    });
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
  elements.remoteFind.addEventListener('click', () => openFindDialog('remote'));
  elements.localFind.addEventListener('click', () => openFindDialog('right'));
  elements.remoteToLocal.addEventListener('click', () => copyBetweenPanels('remoteToRight'));
  elements.localToRemote.addEventListener('click', () => copyBetweenPanels('rightToRemote'));
  elements.remoteOpenTerminal.addEventListener('click', () => openTerminal('remote'));
  elements.localOpenTerminal.addEventListener('click', () => openTerminal('right'));
  elements.remotePath.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPath('remote');
    }
  });
  elements.remotePresetToggle.addEventListener('click', () => {
    togglePresetMenu('remote');
  });
  elements.remotePresetMenu.addEventListener('click', (event) => {
    const target = event.target.closest('.preset-menu__item');
    if (!target) {
      return;
    }
    selectPreset('remote', target.dataset.value);
    closePresetMenus();
  });
  elements.remotePresetManage.addEventListener('click', () => {
    state.presetsDialogLocation = 'remote';
    openPresetsDialog();
  });
  elements.rightPresetToggle.addEventListener('click', () => {
    togglePresetMenu('right');
  });
  elements.rightPresetMenu.addEventListener('click', (event) => {
    const target = event.target.closest('.preset-menu__item');
    if (!target) {
      return;
    }
    selectPreset('right', target.dataset.value);
    closePresetMenus();
  });
  elements.rightPresetManage.addEventListener('click', () => {
    state.presetsDialogLocation = state.rightMode === 'local' ? 'local' : 'remote';
    openPresetsDialog();
  });
  elements.localPath.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPath('right');
    }
  });

  elements.sftpPresetsSave.addEventListener('click', () => savePresets());
  elements.sftpPresetsCancel.addEventListener('click', () => hidePresetsDialog());
  elements.sftpPresetsDismiss.addEventListener('click', () => hidePresetsDialog());
  elements.findDialogDismiss.addEventListener('click', () => hideFindDialog());
  elements.findDialogCancel.addEventListener('click', () => hideFindDialog());
  elements.findDialogSubmit.addEventListener('click', () => submitFindDialog());

  [
    elements.findByName,
    elements.findNameCaseSensitive,
    elements.findBySize,
    elements.findTimeDays,
    elements.findByPermissions,
    elements.findExcludePath,
    elements.findIncludeSubdirectories,
    elements.findByContent,
    elements.findContentCaseSensitive,
    elements.findContentWholeWord,
    elements.findContentExactLine,
  ].forEach((input) => {
    input?.addEventListener('input', scheduleSearchPreview);
    input?.addEventListener('change', scheduleSearchPreview);
  });

  ['findSizeMode', 'findTimeKind', 'findTimeComparator'].forEach((name) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
      input.addEventListener('change', scheduleSearchPreview);
    });
  });

  elements.contextRun.addEventListener('click', () => {
    hideContextMenu();
    runSelected(contextMenuState.side);
  });
  elements.contextViewContent.addEventListener('click', () => {
    hideContextMenu();
    viewContent(contextMenuState.side);
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
    performContextSelect(contextMenuState.side);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.findDialog.classList.contains('dialog--hidden')) {
      hideFindDialog();
      return;
    }
    if (event.key === 'Escape' && !elements.confirmDialog.classList.contains('dialog--hidden')) {
      hideConfirmation(false);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || state.connectionState !== 'connected') {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    const side = getFocusedListSide();
    if (!side) {
      return;
    }
    const key = event.key;

    if (key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (isQuickSearchActive(side)) {
        if (selectNextQuickSearchMatch(side)) {
          event.preventDefault();
          hideContextMenu();
        }
        return;
      }
      event.preventDefault();
      hideContextMenu();
      openSelectedEntry(side);
      return;
    }

    if (
      (key === 'ArrowUp' || key === 'ArrowDown') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const offset = key === 'ArrowUp' ? -1 : 1;
      if (moveSelectionByOffset(side, offset)) {
        event.preventDefault();
        hideContextMenu();
      }
      return;
    }

    if (
      (key === 'ArrowLeft' || key === 'ArrowRight') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      hideContextMenu();
      const nextSide = side === 'remote' ? 'right' : 'remote';
      ensureSelectionForSide(nextSide);
      focusList(nextSide);
      return;
    }

    if (key === 'Delete') {
      event.preventDefault();
      hideContextMenu();
      deleteSelected(side);
      return;
    }

    if (key === 'Backspace') {
      event.preventDefault();
      hideContextMenu();
      goUp(side, { autoSelectFirst: true });
      return;
    }

    if (key === 'F2') {
      event.preventDefault();
      hideContextMenu();
      renameSelected(side);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'd') {
        event.preventDefault();
        hideContextMenu();
        duplicateSelected(side);
        return;
      }
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearQuickSearch('remote');
      clearQuickSearch('right');
      return;
    }
    if (!isQuickSearchKey(event) || isEditableTarget(event.target)) {
      return;
    }
    const side = getFocusedListSide();
    if (!side || state.connectionState !== 'connected') {
      return;
    }
    performQuickSearch(side, event.key);
  });

  elements.confirmYes.addEventListener('click', () => hideConfirmation(true));
  elements.confirmCancel.addEventListener('click', () => hideConfirmation(false));
  elements.confirmDismiss.addEventListener('click', () => hideConfirmation(false));
  elements.confirmDialog.addEventListener('click', (event) => {
    if (event.target === elements.confirmDialog) {
      hideConfirmation(false);
    }
  });
  elements.findDialog.addEventListener('click', (event) => {
    if (event.target === elements.findDialog) {
      hideFindDialog();
    }
  });
  elements.findDialog.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      submitFindDialog();
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
    const requestId =
      location === 'remote'
        ? permissionsState.side === 'remote'
          ? requestIds.remote
          : requestIds.rightRemote
        : requestIds.local;
    const paths =
      permissionsState.paths && permissionsState.paths.length > 0
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
    const target = event.target;
    const clickedPreset =
      elements.remotePresetMenu?.contains(target) ||
      elements.rightPresetMenu?.contains(target) ||
      elements.remotePresetToggle?.contains(target) ||
      elements.rightPresetToggle?.contains(target);
    if (!clickedPreset) {
      closePresetMenus();
    }
    if (!elements.contextMenu) {
      return;
    }
    if (!elements.contextMenu.contains(target)) {
      hideContextMenu();
    }
  });

  elements.remoteList.addEventListener('click', () => {
    elements.remoteList.focus();
  });
  elements.localList.addEventListener('click', () => {
    elements.localList.focus();
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
    closePresetMenus();
    hideContextMenu();
    renderPresetMenu(
      elements.rightPresetMenu,
      state.rightMode === 'local' ? state.sftpPresetsLocal : state.sftpPresetsRemote
    );
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
      case 'sftpPresetsUpdated':
        if (message.location === 'local') {
          state.sftpPresetsLocal = Array.isArray(message.presets) ? message.presets : [];
        } else {
          state.sftpPresetsRemote = Array.isArray(message.presets) ? message.presets : [];
        }
        renderPresetMenu(elements.remotePresetMenu, state.sftpPresetsRemote);
        renderPresetMenu(
          elements.rightPresetMenu,
          state.rightMode === 'local' ? state.sftpPresetsLocal : state.sftpPresetsRemote
        );
        break;
      case 'searchCommandPreview':
        handleSearchCommandPreview(message);
        break;
      case 'testCommand':
        handleTestCommand(message);
        break;
    }
  });

  vscode.postMessage({ type: 'requestInit' });
})();
