(function () {
    const vscode = acquireVsCodeApi();

    const highlightPalette = [
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

    const state = {
        devices: [],
        highlights: [],
        nextHighlightId: 1,
    };

    const deviceList = document.getElementById('deviceList');
    const highlightRows = document.getElementById('highlightRows');
    const status = document.getElementById('sidebarStatus');
    let colorCursor = 0;

    function nextHighlightColor() {
        const pair = highlightPalette[colorCursor % highlightPalette.length];
        colorCursor = (colorCursor + 1) % highlightPalette.length;
        return pair;
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
            const card = document.createElement('button');
            card.className = 'device-card';
            card.addEventListener('click', () => {
                vscode.postMessage({ type: 'openDevice', deviceId: device.id });
            });

            const info = document.createElement('div');
            info.className = 'device-info';

            const title = document.createElement('span');
            title.className = 'title';
            title.textContent = device.name;
            info.appendChild(title);

            const subtitle = document.createElement('span');
            subtitle.className = 'subtitle';
            subtitle.textContent = `${device.host}${device.port ? `:${device.port}` : ''}`;
            info.appendChild(subtitle);

            card.appendChild(info);

            fragment.appendChild(card);
        });

        deviceList.appendChild(fragment);
    }

    function pushHighlightChanges() {
        vscode.postMessage({ type: 'highlightsChanged', highlights: state.highlights });
    }

    function renderHighlightRows() {
        highlightRows.innerHTML = '';
        const frag = document.createDocumentFragment();
        state.highlights.forEach((highlight) => {
            const row = document.createElement('div');
            row.className = 'highlight-row';

            const swatch = document.createElement('span');
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = highlight.baseColor;
            swatch.style.borderColor = highlight.baseColor;
            row.appendChild(swatch);

            const input = document.createElement('input');
            input.type = 'text';
            input.value = highlight.key;
            input.placeholder = 'Key to highlight';
            input.className = 'highlight-input';
            input.addEventListener('input', () => {
                highlight.key = input.value;
                pushHighlightChanges();
            });
            row.appendChild(input);

            const remove = document.createElement('button');
            remove.className = 'highlight-remove';
            remove.textContent = '✕';
            remove.title = 'Remove highlight';
            remove.addEventListener('click', () => {
                state.highlights = state.highlights.filter((item) => item.id !== highlight.id);
                renderHighlightRows();
                pushHighlightChanges();
            });
            row.appendChild(remove);

            frag.appendChild(row);
        });
        highlightRows.appendChild(frag);
    }

    function addHighlight() {
        if (state.highlights.length >= 10) {
            status.textContent = 'You can highlight up to 10 keys.';
            return;
        }
        const { foreground, background } = nextHighlightColor();
        state.highlights.push({
            id: state.nextHighlightId++,
            key: '',
            baseColor: foreground,
            color: foreground,
            backgroundColor: background,
        });
        renderHighlightRows();
        pushHighlightChanges();
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
            case 'applyHighlights':
                state.highlights = (message.highlights || []).map((h) => ({ ...h }));
                state.nextHighlightId = state.highlights.reduce((max, h) => Math.max(max, h.id), 0) + 1;
                renderHighlightRows();
                break;
            case 'addHighlightRow':
                addHighlight();
                break;
        }
    });

    vscode.postMessage({ type: 'requestFocus' });
})();
