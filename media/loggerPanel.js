/**
 * @file loggerPanel.js
 * @brief Manages the Webview UI for displaying and filtering streamed logs.
 * @copyright Copyright (c) 2025 A. Scillato
 */

/**
 * @brief Initializes the logger panel UI and event wiring inside the Webview.
 */
(function () {
    const vscode = acquireVsCodeApi();

    const levelOrder = {
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

    const levelAliases = {
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
        searchTerm: '',
        searchMatches: [],
        searchIndex: -1,
        activeSearchEntry: -1,
        isLiveLog: true,
        autoReconnectEnabled: true,
        connectionState: 'unknown',
        maxEntries: 100000,
        statusText: '',
        autoSaveStatus: '',
        autoSaveActive: false,
    };

    const minLevelSelect = document.getElementById('minLevel');
    const textFilterInput = document.getElementById('textFilter');
    const presetSelect = document.getElementById('presetSelect');
    const savePresetBtn = document.getElementById('savePreset');
    const deletePresetBtn = document.getElementById('deletePreset');
    const exportBtn = document.getElementById('exportLogs');
    const clearLogsBtn = document.getElementById('clearLogs');
    const wordWrapToggle = document.getElementById('wordWrapToggle');
    const autoScrollToggle = document.getElementById('autoScrollToggle');
    const autoScrollContainer = document.getElementById('autoScrollContainer');
    const autoReconnectToggle = document.getElementById('autoReconnectToggle');
    const autoReconnectContainer = document.getElementById('autoReconnectContainer');
    const logContainer = document.getElementById('logContainer');
    const statusEl = document.getElementById('status');
    const reconnectButton = document.getElementById('reconnectButton');
    const searchInput = document.getElementById('searchInput');
    const searchClearBtn = document.getElementById('searchClear');
    const searchPrevBtn = document.getElementById('searchPrev');
    const searchNextBtn = document.getElementById('searchNext');
    const searchCount = document.getElementById('searchCount');
    const autoSaveToggle = document.getElementById('autoSaveToggle');

    let reconnectTimeoutId = null;
    let reconnectIntervalId = null;
    let reconnectCountdown = 0;
    const AUTO_SCROLL_BOTTOM_THRESHOLD = 4;

    /**
     * @brief Extracts the log level from a raw log line.
     * @param line Log line emitted by the extension backend.
     * @returns Normalized log level string.
     */
    function parseLevel(line) {
        const match = line.match(/\b(DEBUG|INFO|NOTICE|WARN|WARNING|ERR|ERROR|CRIT|CRITICAL|ALERT|EMERG|FATAL)\b/i);
        if (match && match[1]) {
            const key = match[1].toUpperCase();
            return levelAliases[key] || 'INFO';
        }
        return 'INFO';
    }

    /**
     * @brief Determines whether a log level passes the current filter threshold.
     * @param level Normalized log level to evaluate.
     * @returns True when the level is at or above the selected minimum.
     */
    function levelPasses(level) {
        const selected = state.minLevel || 'ALL';
        return levelOrder[level] >= levelOrder[selected];
    }

    /**
     * @brief Applies the active filters to all entries and re-renders the list.
     */
    function applyFilters(options = {}) {
        const preserveScrollPosition = options.preserveScrollPosition === true;
        const filterText = state.textFilter.toLowerCase();
        state.filtered = state.entries.filter((entry) => {
            const textMatches = filterText ? entry.rawLine.toLowerCase().includes(filterText) : true;
            return textMatches && levelPasses(entry.level);
        });
        render({ preserveScrollPosition });
        updateSearchMatches();
    }

    /**
     * @brief Returns active highlight entries with non-empty search keys.
     * @returns List of highlights to render.
     */
    function getActiveHighlights() {
        return state.highlights
            .filter((highlight) => highlight.normalizedKey)
            .map((highlight) => ({ ...highlight, normalizedKey: highlight.normalizedKey }));
    }

    /**
     * @brief Combines configured highlights with the current search term highlight.
     * @returns List of highlight descriptors to render.
     */
    function getHighlightDescriptors() {
        const highlights = getActiveHighlights();
        const searchTerm = state.searchTerm.trim().toLowerCase();

        if (searchTerm) {
            highlights.push({
                normalizedKey: searchTerm,
                className: 'search-highlight',
            });
        }

        return highlights;
    }

    /**
     * @brief Builds a DOM fragment with highlighted matches for a log line.
     * @param line The raw log line.
     * @returns Document fragment containing text nodes and highlighted spans.
     */
    function buildHighlightedContent(line, highlights) {
        const fragment = document.createDocumentFragment();

        if (!highlights.length) {
            fragment.appendChild(document.createTextNode(line));
            return fragment;
        }

        const lowerLine = line.toLowerCase();
        let index = 0;

        while (index < line.length) {
            let nextMatch = null;

            for (const highlight of highlights) {
                const matchIndex = lowerLine.indexOf(highlight.normalizedKey, index);
                if (matchIndex !== -1 && (nextMatch === null || matchIndex < nextMatch.position)) {
                    nextMatch = {
                        position: matchIndex,
                        end: matchIndex + highlight.normalizedKey.length,
                        highlight,
                    };
                }
            }

            if (!nextMatch) {
                fragment.appendChild(document.createTextNode(line.slice(index)));
                break;
            }

            if (nextMatch.position > index) {
                fragment.appendChild(document.createTextNode(line.slice(index, nextMatch.position)));
            }

            const span = document.createElement('span');
            span.textContent = line.slice(nextMatch.position, nextMatch.end);
            span.className = 'highlighted-text';
            if (nextMatch.highlight.className) {
                span.classList.add(nextMatch.highlight.className);
            }
            if (nextMatch.highlight.color) {
                span.style.color = nextMatch.highlight.color;
                span.style.borderColor = nextMatch.highlight.color;
            }
            if (nextMatch.highlight.backgroundColor) {
                span.style.backgroundColor = nextMatch.highlight.backgroundColor;
            }
            fragment.appendChild(span);

            index = nextMatch.end;
        }

        return fragment;
    }

    /**
     * @brief Replaces the highlight collection with updated entries.
     * @param highlights Highlight definitions received from the sidebar view.
     */
    function setHighlights(highlights) {
        state.highlights = (highlights || []).map((highlight) => ({
            ...highlight,
            normalizedKey: (highlight.key || '').trim().toLowerCase(),
        }));
        applyFilters({ preserveScrollPosition: true });
    }

    /**
     * @brief Renders the filtered entries into the log container.
     */
    function render(options = {}) {
        const preserveScrollPosition = options.preserveScrollPosition === true;
        const previousScrollTop = preserveScrollPosition ? logContainer.scrollTop : 0;
        const previousScrollHeight = preserveScrollPosition ? logContainer.scrollHeight : 0;
        const visible = state.filtered;
        const highlights = getHighlightDescriptors();
        state.activeSearchEntry = -1;
        logContainer.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (const entry of visible) {
            const div = document.createElement('div');
            div.className = `log-line level-${entry.level.toLowerCase()}`;
            div.appendChild(buildHighlightedContent(entry.rawLine, highlights));
            frag.appendChild(div);
        }
        logContainer.appendChild(frag);
        if (preserveScrollPosition) {
            const scrollDelta = logContainer.scrollHeight - previousScrollHeight;
            logContainer.scrollTop = Math.max(0, previousScrollTop + scrollDelta);
        } else if (state.searchIndex === -1 && state.autoScrollEnabled) {
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    }

    /**
     * @brief Populates the preset dropdown with available presets.
     */
    function updatePresetDropdown() {
        presetSelect.innerHTML = '';
        const base = document.createElement('option');
        base.value = '';
        base.textContent = '(no preset)';
        presetSelect.appendChild(base);
        state.presets.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            presetSelect.appendChild(opt);
        });
    }

    /**
     * @brief Applies a preset by name, synchronizing UI inputs.
     * @param name Preset identifier selected by the user.
     */
    function applyPreset(name) {
        const preset = state.presets.find((p) => p.name === name);
        if (!preset) {
            return;
        }
        state.minLevel = preset.minLevel;
        state.textFilter = preset.textFilter;
        minLevelSelect.value = state.minLevel;
        textFilterInput.value = state.textFilter;
        applyFilters();
    }

    /**
     * @brief Handles incoming log lines from the extension host.
     * @param line Raw log text to parse and display.
     */
    function handleLogLine(line, options = {}) {
        const level = parseLevel(line);
        const lowerLine = line.toLowerCase();
        const entry = {
            timestamp: Date.now(),
            level,
            rawLine: line,
        };
        state.entries.push(entry);
        if (state.entries.length > state.maxEntries) {
            state.entries.shift();
        }
        const searchTerm = state.searchTerm.trim().toLowerCase();
        if (levelPasses(level) && (!state.textFilter || lowerLine.includes(state.textFilter.toLowerCase()))) {
            state.filtered.push(entry);
            if (state.filtered.length > state.maxEntries) {
                state.filtered.shift();
                if (logContainer.firstChild) {
                    logContainer.removeChild(logContainer.firstChild);
                }
                state.searchMatches = state.searchMatches
                    .map((idx) => idx - 1)
                    .filter((idx) => idx >= 0);
                if (state.searchMatches.length === 0) {
                    state.searchIndex = -1;
                } else if (state.searchIndex >= state.searchMatches.length) {
                    state.searchIndex = state.searchMatches.length - 1;
                }
            }
            const highlights = getHighlightDescriptors();
            const div = document.createElement('div');
            const classes = [`log-line`, `level-${entry.level.toLowerCase()}`];
            if (options.className) {
                classes.push(options.className);
            }
            div.className = classes.join(' ');
            div.appendChild(buildHighlightedContent(entry.rawLine, highlights));
            logContainer.appendChild(div);
            if (searchTerm && lowerLine.includes(searchTerm)) {
                state.searchMatches.push(state.filtered.length - 1);
                if (state.searchIndex === -1) {
                    state.searchIndex = 0;
                }
            }
            if (state.searchIndex === -1 && state.autoScrollEnabled) {
                logContainer.scrollTop = logContainer.scrollHeight;
            } else if (state.searchIndex !== -1) {
                scrollToActiveMatch();
            }
            updateSearchStatus();
        }
    }

    /**
     * @brief Handles bulk log lines sent during offline file loading.
     * @param lines Collection of preloaded lines to add.
     */
    function handleInitialLogLines(lines) {
        if (!Array.isArray(lines) || !lines.length) {
            return;
        }

        const timestamp = Date.now();
        const newEntries = lines.map((line) => ({
            timestamp,
            level: parseLevel(line),
            rawLine: line,
        }));

        state.entries = state.entries.concat(newEntries);
        if (state.entries.length > state.maxEntries) {
            state.entries = state.entries.slice(-state.maxEntries);
        }

        applyFilters();
    }

    /**
     * @brief Clears all rendered and stored log entries while preserving filters.
     */
    function clearLogs() {
        state.entries = [];
        state.filtered = [];
        state.searchMatches = [];
        state.searchIndex = -1;
        state.activeSearchEntry = -1;
        render();
        updateSearchStatus();
    }

    /**
     * @brief Clears any active reconnect countdown timers.
     */
    function clearReconnectTimers() {
        if (reconnectTimeoutId) {
            clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = null;
        }
        if (reconnectIntervalId) {
            clearInterval(reconnectIntervalId);
            reconnectIntervalId = null;
        }
        reconnectCountdown = 0;
    }

    /**
     * @brief Updates the connection action button visibility and state.
     * @param options Additional options to control disabled behaviour.
     */
    function updateActionButton(options = {}) {
        if (!state.isLiveLog) {
            reconnectButton.hidden = true;
            return;
        }

        reconnectButton.hidden = false;
        reconnectButton.textContent = state.connectionState === 'connected' ? 'Disconnect' : 'Reconnect';

        const shouldDisable = options.preserveDisabled
            ? reconnectButton.disabled
            : options.disableButton ?? state.connectionState === 'connecting';
        reconnectButton.disabled = shouldDisable;
    }

    /**
     * @brief Updates the tracked connection state.
     * @param connectionState New connection state string.
     */
    function setConnectionState(connectionState) {
        state.connectionState = connectionState;
        if (connectionState === 'connected') {
            clearReconnectTimers();
        }
        updateActionButton();
        updateConnectionDecorations();
    }

    /**
     * @brief Updates the status text shown in the UI.
     * @param text Status message to display.
     */
    function updateStatus(text, options = {}) {
        state.statusText = text || '';
        renderStatusText();
        updateActionButton(options);
    }

    /**
     * @brief Updates the status element by combining connection and auto-save messages.
     */
    function renderStatusText() {
        const parts = [];
        if (state.statusText) {
            parts.push(state.statusText);
        }
        if (state.autoSaveStatus) {
            parts.push(state.autoSaveStatus);
        }
        statusEl.textContent = parts.join('\n');
    }

    /**
     * @brief Updates the auto-save status message and re-renders the status text.
     * @param text Additional auto-save status message to display.
     */
    function setAutoSaveStatus(text) {
        state.autoSaveStatus = text || '';
        renderStatusText();
    }

    /**
     * @brief Updates the UI to reflect whether auto-save is active.
     * @param active True when auto-save is currently writing to disk.
     */
    function setAutoSaveActive(active) {
        state.autoSaveActive = active;
        if (autoSaveToggle) {
            autoSaveToggle.textContent = active ? 'Stop Auto-Save' : 'Auto-Save';
            autoSaveToggle.disabled = false;
            autoSaveToggle.classList.toggle('auto-save-active', active);
        }
    }

    /**
     * @brief Adds or removes connection-state driven styling.
     */
    function updateConnectionDecorations() {
        const isConnected = state.isLiveLog && state.connectionState === 'connected';
        const isDisconnected = state.isLiveLog && state.connectionState === 'disconnected';
        const isReconnecting = state.isLiveLog && state.connectionState === 'connecting';

        logContainer.classList.toggle('connected', isConnected);
        logContainer.classList.toggle('disconnected', isDisconnected);
        logContainer.classList.toggle('reconnecting', isReconnecting);
    }

    /**
     * @brief Starts a countdown and triggers a reconnect request after it elapses.
     * @param baseMessage Message to prefix the countdown with.
     */
    function startReconnectCountdown(baseMessage = 'Connection closed.') {
        if (!state.isLiveLog || !state.autoReconnectEnabled || reconnectTimeoutId) {
            updateStatus(baseMessage, { disableButton: false });
            return;
        }

        reconnectCountdown = 5;
        const renderCountdown = () => `${baseMessage} Retrying in ${reconnectCountdown} seconds...`;
        updateStatus(renderCountdown(), { disableButton: false });
        reconnectIntervalId = window.setInterval(() => {
            reconnectCountdown -= 1;
            if (reconnectCountdown > 0) {
                updateStatus(renderCountdown(), { disableButton: false });
            }
        }, 1000);

        reconnectTimeoutId = window.setTimeout(() => {
            clearReconnectTimers();
            setConnectionState('connecting');
            updateStatus('Reconnecting...', { disableButton: true });
            vscode.postMessage({ type: 'requestReconnect' });
        }, 5000);
    }

    /**
     * @brief Handles connection losses by updating status and scheduling reconnects.
     * @param message Status message provided by the extension host.
     */
    function handleConnectionLoss(message) {
        setConnectionState('disconnected');
        clearReconnectTimers();
        if (state.autoReconnectEnabled && state.isLiveLog) {
            startReconnectCountdown(message || 'Connection closed.');
            return;
        }

        updateStatus(message || 'Connection closed.', { disableButton: false });
    }

    /**
     * @brief Handles session closed notifications by updating status and appending a marker line.
     * @param message Status message provided by the extension host.
     * @param closedAt Timestamp value (string or number) to display in the marker line.
     */
    function handleSessionClosed(message, closedAt) {
        const formattedTimestamp = formatLocalTimestamp(closedAt);
        handleConnectionLoss(message || 'Session closed.');
        handleLogLine('', { className: 'session-closed-buffer' });
        handleLogLine(`--- SSH session closed on ${formattedTimestamp}`, { className: 'session-closed' });
        handleLogLine('', { className: 'session-closed-buffer' });
    }

    /**
     * @brief Formats a timestamp into a local ISO-like string without timezone conversion.
     * @param value A timestamp value compatible with the Date constructor.
     * @returns {string} Formatted timestamp like `2025-12-01 at 22:42:29`.
     */
    function formatLocalTimestamp(value) {
        const timestamp = value ? new Date(value) : new Date();
        const safeTimestamp = Number.isNaN(timestamp.valueOf()) ? new Date() : timestamp;
        const pad = (num) => String(num).padStart(2, '0');
        const datePart = `${safeTimestamp.getFullYear()}-${pad(safeTimestamp.getMonth() + 1)}-${pad(safeTimestamp.getDate())}`;
        const timePart = `${pad(safeTimestamp.getHours())}:${pad(safeTimestamp.getMinutes())}:${pad(safeTimestamp.getSeconds())}`;
        return `${datePart} at ${timePart}`;
    }

    /**
     * @brief Interprets status messages from the extension host.
     * @param text Status message to display.
     */
    function handleStatusMessage(text) {
        if (!text) {
            updateStatus('');
            return;
        }

        if (text.startsWith('Connected')) {
            setConnectionState('connected');
            updateStatus(text, { disableButton: false });
            return;
        }

        if (text.startsWith('Connecting') || text.startsWith('Reconnecting')) {
            setConnectionState('connecting');
            updateStatus(text, { disableButton: true });
            return;
        }

        if (text.startsWith('Connection closed')) {
            handleConnectionLoss('Connection closed.');
            return;
        }

        updateStatus(text);
    }

    /**
     * @brief Syncs the log container with the current word wrap setting.
     */
    function updateWordWrapClass() {
        logContainer.classList.toggle('wrap-enabled', state.wordWrapEnabled);
    }

    /**
     * @brief Updates auto scroll state and keeps the toggle in sync.
     * @param enabled Whether auto scroll should be enabled.
     */
    function setAutoScrollEnabled(enabled) {
        if (state.autoScrollEnabled === enabled) {
            return;
        }

        state.autoScrollEnabled = enabled;
        autoScrollToggle.checked = enabled;
    }

    /**
     * @brief Determines whether the log container is scrolled to the bottom.
     * @returns True when the scroll position is within a threshold of the bottom.
     */
    function isAtLogBottom() {
        const distanceFromBottom = logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight;
        return distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
    }

    /**
     * @brief Updates the search status label and button states.
     */
    function updateSearchStatus() {
        if (!state.searchMatches.length) {
            searchCount.textContent = '0 / 0';
            searchPrevBtn.disabled = true;
            searchNextBtn.disabled = true;
            return;
        }

        searchPrevBtn.disabled = false;
        searchNextBtn.disabled = false;
        searchCount.textContent = `${state.searchIndex + 1} / ${state.searchMatches.length}`;
    }

    /**
     * @brief Enables or disables the clear button based on input content.
     */
    function updateSearchClearButton() {
        if (!searchClearBtn) {
            return;
        }

        searchClearBtn.disabled = !searchInput.value.trim();
    }

    /**
     * @brief Removes the active search line styling, if present.
     */
    function clearActiveSearchLine() {
        if (state.activeSearchEntry !== -1) {
            const prev = logContainer.children[state.activeSearchEntry];
            if (prev) {
                prev.classList.remove('active-search-line');
            }
        }
        state.activeSearchEntry = -1;
    }

    /**
     * @brief Scrolls to and highlights the currently selected search match.
     */
    function scrollToActiveMatch() {
        if (state.searchIndex === -1 || !state.searchMatches.length) {
            clearActiveSearchLine();
            updateSearchStatus();
            return;
        }

        const entryIndex = state.searchMatches[state.searchIndex];
        const node = logContainer.children[entryIndex];
        if (!node) {
            clearActiveSearchLine();
            updateSearchStatus();
            return;
        }

        clearActiveSearchLine();
        state.activeSearchEntry = entryIndex;
        node.classList.add('active-search-line');
        node.scrollIntoView({ block: 'center' });
        updateSearchStatus();
    }

    /**
     * @brief Recomputes search matches based on the current filtered list.
     */
    function updateSearchMatches() {
        const term = state.searchTerm.trim().toLowerCase();
        state.searchMatches = [];

        if (!term) {
            state.searchIndex = -1;
            clearActiveSearchLine();
            updateSearchStatus();
            updateSearchClearButton();
            return;
        }

        state.filtered.forEach((entry, idx) => {
            if (entry.rawLine.toLowerCase().includes(term)) {
                state.searchMatches.push(idx);
            }
        });

        if (!state.searchMatches.length) {
            state.searchIndex = -1;
            clearActiveSearchLine();
            updateSearchStatus();
            updateSearchClearButton();
            return;
        }

        if (state.searchIndex === -1 || state.searchIndex >= state.searchMatches.length) {
            state.searchIndex = 0;
        }

        scrollToActiveMatch();
        updateSearchClearButton();
    }

    /**
     * @brief Navigates between search results by the provided offset.
     * @param delta Direction and magnitude to move within search matches.
     */
    function stepSearch(delta) {
        if (!state.searchMatches.length) {
            return;
        }

        if (state.searchIndex === -1) {
            state.searchIndex = 0;
        }

        state.searchIndex = (state.searchIndex + delta + state.searchMatches.length) % state.searchMatches.length;
        scrollToActiveMatch();
    }

    /**
     * @brief Debounces rapid calls to a function to limit execution.
     * @param fn Function to debounce.
     * @param delay Delay in milliseconds.
     * @returns Wrapped function enforcing the debounce period.
     */
    function debounce(fn, delay) {
        let handle;
        return function (...args) {
            clearTimeout(handle);
            handle = setTimeout(() => fn.apply(null, args), delay);
        };
    }

    // Event wiring
    minLevelSelect.value = state.minLevel;

    minLevelSelect.addEventListener('change', () => {
        state.minLevel = minLevelSelect.value;
        applyFilters();
    });

    textFilterInput.addEventListener(
        'input',
        debounce(() => {
            state.textFilter = textFilterInput.value;
            applyFilters();
        }, 150)
    );

    presetSelect.addEventListener('change', () => {
        const value = presetSelect.value;
        if (value) {
            applyPreset(value);
        } else {
            state.minLevel = minLevelSelect.value;
            state.textFilter = textFilterInput.value;
            applyFilters();
        }
    });

    savePresetBtn.addEventListener('click', () => {
        vscode.postMessage({
            type: 'requestSavePreset',
            deviceId: state.deviceId,
            minLevel: minLevelSelect.value,
            textFilter: textFilterInput.value,
        });
    });

    deletePresetBtn.addEventListener('click', () => {
        const value = presetSelect.value;
        if (!value) {
            return;
        }
        vscode.postMessage({ type: 'deletePreset', deviceId: state.deviceId, name: value });
    });

    exportBtn.addEventListener('click', () => {
        const lines = state.filtered.map((e) => e.rawLine);
        vscode.postMessage({ type: 'exportLogs', deviceId: state.deviceId, lines });
    });

    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', clearLogs);
    }

    wordWrapToggle.addEventListener('change', () => {
        state.wordWrapEnabled = wordWrapToggle.checked;
        updateWordWrapClass();
    });

    autoScrollToggle.addEventListener('change', () => {
        setAutoScrollEnabled(autoScrollToggle.checked);
        if (state.autoScrollEnabled && state.searchIndex === -1) {
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    });

    autoReconnectToggle.addEventListener('change', () => {
        state.autoReconnectEnabled = autoReconnectToggle.checked;
        if (!state.autoReconnectEnabled) {
            clearReconnectTimers();
        } else if (state.connectionState === 'disconnected') {
            startReconnectCountdown('Connection closed.');
        }
    });

    logContainer.addEventListener('scroll', () => {
        if (!state.isLiveLog) {
            return;
        }

        const atBottom = isAtLogBottom();

        if (state.autoScrollEnabled && !atBottom) {
            setAutoScrollEnabled(false);
            return;
        }

        if (!state.autoScrollEnabled && atBottom) {
            setAutoScrollEnabled(true);
            if (state.searchIndex === -1) {
                logContainer.scrollTop = logContainer.scrollHeight;
            }
        }
    });

    reconnectButton.addEventListener('click', () => {
        clearReconnectTimers();
        if (state.connectionState === 'connected') {
            state.autoReconnectEnabled = false;
            if (autoReconnectToggle) {
                autoReconnectToggle.checked = false;
            }
            setConnectionState('connecting');
            updateStatus('Disconnecting...', { disableButton: true });
            vscode.postMessage({ type: 'requestDisconnect' });
            return;
        }

        setConnectionState('connecting');
        updateStatus('Reconnecting...', { disableButton: true, preserveDisabled: true });
        vscode.postMessage({ type: 'requestReconnect' });
    });

    searchInput.addEventListener(
        'input',
        debounce(() => {
            state.searchTerm = searchInput.value;
            render();
            updateSearchMatches();
        }, 150)
    );

    searchInput.addEventListener('input', updateSearchClearButton);

    searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            stepSearch(event.shiftKey ? -1 : 1);
        }
    });

    searchPrevBtn.addEventListener('click', () => stepSearch(-1));
    searchNextBtn.addEventListener('click', () => stepSearch(1));

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            if (!searchInput.value) {
                return;
            }

            searchInput.value = '';
            state.searchTerm = '';
            render();
            updateSearchMatches();
            updateSearchClearButton();
            searchInput.focus();
        });
    }

    if (autoSaveToggle) {
        autoSaveToggle.addEventListener('click', () => {
            autoSaveToggle.disabled = true;
            if (state.autoSaveActive) {
                vscode.postMessage({ type: 'stopAutoSave' });
            } else {
                vscode.postMessage({ type: 'startAutoSave' });
            }
        });
    }

    window.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    });

    updateSearchClearButton();

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'initData':
                state.deviceId = message.deviceId;
                state.presets = message.presets || [];
                state.isLiveLog = message.isLive !== false;
                state.maxEntries = Math.max(1, Number(message.maxEntries) || state.maxEntries);
                setConnectionState(state.isLiveLog ? 'connecting' : 'disconnected');
                setHighlights(message.highlights || []);
                if (!state.isLiveLog && autoScrollContainer) {
                    autoScrollContainer.classList.add('hidden');
                }
                if (!state.isLiveLog && autoReconnectContainer) {
                    autoReconnectContainer.classList.add('hidden');
                }
                if (clearLogsBtn) {
                    clearLogsBtn.classList.toggle('hidden', !state.isLiveLog);
                }
                if (autoSaveToggle) {
                    autoSaveToggle.classList.toggle('hidden', !state.isLiveLog);
                    autoSaveToggle.disabled = !state.isLiveLog;
                }
                autoScrollToggle.checked = state.autoScrollEnabled;
                autoReconnectToggle.checked = state.autoReconnectEnabled;
                updatePresetDropdown();
                applyFilters();
                break;
            case 'initialLines':
                handleInitialLogLines(message.lines);
                break;
            case 'logLine':
                handleLogLine(message.line);
                break;
            case 'initPresets':
            case 'presetsUpdated':
                state.presets = message.presets || [];
                updatePresetDropdown();
                break;
            case 'status':
                handleStatusMessage(message.message);
                break;
            case 'error':
                updateStatus(message.message);
                break;
            case 'sessionClosed':
                handleSessionClosed(message.message, message.closedAt);
                break;
            case 'highlightsUpdated':
                setHighlights(message.highlights || []);
                break;
            case 'autoSaveStarted':
                setAutoSaveActive(true);
                setAutoSaveStatus(message.fileName ? `Auto-saving to ${message.fileName}` : 'Auto-save enabled.');
                break;
            case 'autoSaveStopped':
                setAutoSaveActive(false);
                setAutoSaveStatus(message.message || '');
                break;
            case 'autoSaveError':
                setAutoSaveActive(false);
                setAutoSaveStatus(message.message || 'Auto-save failed.');
                break;
        }
    });

    vscode.postMessage({ type: 'ready' });

    updatePresetDropdown();
    updateWordWrapClass();
    applyFilters();
})();
