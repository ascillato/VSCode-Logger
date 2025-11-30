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
        deviceId: initialData.deviceId,
        presets: initialData.presets || [],
        entries: [],
        filtered: [],
        minLevel: 'ALL',
        textFilter: '',
    };

    const minLevelSelect = document.getElementById('minLevel');
    const textFilterInput = document.getElementById('textFilter');
    const presetSelect = document.getElementById('presetSelect');
    const savePresetBtn = document.getElementById('savePreset');
    const deletePresetBtn = document.getElementById('deletePreset');
    const exportBtn = document.getElementById('exportLogs');
    const logContainer = document.getElementById('logContainer');
    const statusEl = document.getElementById('status');

    /**
     * @brief Extracts the log level from a raw log line.
     * @param line Log line emitted by the extension backend.
     * @returns Normalized log level string.
     */
    function parseLevel(line) {
        const match = line.match(/\[(DEBUG|INFO|NOTICE|WARN|WARNING|ERR|ERROR|CRIT|CRITICAL|ALERT|EMERG|FATAL)\]/i);
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
    function applyFilters() {
        const filterText = state.textFilter.toLowerCase();
        state.filtered = state.entries.filter((entry) => {
            const textMatches = filterText ? entry.rawLine.toLowerCase().includes(filterText) : true;
            return textMatches && levelPasses(entry.level);
        });
        render();
    }

    /**
     * @brief Renders the filtered entries into the log container.
     */
    function render() {
        const visible = state.filtered;
        logContainer.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (const entry of visible) {
            const div = document.createElement('div');
            div.textContent = entry.rawLine;
            div.className = `log-line level-${entry.level.toLowerCase()}`;
            frag.appendChild(div);
        }
        logContainer.appendChild(frag);
        logContainer.scrollTop = logContainer.scrollHeight;
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
    function handleLogLine(line) {
        const level = parseLevel(line);
        const entry = {
            timestamp: Date.now(),
            level,
            rawLine: line,
        };
        state.entries.push(entry);
        if (state.entries.length > 10000) {
            state.entries.shift();
        }
        if (levelPasses(level) && (!state.textFilter || line.toLowerCase().includes(state.textFilter.toLowerCase()))) {
            state.filtered.push(entry);
            if (state.filtered.length > 10000) {
                state.filtered.shift();
            }
            const div = document.createElement('div');
            div.textContent = entry.rawLine;
            div.className = `log-line level-${entry.level.toLowerCase()}`;
            logContainer.appendChild(div);
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    }

    /**
     * @brief Updates the status text shown in the UI.
     * @param text Status message to display.
     */
    function updateStatus(text) {
        statusEl.textContent = text || '';
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

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'logLine':
                handleLogLine(message.line);
                break;
            case 'initPresets':
            case 'presetsUpdated':
                state.presets = message.presets || [];
                updatePresetDropdown();
                break;
            case 'status':
                updateStatus(message.message);
                break;
            case 'error':
                updateStatus(message.message);
                break;
        }
    });

    // Initialize UI with presets from initialData
    state.presets = initialData.presets || [];
    updatePresetDropdown();
    applyFilters();
})();
