/**
 * Handles postMessage traffic between the log panel Webview and the extension host.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 */

/**
 * Registers handlers that react to messages from the extension host.
 */
export function registerMessageHandlers({
  state,
  elements,
  handlers,
  setToggleState,
  isDefaultLogCommandMessage,
}) {
  /**
   * Applies incoming messages to local state and UI elements.
   */
  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'initData': {
        state.deviceId = message.deviceId;
        state.presets = message.presets || [];
        state.isLiveLog = message.isLive !== false;
        state.maxEntries = Math.max(1, Number(message.maxEntries) || state.maxEntries);
        handlers.setLineLimitReached(state.lineLimitReached);
        if (state.entries.length > state.maxEntries) {
          state.entries = state.entries.slice(-state.maxEntries);
          handlers.setLineLimitReached(true);
        }
        const initialConnectionState =
          state.connectionState === 'unknown'
            ? state.isLiveLog
              ? 'connecting'
              : 'disconnected'
            : state.connectionState;
        handlers.setConnectionState(initialConnectionState);
        handlers.setHighlights(message.highlights || []);
        if (!state.isLiveLog && elements.autoScrollContainer) {
          elements.autoScrollContainer.classList.add('hidden');
        }
        if (!state.isLiveLog && elements.autoReconnectContainer) {
          elements.autoReconnectContainer.classList.add('hidden');
        }
        const hideLiveOnlyControl = !state.isLiveLog;
        if (elements.clearLogsBtn) {
          elements.clearLogsBtn.classList.toggle('hidden', hideLiveOnlyControl);
        }
        if (elements.clearLogsContainer) {
          elements.clearLogsContainer.classList.toggle('hidden', hideLiveOnlyControl);
        }
        const showImportedControls = !state.isLiveLog;
        if (elements.editContainer) {
          elements.editContainer.classList.toggle('hidden', !showImportedControls);
        }
        if (elements.refreshContainer) {
          elements.refreshContainer.classList.toggle('hidden', !showImportedControls);
        }
        if (elements.editBtn) {
          elements.editBtn.classList.toggle('hidden', !showImportedControls);
        }
        if (elements.refreshBtn) {
          elements.refreshBtn.classList.toggle('hidden', !showImportedControls);
        }
        if (elements.autoSaveToggle) {
          elements.autoSaveToggle.classList.toggle('hidden', hideLiveOnlyControl);
          elements.autoSaveToggle.disabled = !state.isLiveLog;
        }
        if (elements.autoSaveContainer) {
          elements.autoSaveContainer.classList.toggle('hidden', hideLiveOnlyControl);
        }
        if (!state.isLiveLog && elements.reconnectButton) {
          elements.reconnectButton.hidden = true;
          elements.reconnectButton.disabled = true;
          elements.reconnectButton.classList.add('hidden');
        }
        setToggleState(elements.autoScrollToggle, state.autoScrollEnabled);
        setToggleState(elements.autoReconnectToggle, state.autoReconnectEnabled);
        handlers.updatePresetDropdown();
        handlers.applyFilters();
        break;
      }
      case 'initialLines':
        handlers.handleInitialLogLines(message.lines);
        break;
      case 'logLine':
        handlers.handleLogLine(message.line);
        break;
      case 'initPresets':
      case 'presetsUpdated':
        state.presets = message.presets || [];
        handlers.updatePresetDropdown();
        break;
      case 'replaceLines':
        handlers.clearLogs();
        handlers.handleInitialLogLines(message.lines || []);
        if (message.message) {
          handlers.updateStatus(message.message, { preserveSecondary: true });
        }
        break;
      case 'status':
        handlers.handleStatusMessage(message.message);
        break;
      case 'error':
        if (isDefaultLogCommandMessage(message.message)) {
          handlers.setSecondaryStatus(message.message);
        } else if (state.isLiveLog && state.connectionState === 'connecting') {
          handlers.handleConnectionLoss(message.message);
        } else {
          handlers.updateStatus(message.message);
        }
        break;
      case 'hostKeyMismatch':
        handlers.handleHostKeyMismatch(message.expected, message.received);
        break;
      case 'sessionClosed':
        handlers.handleSessionClosed(message.message, message.closedAt);
        break;
      case 'highlightsUpdated':
        handlers.setHighlights(message.highlights || []);
        break;
      case 'autoSaveStarted':
        handlers.setAutoSaveActive(true);
        if (message.fileName) {
          handlers.setAutoSaveStatus('Auto-saving to', message.fileName);
        } else {
          handlers.setAutoSaveStatus('Auto-save enabled.');
        }
        break;
      case 'autoSaveStopped':
        handlers.setAutoSaveActive(false);
        handlers.setAutoSaveStatus(message.message || '');
        break;
      case 'autoSaveError':
        handlers.setAutoSaveActive(false);
        handlers.setAutoSaveStatus(message.message || 'Auto-save failed.');
        break;
    }
  });
}
