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
        minLevel: 'INFO',
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

    function parseLevel(line) {
        const match = line.match(/\[(DEBUG|INFO|NOTICE|WARN|WARNING|ERR|ERROR|CRIT|CRITICAL|ALERT|EMERG|FATAL)\]/i);
        if (match && match[1]) {
            const key = match[1].toUpperCase();
            return levelAliases[key] || 'INFO';
        }
        return 'INFO';
    }

    function levelPasses(level) {
        const selected = state.minLevel || 'ALL';
        return levelOrder[level] >= levelOrder[selected];
    }

    function applyFilters() {
        const filterText = state.textFilter.toLowerCase();
        state.filtered = state.entries.filter((entry) => {
            const textMatches = filterText ? entry.rawLine.toLowerCase().includes(filterText) : true;
            return textMatches && levelPasses(entry.level);
        });
        render();
    }

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

    function updateStatus(text) {
        statusEl.textContent = text || '';
    }

    function debounce(fn, delay) {
        let handle;
        return function (...args) {
            clearTimeout(handle);
            handle = setTimeout(() => fn.apply(null, args), delay);
        };
    }

    // Event wiring
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
