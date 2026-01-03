# Architecture Overview

VSCode‑Logger is a Visual Studio Code extension designed to stream logs
from embedded Linux devices over SSH, providing filtering, highlighting,
bookmarking, search, and optional SSH command execution.

This codebase overview is made in terms of architecture,
maintainability, security, performance, UI implementation and security.
It is about the extension host code (TypeScript), Webview
clients (JavaScript/CSS).

------------------------------------------------------------------------

## Design Principles

This project was design from the start taking into account as principles the following aspects:

- **Documentation and configuration**
- **Security‑conscious design**
- **Modular architecture**
- **Robust asynchronous logic**
- **User experience considerations**
- **Testing practice**
- **Linting, type-checking, formatting and spelling**
- **Extensibility and configuration**

### Strengths

-   **Clear modular structure**: Components such as `logSession` (split
    into authentication, host‑key verification, connection
    orchestration, and reconnection helpers), the `logPanel` host
    (split into lifecycle, HTML composition, messaging and persistence
    helpers), `sshCommandRunner`, `sshTerminal`, and the device
    tree/side panel are well separated.
-   **Good use of VS Code APIs**: Webview messaging, pseudoterminals,
    secrets API, configuration API, etc.
-   **Consistent TypeScript typings** across modules.
-   **Clear trust and validation gates**: Both the log streamer and
    command runner refuse to connect when the workspace is untrusted and
    validate device host/username/port before running any SSH action.
-   **Secret handling**: Passwords and passphrases are pulled from VS
    Code Secret Storage with prompts and reuse confirmation, avoiding
    persistence in settings or Webviews.
-   **Connection hygiene**: Log streaming uses host key verification with
    SHA-256 fingerprints, captures fingerprints back into settings when
    missing, and disposes SSH clients on closure to avoid leaking
    resources.
-   **Webview safety**: Log rendering uses text nodes and a nonce-backed
    CSP, preventing HTML injection even when log lines contain markup.
-   **User-centric defaults**: Configuration helpers apply defaults for
    ports, log commands, SSH terminal enablement, and shared commands
    consistently across devices.

------------------------------------------------------------------------

## Performance Overview

### Strengths

-   Efficient incremental rendering of logs.
-   Avoids expensive DOM operations by batching messages.

------------------------------------------------------------------------

## Maintainability Overview

### Strengths

-   Good organization and naming conventions.
-   Clear TypeDoc comments on most functions.

------------------------------------------------------------------------

## UI/UX Overview

### Strengths

-   Clean interface.
-   Highlight palette and bookmarks improve usability.
-   Responsive layout.

------------------------------------------------------------------------

## Security Overview

The **VSCode‑Logger** extension streams logs from remote embedded devices via SSH. It provides a webview panel for real‑time log viewing, filtering and highlighting, and exposes commands to run one‑off SSH commands or open an interactive terminal. Because it handles credentials and executes remote commands, security is critical.

### Strengths
* **Workspace trust enforcement and SSH safety**: Workspace trust gating prevents connections in untrusted workspaces before prompting for credentials. Workspace trust enforcement and device validation guard all SSH operations. SSH commands are sanitized to avoid injection risks, and the log command is trimmed and checked for control characters to avoid obvious injection via newlines.
* **Secure credential storage**: Secrets are stored in VS Code Secret Storage after prompting users, keeping interactive credentials off disk by default. The extension uses the **VS Code Secrets API** for storing passwords and passphrases securely. Secrets are scoped per workspace with metadata prompts before reuse, reducing accidental credential leakage.
* **Webview security and XSS prevention**: Webview UIs render log lines using `textContent` rather than `innerHTML`. Log lines are inserted as text nodes, preventing HTML injection from streamed content. Webview CSPs block external scripts and restrict styles to bundled extension assets. A restrictive Content-Security-Policy disallows remote scripts and limits styles to extension resources, reducing XSS risk.
* **Connection robustness**: Auto-reconnect logic includes visible status updates and timers.
* **SSH integrity and tunnelling**: Log streaming uses host key verification with captured fingerprints, and bastion tunnelling preserves fingerprint checks when present.

### Workspace trust and configuration validation

* **Workspace trust gating.** Both the one‑off command runner and the log session check `vscode.workspace.isTrusted` before connecting or executing commands. This ensures that the extension only performs SSH operations in trusted workspaces.
* **Device configuration validation.** The command runner and log session validate the device’s `host`, `username` and `port` before attempting a connection. Invalid entries result in descriptive errors.
* **Sanitization of newlines.** `sanitizeCommand` disallows control characters or newlines in user‑supplied commands, and the log session’s `getLogCommand` does the same. This prevents multi‑line payloads that could lead to injection attacks.

### Secure SSH handling

* **Host‑key verification and fingerprint capture.** When establishing an SSH connection, the session uses `hostHash: 'sha256'` and a `hostVerifier` that computes the server’s fingerprint and compares it against the stored fingerprint. If the fingerprint does not match, the session throws a `HostKeyMismatchError` and prompts the user to update or reject the new fingerprint. Unknown fingerprints can be persisted only after user confirmation.
* **Authentication management.** Passwords, passphrases and private keys are retrieved from a secure secret store. `PasswordManager` stores secrets using a key derived from the hashed device host and username and the workspace ID. Secrets are not persisted in code or configuration, and metadata is stored separately to support reuse across workspaces. If a secret is reused from another workspace or a legacy key, the manager prompts the user for confirmation.
* **Session lifecycle management.** The log session disposes SSH resources in a `dispose()` method and ensures that stream closures trigger UI notifications. Auto‑save streams are closed gracefully and error conditions are propagated back to the UI.

### Webview security

* **Content‑Security‑Policy (CSP).** The webviews for both the log panel and sidebar set a strict CSP: `default-src 'none'`, `script-src 'nonce‑…'` and `style-src` limited to the extension’s own origin. No external scripts or inline scripts are allowed. The script tag includes a random nonce generated with `getNonce()` to prevent injection attacks.
* **Safe HTML rendering.** Log lines and user‑supplied highlight keys are inserted into the DOM using `createTextNode` or by setting `textContent`. Highlight markers are built by splitting text and wrapping matches in `<span>` elements, never via `innerHTML`. This design avoids cross‑site scripting (XSS) even when log lines contain HTML or markup.
* **User interaction isolation.** The sidebar view uses a nonce‑restricted script and a strict CSP. Inputs for highlight keywords are treated purely as text and not executed, and highlight colours come from a fixed palette, preventing CSS injection.

### Logging and file operations

* **Controlled file access.** When exporting logs or starting auto‑save, the extension prompts the user via `showSaveDialog` to pick a destination file. It writes logs using VS Code’s `workspace.fs.writeFile` or Node’s `fs.createWriteStream`, and errors are reported to the webview.
* **Line limit enforcement.** The log panel enforces a maximum number of log entries (100 000 by default) to prevent excessive memory consumption and DOM size. When the limit is reached, older entries are discarded and the user is notified.

### Keeping dependencies up-to-date

The extension depends on the `ssh2` library. To ensure that this dependency is regularly updated to receive security patches, the dependency-bot is enabled in the repository. Also for every compilation, by default it is run `npm audit` to show the developer any new known vulnerability that needs to be fixed.

------------------------------------------------------------------------

# Code Overview

This document explains how the VSCode-Logger extension streams logs from embedded Linux devices into Visual Studio Code. It covers the activation lifecycle, major components, data flows between the extension host and the Webview, and key configuration or security considerations.

## Activation and configuration
- **Activation trigger**: The extension activates when VS Code loads the workspace or when a contributed command or view is invoked.
- **Configuration resolution**: Devices come from `embeddedLogger.devices` and are enriched with defaults from `embeddedLogger.defaultPort`, `embeddedLogger.defaultLogCommand`, `embeddedLogger.defaultEnableSshTerminal`, `embeddedLogger.defaultEnableSftpExplorer`, and `embeddedLogger.defaultSshCommands`. The max in-memory log history per tab comes from `embeddedLogger.maxLinesPerTab`.
- **Password migration**: During activation, legacy plaintext passwords from settings are migrated into VS Code Secret Storage so future connections prompt the user instead of persisting raw secrets in configuration.
- **View and command registration**: Activation registers the devices sidebar Webview, highlight-row commands, device-level SSH command/terminal handlers, and `embeddedLogger.openDevice` so selecting a device item opens its log panel or launches auxiliary actions.

## Major components
- **Configuration helpers (`src/configuration.ts`)**: Centralizes reading extension settings and applying default SSH port, log command, terminal enablement, and shared SSH commands to each device, while surfacing the max-lines limit.
- **Sidebar view (`src/sidebarView.ts` + `media/sidebarView.*`)**: Renders devices and highlight rows in a Webview. Users can open devices, run per-device SSH commands, open a dedicated SSH terminal when enabled, or manage highlight definitions that synchronize across log panels.
- **Device tree (`src/deviceTree.ts`)**: Supplies device metadata to the sidebar view and tree interactions.
- **Log panel host (`src/logPanel/`)**: `logPanel.ts` creates a Webview panel per remote or local log source, injects assets via `html.ts`, validates inbound Webview messages with `messageParser.ts`, persists presets/highlights through `stateStore.ts`, and manages auto-save streams through `autoSaveManager.ts`. It owns a `LogSession` for remote devices.
- **`LogSession` pipeline (`src/logSession/`)**: `logSession.ts` orchestrates streaming using `authenticationProvider.ts` (secrets and key loading), `connectionManager.ts` (SSH clients, channels, stream lifecycle), `hostKeyVerifier.ts` and `fingerprintPersistence.ts` (verification and capture), and `reconnectionController.ts` (retry strategy). It reports status changes and errors back to the Webview so the UI can react.
- **SSH helpers (`src/sshCommandRunner.ts`, `src/sshTerminal.ts`)**: Execute one-off SSH commands from the sidebar or spawn an interactive SSH terminal using stored or prompted credentials.
- **Webview clients (`media/loggerPanel/`, `media/loggerPanel.css`)**: The `loggerPanel.js` entrypoint composes `state.js` (state restoration/persistence), `rendering.js` (DOM utilities, highlight painting), and `messaging.js` (message dispatch). These receive log lines, parse severity, apply filters, manage presets and bookmarks, enforce the max-lines cap, and render the terminal-like UI. They can request preset persistence, deletion, exports, bookmark toggles, and highlight updates via `postMessage` events.

## Data and control flow

```mermaid
:zoom: 100%
graph TD
    A[Extension activation] --> B[getEmbeddedLoggerConfiguration]
    B --> C[Register sidebar view & commands]
    C --> D[Sidebar renders devices, highlights, SSH commands]
    D -- Open device --> E[embeddedLogger.openDevice]
    D -- Run SSH command --> M[SshCommandRunner executes via ssh2]
    D -- Open SSH terminal --> N[Create terminal using SshTerminalSession]
    E --> F["Create LogPanel (remote or local)"]
    F --> G["Start LogSession for remote devices"]
    G --> H[Fetch credentials from Secret Storage or prompt]
    H --> I[Run logCommand via ssh2]
    I --> J[Stream stdout/stderr data]
    J --> K[Parse lines, levels, highlights, bookmarks in loggerPanel.js]
    K --> L[Apply filters, presets, max-line cap, and formatting]
    L --> O[Render log entries and statuses in Webview]
    O -- Export/preset/bookmark requests --> P[Extension persists workspace state or writes file]
    F -- Status updates --> O
```

## High-level design and data flow

The extension follows a **device → credential → connection → stream → Webview** pipeline where the extension host orchestrates SSH operations and Webviews render stateful UI. Each class has a narrowly scoped role to keep concerns separated:

- **`configuration`** resolves user settings, applies defaults (ports, log command, SSH command defaults) and feeds normalized devices to downstream components.
- **`passwordManager`** mediates secret storage and prompts, ensuring no credentials are persisted in configuration or Webviews.
- **`logSession`** owns the SSH client lifecycle for streaming logs, validates host keys through a dedicated verifier, persists fingerprints when missing, and surfaces status callbacks via the connection manager and reconnection controller.
- **`logPanel`** bridges the extension host and the Webview for a device, wiring callbacks for presets, exports, bookmarks and highlights, and delegating HTML composition and state storage to its helper modules.
- **`deviceTree`** and **`sidebarView`** collect devices from configuration and expose user actions (open device, run command, open terminal) that map to backend handlers.
- **`sshCommandRunner`** executes one-off commands with the same credential and validation pipeline as log streaming.
- **`sshTerminal`** provides an interactive pseudoterminal session with the same authentication and host-key guarantees.
- **Webview clients (`loggerPanel.js` + `state.js`/`rendering.js`/`messaging.js`, `sidebarView.js`)** manage UI state, apply filtering and highlighting, and issue `postMessage` calls to request backend actions while rendering streamed data.

### Data flow: device configuration to Webview rendering

```mermaid
:zoom: 100%
sequenceDiagram
    participant User
    participant VSCode as VS Code Settings
    participant Config as configuration.ts
    participant DeviceTree as deviceTree.ts / sidebarView.ts
    participant LogPanel as logPanel.ts
    participant Session as logSession.ts
    participant Secrets as passwordManager.ts
    participant SSH as ssh2 Client
    participant Webview as loggerPanel.js

    User->>VSCode: Configure embeddedLogger.devices
    VSCode-->>Config: Provide settings with defaults
    Config-->>DeviceTree: Normalized devices
    User->>DeviceTree: Select device (open panel)
    DeviceTree->>LogPanel: Request panel for device
    LogPanel->>Session: Start log session
    Session->>Secrets: Retrieve credentials (prompt or secret store)
    Secrets-->>Session: Password/passphrase/private key
    Session->>SSH: Connect (host key verification)
    SSH-->>Session: Secure channel ready
    Session->>SSH: Execute logCommand
    SSH-->>Session: Stream stdout/stderr chunks
    Session-->>LogPanel: Emit complete log lines + statuses
    LogPanel-->>Webview: postMessage lines, statuses, presets
    Webview-->>User: Rendered logs, filters, highlights
```

### Log streaming sequence (status + reconnection aware)

```mermaid
:zoom: 100%
sequenceDiagram
    participant User
    participant Panel as LogPanel
    participant Session as LogSession
    participant Secrets as PasswordManager
    participant SSH as ssh2 Client
    participant Webview as loggerPanel.js

    User->>Panel: Open device panel
    Panel->>Session: create(device)
    Session->>Secrets: getSecret(device)
    Secrets-->>Session: credentials or prompt result
    Session->>SSH: connect(host, port, auth, hostVerifier)
    SSH-->>Session: ready or error
    Session-->>Panel: onStatus("connecting"/"streaming")
    Panel-->>Webview: postMessage(status)
    Session->>SSH: exec(logCommand)
    SSH-->>Session: data chunks
    Session-->>Panel: onData(lines)
    Panel-->>Webview: postMessage(logEntries)
    alt disconnect/error
        Session-->>Panel: onError(reason)
        Panel-->>Webview: postMessage(error)
        Session-->>Session: schedule reconnect with backoff
    end
    User->>Panel: Close panel
    Panel->>Session: dispose()
    Session->>SSH: end()
```

### SSH command execution sequence

```mermaid
:zoom: 100%
sequenceDiagram
    participant User
    participant Sidebar as SidebarView (Webview)
    participant Extension as extension.ts
    participant Runner as SshCommandRunner
    participant Secrets as PasswordManager
    participant SSH as ssh2 Client

    User->>Sidebar: Click configured command
    Sidebar-->>Extension: postMessage(runCommand)
    Extension->>Runner: run(device, command)
    Runner->>Secrets: getSecret(device)
    Secrets-->>Runner: credentials
    Runner->>SSH: connect(host, port, auth, hostVerifier)
    SSH-->>Runner: ready
    Runner->>SSH: exec(sanitizedCommand)
    SSH-->>Runner: stdout/stderr
    Runner-->>Extension: resolved output/errors
    Extension-->>User: showInformationMessage / showErrorMessage
```

### SSH connection flow (primary/secondary hosts, bastion, and secret retrieval)

```mermaid
:zoom: 100%
flowchart LR
    A[Device config] -->|defaults applied| B[Normalized device]
    B --> C{Bastion configured?}
    C -- Yes --> D["Build bastion client config (host, port, username, fingerprint)"]
    D --> E[Retrieve bastion secret via PasswordManager]
    E --> F[Open SSH tunnel to bastion]
    F --> G[Forward connection to target host/port]
    C -- No --> H[Direct target client config]
    B --> H
    H --> I[Retrieve target secret via PasswordManager]
    I --> J[Connect ssh2 client with hostVerifier]
    J --> K{Connection established?}
    K -- Yes --> L[Run logCommand or device command]
    K -- No --> M[Surface error and retry/backoff]
    L --> N[Stream stdout/stderr]
    N --> O[Emit status/data to logPanel]
    O --> P["Render in Webview (loggerPanel.js)"]
```

## Lifecycle details
1. **Panel creation**: Each device or imported log opens in its own Webview panel. Existing panels re-activate instead of spawning duplicates when the same source is selected again.
2. **Session management**: `LogSession` tracks connection lifecycle events (connecting, streaming, disconnecting, error) and disposes of SSH resources when panels close or the extension deactivates.
3. **Back-pressure handling**: Incoming data is buffered until complete lines are available to avoid splitting log entries mid-line.
4. **Presets, filters, and bookmarks**: Presets are stored per device in workspace state keyed by device ID. Bookmark toggles, auto-save, highlight rows, find navigation, and colour-coded level filtering live in the Webview state so they restore when a panel gains focus.
5. **Exports**: The Webview requests exports for only the currently visible (filtered) lines. The extension host asks the user for a destination path and writes the collected text.
6. **Configuration changes**: When any `embeddedLogger` setting changes, the sidebar refreshes device metadata (including defaults). Active panels continue streaming with their existing session until closed.
7. **Security**: Password prompts rely on VS Code’s secure input. Secrets are never written to the Webview or logs; they remain in secret storage or transient prompts. SSH sessions close on disposal to avoid leaving hanging connections.
