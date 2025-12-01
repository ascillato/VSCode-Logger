(function () {
    const vscode = acquireVsCodeApi();

    const highlightPalette = [
        '#1abc9c',
        '#3498db',
        '#9b59b6',
        '#e74c3c',
        '#f1c40f',
        '#e67e22',
        '#2ecc71',
        '#16a085',
        '#d35400',
        '#8e44ad',
        '#5dade2',
        '#c0392b',
    ];

    const state = {
        devices: [],
        highlights: [],
        nextHighlightId: 1,
    };

    const deviceList = document.getElementById('deviceList');
    const highlightRows = document.getElementById('highlightRows');
    const status = document.getElementById('sidebarStatus');
    let colorCursor = Math.floor(Math.random() * highlightPalette.length);

    function hexToRgb(color) {
        const match = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
        if (!match) {
            return null;
        }
        return {
            r: parseInt(match[1], 16),
            g: parseInt(match[2], 16),
            b: parseInt(match[3], 16),
        };
    }

    function buildHighlightColors(baseColor) {
        const rgb = hexToRgb(baseColor);
        if (!rgb) {
            return { foreground: baseColor, background: 'rgba(0,0,0,0.28)' };
        }

        const relativeLuminance = (channel) => {
            const normalized = channel / 255;
            return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
        };

        const luminance =
            0.2126 * relativeLuminance(rgb.r) + 0.7152 * relativeLuminance(rgb.g) + 0.0722 * relativeLuminance(rgb.b);
        const lighten = luminance <= 0.55;
        const mixChannel = (channel) => {
            const mixed = lighten ? channel + (255 - channel) * 0.8 : channel * 0.35;
            return Math.round(Math.min(255, Math.max(0, mixed)));
        };
        const background = `rgba(${mixChannel(rgb.r)}, ${mixChannel(rgb.g)}, ${mixChannel(rgb.b)}, 0.65)`;

        return { foreground: baseColor, background };
    }

    function nextHighlightColor() {
        const color = highlightPalette[colorCursor % highlightPalette.length];
        colorCursor = (colorCursor + 1) % highlightPalette.length;
        if (colorCursor === 0) {
            highlightPalette.sort(() => Math.random() - 0.5);
        }
        return color;
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
        const color = nextHighlightColor();
        const { foreground, background } = buildHighlightColors(color);
        state.highlights.push({
            id: state.nextHighlightId++,
            key: '',
            baseColor: color,
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
