# VSCode-Logger Architecture Overview

This document explains how the VSCode-Logger extension streams logs from embedded Linux devices into Visual Studio Code. It covers the activation lifecycle, major components, data flows between the extension host and the Webview, and key configuration or security considerations.

## Activation and configuration
- **Activation trigger**: The extension activates when VS Code loads the workspace or when a command/view contributed by the extension is invoked.
- **Configuration source**: Devices are defined under the `embeddedLogger.devices` setting. Each device entry supplies an `id`, `name`, `host`, optional `port`, `username`, optional `password` (migrated to secret storage), and optional `logCommand` to override the default `tail -F /var/log/syslog`.
- **Password migration**: During activation, legacy plaintext passwords from settings are migrated into VS Code Secret Storage so future connections prompt the user instead of persisting raw secrets in configuration.
- **Tree and command registration**: Activation registers the device tree view and the `embeddedLogger.openDevice` command so selecting a device item opens its log panel.

## Major components
- **`DeviceTreeDataProvider` (`src/deviceTree.ts`)**: Reads devices from configuration and renders them in the activity bar. Selecting an item fires `embeddedLogger.openDevice` with the associated device metadata.
- **Log panel (`src/logPanel.ts`)**: Creates a Webview panel per device, injects the HTML/JavaScript assets, and wires callbacks for presets, exports, and status updates. It owns a `LogSession` that streams data to the Webview.
- **`LogSession` (`src/logSession.ts`)**: Manages the SSH connection to the device, pulls credentials from secret storage or prompts the user, runs the log command, and forwards complete lines to the panel callbacks. It reports status changes and errors back to the Webview so the UI can react.
- **Webview client (`media/loggerPanel.js` + `media/loggerPanel.css`)**: Receives log lines, parses severity, applies filters, manages saved presets, and renders the terminal-like UI. It can request preset persistence, deletion, or log export from the extension host via `postMessage` events.

## Data and control flow
```mermaid
graph TD
    A[Extension activation] --> B[Read embeddedLogger.devices]
    B --> C[Build DeviceTreeDataProvider]
    C --> D[User selects device in activity bar]
    D --> E[Execute embeddedLogger.openDevice]
    E --> F[Create LogPanel with Webview]
    F --> G[Start LogSession (SSH to device)]
    G --> H[Fetch credentials from Secret Storage or prompt]
    H --> I[Run logCommand via ssh2]
    I --> J[Stream stdout/stderr data]
    J --> K[Parse lines and levels in loggerPanel.js]
    K --> L[Apply filters, presets, and formatting]
    L --> M[Render log entries and statuses in Webview]
    M -- Export request --> N[Extension saves visible lines to file]
    M -- Preset save/delete --> O[Extension persists workspace state]
    F -- Status updates --> M
```

> **Note:** Mermaid diagrams in this document are rendered by Sphinx using the embedded Mermaid runtime. See `docs/sphinx-docs.md` if diagrams are missing from your build.

## Lifecycle details
1. **Panel creation**: Each device opens in its own Webview panel. Existing panels re-activate instead of spawning duplicates when the same device is selected again.
2. **Session management**: `LogSession` tracks connection lifecycle events (connecting, streaming, disconnecting, error) and disposes of SSH resources when panels close or the extension deactivates.
3. **Back-pressure handling**: Incoming data is buffered until complete lines are available to avoid splitting log entries mid-line.
4. **Presets and filters**: Presets are stored per device in workspace state keyed by device ID so switching panels restores the relevant filter sets.
5. **Exports**: The Webview requests exports for only the currently visible (filtered) lines. The extension host asks the user for a destination path and writes the collected text.
6. **Configuration changes**: When `embeddedLogger.devices` changes, the tree view refreshes. Active panels continue streaming with their existing session until closed.
7. **Security**: Password prompts rely on VS Code’s secure input. Secrets are never written to the Webview or logs; they remain in secret storage or transient prompts. SSH sessions close on disposal to avoid leaving hanging connections.

## How to extend safely
- Keep UI logic inside the Webview scripts and backend logic in the extension host files.
- When adding device fields, update `EmbeddedDevice` and the contributed configuration schema so the tree view and Webview receive consistent data.
- If altering log parsing or styling, adjust both `loggerPanel.js` and `loggerPanel.css` to ensure new levels or formats render correctly.
- Preserve default behaviours (e.g., default log command, maximum retained lines) unless there is a clear reason to change them, and document new settings.

This overview is included in the Sphinx build (see `docs/_build/html/index.html` after running `sphinx-build -M html docs docs/_build`) to provide architectural context alongside the API references.
