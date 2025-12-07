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
    };

    function postReady() {
        vscode.postMessage({ type: 'ready' });
    }

    function setStatus(text, variant) {
        statusText.textContent = text || '';
        statusText.classList.toggle('status-closed', variant === 'closed');
        statusText.classList.toggle('status-default', variant !== 'closed');
    }

    function setState(connectionState) {
        state.connectionState = connectionState;
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
                // no-op placeholder for future indicator
                break;
        }
    });

    connectionButton.addEventListener('click', () => {
        if (state.connectionState === 'connected') {
            vscode.postMessage({ type: 'disconnect' });
        } else {
            vscode.postMessage({ type: 'reconnect' });
        }
    });

    autoReconnect.addEventListener('change', () => {
        const value = autoReconnect.checked;
        state.autoReconnect = value;
        vscode.postMessage({ type: 'setAutoReconnect', autoReconnect: value });
    });

    terminalOutput.addEventListener('keydown', handleKey);
    terminalOutput.addEventListener('paste', handlePaste);
    consoleFrame.addEventListener('click', () => terminalOutput.focus());

    terminalOutput.focus();

    postReady();
})();
