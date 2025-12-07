(function () {
    const vscode = acquireVsCodeApi();
    const statusText = document.getElementById('statusText');
    const connectionButton = document.getElementById('connectionButton');
    const autoReconnect = document.getElementById('autoReconnect');
    const terminalOutput = document.getElementById('terminalOutput');
    const consoleFrame = document.getElementById('consoleFrame');

    const state = {
        connectionState: 'disconnected',
        autoReconnect: true,
        statusText: '',
        statusVariant: 'default',
        nextAttemptAt: undefined,
        countdownInterval: undefined,
    };

    function postReady() {
        vscode.postMessage({ type: 'ready' });
    }

    function renderStatus() {
        const now = Date.now();
        const remaining =
            state.nextAttemptAt && state.connectionState === 'disconnected' && state.autoReconnect
                ? Math.ceil((state.nextAttemptAt - now) / 1000)
                : undefined;

        const suffix = remaining && remaining > 0 ? ` (reconnecting in ${remaining}s)` : '';
        statusText.textContent = `${state.statusText}${suffix}`;
        statusText.classList.toggle('status-closed', state.statusVariant === 'closed');
        statusText.classList.toggle('status-default', state.statusVariant !== 'closed');
    }

    function clearCountdown() {
        if (state.countdownInterval) {
            clearInterval(state.countdownInterval);
            state.countdownInterval = undefined;
        }
        state.nextAttemptAt = undefined;
        renderStatus();
    }

    function startCountdown(nextAttemptAt) {
        state.nextAttemptAt = nextAttemptAt;
        if (state.countdownInterval) {
            clearInterval(state.countdownInterval);
        }
        renderStatus();
        state.countdownInterval = setInterval(() => {
            if (!state.nextAttemptAt || state.connectionState !== 'disconnected' || !state.autoReconnect) {
                clearCountdown();
                return;
            }

            const remaining = Math.ceil((state.nextAttemptAt - Date.now()) / 1000);
            if (remaining <= 0) {
                clearCountdown();
            } else {
                renderStatus();
            }
        }, 500);
    }

    function setStatus(text, variant) {
        state.statusText = text || '';
        state.statusVariant = variant === 'closed' ? 'closed' : 'default';
        renderStatus();
    }

    function setState(connectionState) {
        state.connectionState = connectionState;
        if (connectionState !== 'disconnected') {
            clearCountdown();
        }
        consoleFrame.classList.remove('state-connected', 'state-connecting', 'state-disconnected');
        consoleFrame.classList.add(`state-${connectionState}`);
        connectionButton.textContent = connectionState === 'disconnected' ? 'Reconnect' : 'Disconnect';
    }

    function appendOutput(text) {
        terminalOutput.textContent += text;
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }

    function sendInput(text) {
        if (!text) {
            return;
        }
        vscode.postMessage({ type: 'input', text });
    }

    function handleKey(event) {
        if (state.connectionState !== 'connected') {
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            sendInput('\n');
            return;
        }

        if (event.key === 'Backspace') {
            event.preventDefault();
            sendInput('\u007f');
            return;
        }

        if (event.key === 'Tab') {
            event.preventDefault();
            sendInput('\t');
            return;
        }

        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            sendInput(event.key);
        }
    }

    function handlePaste(event) {
        if (state.connectionState !== 'connected') {
            return;
        }
        event.preventDefault();
        const text = event.clipboardData?.getData('text');
        if (text) {
            sendInput(text);
        }
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'init':
                state.autoReconnect = Boolean(message.autoReconnect);
                autoReconnect.checked = state.autoReconnect;
                setState(message.state || 'disconnected');
                break;
            case 'status':
                setStatus(message.text, message.variant);
                break;
            case 'data':
                appendOutput(message.data || '');
                break;
            case 'state':
                setState(message.state);
                break;
            case 'autoReconnectScheduled':
                if (typeof message.nextAttempt === 'number') {
                    startCountdown(message.nextAttempt);
                }
                break;
            case 'autoReconnectCancelled':
                clearCountdown();
                break;
        }
    });

    connectionButton.addEventListener('click', () => {
        if (state.connectionState === 'connected') {
            if (state.autoReconnect) {
                autoReconnect.checked = false;
                state.autoReconnect = false;
                vscode.postMessage({ type: 'setAutoReconnect', autoReconnect: false });
                clearCountdown();
            }
            vscode.postMessage({ type: 'disconnect' });
        } else {
            vscode.postMessage({ type: 'reconnect' });
        }
    });

    autoReconnect.addEventListener('change', () => {
        const value = autoReconnect.checked;
        state.autoReconnect = value;
        vscode.postMessage({ type: 'setAutoReconnect', autoReconnect: value });
        if (!value) {
            clearCountdown();
        }
    });

    terminalOutput.addEventListener('keydown', handleKey);
    terminalOutput.addEventListener('paste', handlePaste);
    consoleFrame.addEventListener('click', () => terminalOutput.focus());

    terminalOutput.focus();

    postReady();
})();
