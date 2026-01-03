/**
 * Manages persistent and in-memory state for the log panel Webview.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 */

export const highlightPalette = [
  { foreground: '#1b7f5f', background: '#d2f4e8' },
  { foreground: '#1f6fbf', background: '#d9e9ff' },
  { foreground: '#8e44ad', background: '#efdef7' },
  { foreground: '#c0392b', background: '#f8e0dd' },
  { foreground: '#c27c0e', background: '#fff3ce' },
  { foreground: '#117864', background: '#d5f5e3' },
  { foreground: '#1e8449', background: '#d8f6e2' },
  { foreground: '#884ea0', background: '#e9dff4' },
  { foreground: '#b34700', background: '#fde0cc' },
  { foreground: '#2c3e50', background: '#e2e6eb' },
];

export const levelOrder = {
  ALL: 0,
  DEBUG: 1,
  INFO: 2,
  NOTICE: 3,
  WARNING: 4,
  ERR: 5,
  CRIT: 6,
  ALERT: 7,
  EMERG: 8,
};

export const levelAliases = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  NOTICE: 'NOTICE',
  WARN: 'WARNING',
  WARNING: 'WARNING',
  ERR: 'ERR',
  ERROR: 'ERR',
  CRIT: 'CRIT',
  CRITICAL: 'CRIT',
  ALERT: 'ALERT',
  EMERG: 'EMERG',
  FATAL: 'EMERG',
};

export const LINE_LIMIT_NOTICE_LIVE =
  'Configured display line limit reached. Older lines are being replaced with newer entries.';
export const LINE_LIMIT_NOTICE_OFFLINE =
  'Configured display line limit reached. Older lines are not shown.';

/**
 * Creates the state container and persistence helpers for the logger panel.
 */
export function createStateController(vscode) {
  let entryIdCounter = 0;
  let persistTimeout = null;
  let isRestoringState = false;

  const state = {
    deviceId: '',
    presets: [],
    entries: [],
    filtered: [],
    minLevel: 'ALL',
    textFilter: '',
    wordWrapEnabled: false,
    autoScrollEnabled: true,
    highlights: [],
    nextHighlightId: 1,
    searchTerm: '',
    searchMatches: [],
    searchIndex: -1,
    activeSearchEntry: -1,
    isLiveLog: true,
    autoReconnectEnabled: true,
    connectionState: 'unknown',
    maxEntries: 100000,
    statusText: '',
    defaultConnectedStatus: '',
    secondaryStatus: null,
    autoSaveActive: false,
    lineLimitReached: false,
    activeBookmarkId: null,
  };

  /**
   * Persists the current state snapshot to VS Code storage.
   */
  function persistState() {
    const serializedState = {
      deviceId: state.deviceId,
      presets: state.presets,
      entries: state.entries,
      minLevel: state.minLevel,
      textFilter: state.textFilter,
      wordWrapEnabled: state.wordWrapEnabled,
      autoScrollEnabled: state.autoScrollEnabled,
      highlights: state.highlights,
      nextHighlightId: state.nextHighlightId,
      searchTerm: state.searchTerm,
      isLiveLog: state.isLiveLog,
      autoReconnectEnabled: state.autoReconnectEnabled,
      connectionState: state.connectionState,
      maxEntries: state.maxEntries,
      statusText: state.statusText,
      defaultConnectedStatus: state.defaultConnectedStatus,
      secondaryStatus: state.secondaryStatus,
      autoSaveActive: state.autoSaveActive,
      lineLimitReached: state.lineLimitReached,
      activeBookmarkId: state.activeBookmarkId,
    };
    vscode.setState(serializedState);
  }

  /**
   * Debounced persistence to avoid frequent VS Code API calls.
   */
  function schedulePersist() {
    if (isRestoringState) {
      return;
    }
    if (persistTimeout) {
      return;
    }
    persistTimeout = setTimeout(() => {
      persistTimeout = null;
      persistState();
    }, 300);
  }

  /**
   * Restores entries from a serialized snapshot while respecting the configured max entries.
   */
  function restoreEntries(savedEntries, maxEntries, parseLevelFn) {
    if (!Array.isArray(savedEntries) || !savedEntries.length) {
      return [];
    }

    const sanitized = savedEntries
      .filter((entry) => entry && typeof entry.rawLine === 'string')
      .map((entry) => {
        const id = typeof entry.id === 'number' ? entry.id : entryIdCounter++;
        return {
          id,
          timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
          rawLine: entry.rawLine,
          level:
            typeof entry.level === 'string'
              ? entry.level
              : typeof parseLevelFn === 'function'
                ? parseLevelFn(entry.rawLine)
                : 'ALL',
          className: typeof entry.className === 'string' ? entry.className : null,
          bypassFilters: entry.bypassFilters === true,
          isBookmark: entry.isBookmark === true,
          bookmarkLabel: typeof entry.bookmarkLabel === 'string' ? entry.bookmarkLabel : '',
        };
      });

    const limited = sanitized.slice(-maxEntries);
    const maxId = limited.reduce((max, entry) => Math.max(max, entry.id || 0), -1);
    entryIdCounter = Math.max(entryIdCounter, maxId + 1);
    return limited;
  }

  /**
   * Rehydrates the state object from a VS Code snapshot.
   */
  function restoreStateFromSnapshot(snapshot, helpers) {
    if (!snapshot) {
      return;
    }

    isRestoringState = true;
    state.deviceId = snapshot.deviceId || state.deviceId;
    state.presets = Array.isArray(snapshot.presets) ? snapshot.presets : state.presets;
    state.minLevel = snapshot.minLevel || state.minLevel;
    state.textFilter =
      typeof snapshot.textFilter === 'string' ? snapshot.textFilter : state.textFilter;
    state.wordWrapEnabled =
      snapshot.wordWrapEnabled === true || snapshot.wordWrapEnabled === false
        ? snapshot.wordWrapEnabled
        : state.wordWrapEnabled;
    state.autoScrollEnabled =
      snapshot.autoScrollEnabled === false ? false : state.autoScrollEnabled;
    state.highlights = Array.isArray(snapshot.highlights) ? snapshot.highlights : state.highlights;
    state.nextHighlightId =
      typeof snapshot.nextHighlightId === 'number'
        ? snapshot.nextHighlightId
        : state.nextHighlightId;
    state.searchTerm =
      typeof snapshot.searchTerm === 'string' ? snapshot.searchTerm : state.searchTerm;
    state.isLiveLog = snapshot.isLiveLog === false ? false : state.isLiveLog;
    state.autoReconnectEnabled =
      snapshot.autoReconnectEnabled === false ? false : state.autoReconnectEnabled;
    state.connectionState = snapshot.connectionState || state.connectionState;
    state.maxEntries = Math.max(1, Number(snapshot.maxEntries) || state.maxEntries);
    state.statusText = snapshot.statusText || state.statusText;
    state.defaultConnectedStatus = snapshot.defaultConnectedStatus || state.defaultConnectedStatus;
    if (
      !state.defaultConnectedStatus &&
      typeof state.statusText === 'string' &&
      state.statusText.startsWith('Connected')
    ) {
      state.defaultConnectedStatus = state.statusText;
    }
    state.secondaryStatus = snapshot.secondaryStatus || null;
    state.autoSaveActive = snapshot.autoSaveActive === true;
    state.activeBookmarkId =
      typeof snapshot.activeBookmarkId === 'number' ? snapshot.activeBookmarkId : null;

    const restoredEntries = restoreEntries(snapshot.entries, state.maxEntries, helpers.parseLevel);
    state.entries = restoredEntries;
    entryIdCounter = restoredEntries.reduce((max, entry) => Math.max(max, entry.id || 0), -1) + 1;
    state.lineLimitReached =
      snapshot.lineLimitReached === true || state.entries.length >= state.maxEntries;

    helpers.setFormValues({
      minLevel: state.minLevel,
      textFilter: state.textFilter,
      searchTerm: state.searchTerm,
    });
    helpers.setToggles({
      wordWrap: state.wordWrapEnabled,
      autoScroll: state.autoScrollEnabled,
      autoReconnect: state.autoReconnectEnabled,
    });

    helpers.setHighlights(state.highlights);
    helpers.updatePresetDropdown();
    helpers.applyFilters();
    helpers.updateWordWrapClass();
    helpers.setLineLimitReached(state.lineLimitReached);
    helpers.setConnectionState(
      state.connectionState || (state.isLiveLog ? 'connecting' : 'disconnected')
    );
    helpers.updateStatus(state.statusText, { preserveSecondary: true });
    if (state.secondaryStatus?.source === 'autoSave') {
      helpers.setAutoSaveStatus(state.secondaryStatus.text, state.secondaryStatus.fileName);
    } else if (state.secondaryStatus?.text) {
      helpers.setSecondaryStatus(state.secondaryStatus.text);
    }
    if (state.autoSaveActive) {
      helpers.setAutoSaveActive(true);
    }
    isRestoringState = false;
  }

  /**
   * Returns the next entry identifier for log rendering.
   */
  function nextEntryId() {
    return entryIdCounter++;
  }

  /**
   * Resets the entry identifier counter (used when replacing all entries).
   */
  function resetEntryIds() {
    entryIdCounter = 0;
  }

  return {
    state,
    persistState,
    schedulePersist,
    restoreStateFromSnapshot,
    nextEntryId,
    resetEntryIds,
    get isRestoring() {
      return isRestoringState;
    },
  };
}
