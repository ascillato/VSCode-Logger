# Architecture Overview

VSCode‑Logger is a Visual Studio Code extension designed to stream logs
from embedded Linux devices over SSH, providing filtering, highlighting,
bookmarking, and search. Alongside log viewing, it provides device grouping, a
Device Manager settings UI, one-off SSH commands, interactive SSH
terminals, a dual-pane SFTP explorer, and optional external or embedded
browser actions for device URLs.

This codebase overview is organized in terms of architecture,
maintainability, security, performance, and UI implementation and security. It
covers the extension host code (TypeScript) and the Webview clients
(JavaScript/CSS).

------------------------------------------------------------------------

## Design Principles

This project was designed around the following principles:

- **Documentation and configuration**
- **Security-conscious design**
- **Modular architecture**
- **Robust asynchronous logic**
- **User experience considerations**
- **Testing practice**
- **Linting, type-checking, formatting and spelling**
- **Extensibility and configuration**

### Strengths

-   **Clear modular structure**: Components such as `logSession` (split
    into authentication, host-key verification, fingerprint
    persistence, connection orchestration, and reconnection helpers),
    the `logPanel` host (split into lifecycle, HTML composition,
    messaging and persistence helpers), `sftpExplorer`,
    `sshCommandRunner`, `sshTerminal`, `deviceManagerPanel`, and the
    device tree/sidebar layers are well separated.
-   **Good use of VS Code APIs**: Webview panels and views, tree data
    providers, pseudoterminals, secret storage, configuration scopes,
    workspace state, and file system APIs are used consistently.
-   **Consistent TypeScript typings** across devices, groups, bastion
    settings, SSH commands, log-panel messages, and SFTP operations.
-   **Centralized configuration resolution**: Defaults for ports, log
    commands, SSH terminals, SFTP explorer, browser actions, shared SSH
    commands, groups, and max log lines are normalized in one place
    before downstream components consume them.
-   **Clear trust and validation gates**: Log streaming, one-off SSH
    commands, SSH terminals, SFTP access, and browser actions all refuse
    to run in untrusted workspaces and validate key device inputs before
    use.
-   **Secret handling**: Passwords and passphrases are pulled from VS
    Code Secret Storage with migration from legacy settings, prompts,
    and controlled reuse across workspaces.
-   **Connection hygiene**: SSH features support host-key verification
    with SHA-256 fingerprints, secondary-host fallback, bastion
    tunnelling, and explicit disposal of SSH clients and channels.
-   **Webview safety**: The log viewer, devices view, Device Manager,
    and SFTP explorer all use nonce-backed CSPs and message passing,
    while log rendering uses text-safe insertion instead of raw HTML.

------------------------------------------------------------------------

## Performance Overview

### Strengths

-   **Efficient streaming pipeline**: The log session buffers partial
    chunks until full lines are available, so the Webview receives
    complete entries instead of fragmented text.
-   **Incremental rendering**: The log viewer appends entries in batches
    and avoids rebuilding the full DOM for every new line.
-   **Bounded memory usage**: The log panel enforces
    `embeddedLogger.maxLinesPerTab` to prevent unbounded in-memory and
    DOM growth for long-running sessions.
-   **Deferred heavy work**: Activation registers views and commands but
    does not start network activity until the user opens a log panel,
    terminal, SFTP explorer, or browser action.
-   **Targeted refresh behavior**: Sidebar/device updates and SFTP
    preset updates send focused payloads rather than forcing full
    extension reloads.

------------------------------------------------------------------------

## Maintainability Overview

### Strengths

-   **Clear separation between backend and frontend**: VS Code API and
    SSH logic live in `src/`, while DOM/state handling lives in
    `media/`.
-   **Focused helper modules**: `configuration.ts`,
    `passwordManager.ts`, `hostEndpoints.ts`, `logPanel/*`, and
    `logSession/*` keep cross-cutting concerns isolated.
-   **Schema-aware configuration editing**: The Device Manager validates
    imported JSON and normalizes devices, groups, defaults, SSH
    commands, bastion settings, and SFTP presets before saving.
-   **Good organization and naming conventions**: The current module
    layout makes it easy to extend a specific area without loading
    unrelated concerns into `extension.ts`.
-   **Automated checks are part of the workflow**: The repository
    includes compile, lint, docs, unit, integration, and e2e test
    scripts.

------------------------------------------------------------------------

## UI/UX Overview

### Strengths

-   **Devices view supports multiple workflows**: Devices can be grouped
    into collapsible sections, color coded, and exposed with context
    actions for logs, SSH, SFTP, and browser actions.
-   **Log viewer is feature rich without mixing host logic into the Webview**: Live logs and imported files share filtering, highlights,
    presets, search, bookmarks, exports, reconnect controls, and
    auto-save.
-   **Device Manager improves discoverability**: Users can edit defaults,
    groups, devices, SSH commands, fingerprints, and SFTP presets from a
    structured table UI instead of only editing raw JSON.
-   **SFTP explorer is integrated into the same device model**: It
    reuses device credentials, host-key expectations, presets, and
    terminal actions, which makes navigation consistent across features.
-   **Responsive layout and theme integration**: The Webviews use VS Code
    theme variables and preserve a native-feeling workflow inside the
    editor.

------------------------------------------------------------------------

## Security Overview

The **VSCode-Logger** extension interacts with remote systems over SSH
and writes selected data to local files. It supports live log
streaming, SFTP file operations, one-off commands, SSH terminals, and
optional device URL launching. Because it handles credentials, host-key
verification, and remote command execution, security is a core part of
the design.

### Strengths
* **Workspace trust enforcement and input validation**: SSH-capable features refuse to run in untrusted workspaces and validate device host, username, port, and related settings before use.
* **Secure credential storage**: Secrets are stored in VS Code Secret Storage after prompting users, keeping interactive credentials off disk by default. The extension uses the **VS Code Secrets API** for storing passwords and passphrases securely. Secrets are scoped per workspace with metadata prompts before reuse, reducing accidental credential leakage.
* **Webview security and XSS prevention**: Webview UIs render log lines using `textContent` rather than `innerHTML`. Log lines are inserted as text nodes, preventing HTML injection from streamed content. Webview CSPs block external scripts and restrict styles to bundled extension assets. A restrictive Content-Security-Policy disallows remote scripts and limits styles to extension resources, reducing XSS risk.
* **Connection robustness**: Auto-reconnect logic includes visible status updates and timers.
* **SSH integrity and tunnelling**: Log streaming uses host key verification with captured fingerprints, and bastion tunnelling preserves fingerprint checks when present.
* **Controlled file and config operations**: Exports, auto-save, local log opening, and imported settings all flow through validated extension-host code paths.

### Workspace trust and configuration validation

* **Workspace trust gating.** Log streaming, one-off SSH commands, SSH terminals, SFTP explorer access, and browser-opening actions all check `vscode.workspace.isTrusted` before they run.
* **Device configuration validation.** SSH entry points validate core fields such as `host`, `username`, and `port` before attempting a connection. The Device Manager also validates imported defaults, groups, devices, SSH commands, bastion blocks, and SFTP preset arrays before saving them.
* **Sanitization of commands.** `sanitizeCommand` rejects control characters and newlines in one-off commands. The log session applies the same kind of validation to `logCommand`, and SSH-terminal command execution rejects multiline payloads as well.

### Secure SSH handling

* **Host-key verification and fingerprint capture.** SSH connections use SHA-256 host-key verification. When a configured fingerprint is present for the primary, secondary, or bastion endpoint, the connection is rejected on mismatch. When an endpoint has no saved fingerprint, the extension can persist the first successful fingerprint back into configuration for later connections.
* **Authentication management.** Passwords, passphrases, and private keys are resolved on the extension host through `PasswordManager` and authentication helpers. Device and bastion secrets are stored separately, and reuse across workspaces is mediated with metadata and user confirmation.
* **Session lifecycle management.** Log sessions, terminal sessions, command-runner connections, SFTP clients, tunnels, and auto-save streams are all explicitly disposed when panels close or operations end. Errors are surfaced back to the UI instead of being silently ignored.
* **Bastion and endpoint support.** Connection helpers support optional bastion tunnelling and secondary-host fallback so remote features can follow the same trusted endpoint model instead of each feature reimplementing its own connection rules.

### Webview security

* **Content‑Security‑Policy (CSP).** The webviews for both the log panel and sidebar set a strict CSP: `default-src 'none'`, `script-src 'nonce‑…'` and `style-src` limited to the extension’s own origin. No external scripts or inline scripts are allowed. The script tag includes a random nonce generated with `getNonce()` to prevent injection attacks.
* **Safe HTML rendering.** Log lines and user‑supplied highlight keys are inserted into the DOM using `createTextNode` or by setting `textContent`. Highlight markers are built by splitting text and wrapping matches in `<span>` elements, never via `innerHTML`. This design avoids cross‑site scripting (XSS) even when log lines contain HTML or markup.
* **User interaction isolation.** The sidebar view uses a nonce‑restricted script and a strict CSP. Inputs for highlight keywords are treated purely as text and not executed, and highlight colours come from a fixed palette, preventing CSS injection.

### Logging and file operations

* **Controlled file access.** When exporting logs or starting auto‑save, the extension prompts the user via `showSaveDialog` to pick a destination file. It writes logs using VS Code’s `workspace.fs.writeFile` or Node’s `fs.createWriteStream`, and errors are reported to the webview.
* **Line limit enforcement.** The log panel enforces `embeddedLogger.maxLinesPerTab` (100000 by default) to keep long-running sessions bounded in memory and in the DOM.
* **State persistence with sanitization.** Presets, highlights, and SFTP path presets are stored only after normalization or sanitization, which reduces bad state carrying forward across sessions.

### Keeping dependencies up-to-date

The extension depends on the `ssh2` library. To ensure that this dependency is regularly updated to receive security patches, the dependency-bot is enabled in the repository. Also for every compilation, by default it is run `npm audit` to show the developer any new known vulnerability that needs to be fixed.

------------------------------------------------------------------------

# Code Overview

This document explains how the VSCode-Logger extension streams logs from
embedded Linux devices into Visual Studio Code. It covers the activation
lifecycle, major components, data flows between the extension host and
the Webviews, and key configuration and security considerations.

## Activation and configuration
- **Activation trigger**: The extension activates when VS Code loads the workspace or when a contributed view or command is invoked.
- **Configuration resolution**: Devices come from `embeddedLogger.devices`, groups come from `embeddedLogger.groups`, and device defaults are enriched from `embeddedLogger.defaultPort`, `embeddedLogger.defaultLogCommand`, `embeddedLogger.defaultEnableSshTerminal`, `embeddedLogger.defaultEnableSftpExplorer`, `embeddedLogger.defaultEnableWebBrowser`, `embeddedLogger.defaultEnableEmbeddedWebBrowser`, `embeddedLogger.defaultSshCommands`, and `embeddedLogger.maxLinesPerTab`.
- **Per-device overrides**: Device fields such as `showDefaultSshCommands`, `enableSshTerminal`, `enableSftpExplorer`, browser flags, SFTP presets, secondary hosts, colors, and bastion settings override or extend those defaults.
- **Legacy migration**: During activation, legacy plaintext passwords and passphrases are migrated into VS Code Secret Storage, and legacy workspace-state SFTP presets are migrated into `embeddedLogger.devices` when possible.
- **View and command registration**: Activation registers the tree view, the devices Webview, Device Manager commands, local-log opening, SSH command and terminal handlers, SFTP explorer handlers, browser actions, and `embeddedLogger.openDevice` so selecting a device opens or reuses its log panel.

## Major components
- **Configuration helpers (`src/configuration.ts`)**: Centralize reading extension settings, applying defaults, resolving groups, sanitizing SFTP presets, merging shared SSH commands, and surfacing the max-lines limit.
- **Device tree (`src/deviceTree.ts`)**: Supplies the Activity Bar tree view, including collapsible groups and per-device color icons.
- **Sidebar view (`src/sidebarView.ts` + `media/sidebarView.*`)**: Renders the devices Webview with grouped cards and quick actions for logs, SSH commands, SSH terminal, SFTP explorer, and browser actions.
- **Device Manager (`src/deviceManagerPanel.ts` + `media/deviceManager.*`)**: Provides a table-style configuration editor for defaults, groups, devices, import/export, JSON editing, and password cleanup.
- **Password manager (`src/passwordManager.ts`)**: Encapsulates storage, retrieval, migration, reuse, and cleanup of device and bastion passwords or private-key passphrases.
- **Log panel host (`src/logPanel/`)**: `logPanel.ts` creates a Webview panel per remote or local log source, injects assets via `html.ts`, validates inbound Webview messages with `messageParser.ts`, persists presets and highlights through `stateStore.ts`, and manages auto-save streams through `autoSaveManager.ts`. It owns a `LogSession` for remote devices.
- **`LogSession` pipeline (`src/logSession/`)**: `logSession.ts` orchestrates streaming using `authenticationProvider.ts` (secrets and key loading), `connectionManager.ts` (SSH clients, channels, stream lifecycle), `hostKeyVerifier.ts` and `fingerprintPersistence.ts` (verification and capture), and `reconnectionController.ts` (retry strategy).
- **SSH helpers (`src/sshCommandRunner.ts`, `src/sshTerminal.ts`)**: Execute one-off SSH commands from the devices view or spawn an interactive SSH terminal using the same validation and authentication pipeline as log streaming.
- **SFTP explorer (`src/sftpExplorer.ts` + `media/sftpExplorer.*`)**: Hosts the dual-pane file explorer, transfers, permissions editing, quick search, path presets, and integrated terminal or run actions while reusing device authentication and bastion support.
- **Webview clients (`media/loggerPanel/`, `media/loggerPanel.css`)**: The `loggerPanel.js` entrypoint composes `state.js`, `rendering.js`, and `messaging.js` to parse severity, apply filters and highlights, manage bookmarks and presets, enforce the max-lines cap, and render the terminal-like UI for both remote and local logs.

## Data and control flow

```mermaid
:zoom: 100%
graph TD
    A[Extension activation] --> B[getEmbeddedLoggerConfiguration + groups]
    B --> C[Register views, Device Manager, and commands]
    C --> D[Devices tree + Devices Webview]
    C --> R[Device Manager]
    R -- Save/import configuration --> B
    D -- Open device logs --> E[Create LogPanel]
    D -- Run SSH command --> M[SshCommandRunner executes via ssh2]
    D -- Open SSH terminal --> N[Create terminal using SshTerminalSession]
    D -- Open SFTP explorer --> S[SftpExplorerPanel]
    C -- Open local log file --> Q[Create local LogPanel]
    E --> F["Start LogSession for remote devices"]
    F --> G[Fetch credentials from Secret Storage or prompt]
    G --> H[Resolve endpoint, verify host key, connect via ssh2]
    H --> I[Run logCommand]
    I --> J[Stream stdout/stderr data]
    J --> K[Parse lines, levels, highlights, bookmarks in loggerPanel.js]
    K --> L[Apply filters, presets, max-line cap, and formatting]
    L --> O[Render log entries and statuses in Webview]
    O -- Export/preset/bookmark requests --> P[Extension persists workspace state or writes file]
    S --> T[Browse files, transfer data, save presets]
    Q --> O
    F -- Status updates --> O
```

## High-level design and data flow

The extension follows a **configuration -> device selection -> credential
resolution -> connection -> stream or remote action -> Webview**
pipeline. The extension host owns SSH operations and file access, while
Webviews render UI state and request actions through message passing.
Each class has a narrowly scoped role to keep concerns separated:

- **`configuration`** resolves user settings, groups, defaults, shared SSH commands, SFTP presets, and max log limits into normalized devices.
- **`passwordManager`** mediates secret storage and prompts, ensuring credentials are not persisted in Webviews or kept in plaintext settings.
- **`logSession`** owns the SSH client lifecycle for streaming logs, endpoint rotation, host-key validation, fingerprint persistence, and reconnect behavior.
- **`logPanel`** bridges the extension host and the log-viewer Webview for both remote devices and local files, wiring callbacks for presets, exports, auto-save, bookmarks, and highlights.
- **`deviceTree`** and **`sidebarView`** expose configured devices and their actions in tree and Webview form.
- **`deviceManagerPanel`** provides schema-aware editing, import/export, and save flows for the current configuration model.
- **`sshCommandRunner`** executes sanitized one-off commands with the same credential and endpoint model used elsewhere.
- **`sshTerminal`** provides an interactive pseudoterminal session with the same authentication and host-key guarantees.
- **`sftpExplorer`** provides a dual-pane file workflow built on the same device identity, secret handling, and bastion support.
- **Webview clients (`loggerPanel.js`, `sidebarView.js`, `deviceManager.js`, `sftpExplorer.js`)** manage UI state and issue explicit `postMessage` requests back to the extension host.

### Data flow: device configuration to Webview rendering

```mermaid
:zoom: 100%
sequenceDiagram
    participant User
    participant VSCode as VS Code Settings
    participant Config as configuration.ts
    participant DeviceViews as deviceTree.ts / sidebarView.ts
    participant LogPanel as logPanel.ts
    participant Session as logSession.ts
    participant Secrets as passwordManager.ts
    participant SSH as ssh2 Client
    participant Webview as loggerPanel.js

    User->>VSCode: Configure embeddedLogger.groups / embeddedLogger.devices
    VSCode-->>Config: Provide settings with defaults
    Config-->>DeviceViews: Normalized groups and devices
    User->>DeviceViews: Select device (open panel)
    DeviceViews->>LogPanel: Request panel for device
    LogPanel->>Session: Start log session
    Session->>Secrets: Retrieve credentials (prompt or secret store)
    Secrets-->>Session: Password/passphrase/private key
    Session->>SSH: Connect (endpoint resolution + host-key verification)
    SSH-->>Session: Secure channel ready
    Session->>SSH: Execute logCommand
    SSH-->>Session: Stream stdout/stderr chunks
    Session-->>LogPanel: Emit complete log lines + statuses
    LogPanel-->>Webview: postMessage lines, statuses, presets, highlights
    Webview-->>User: Rendered logs, filters, highlights, bookmarks
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
    H --> I[Resolve primary or secondary endpoint]
    I --> J[Retrieve target secret via PasswordManager]
    J --> K[Connect ssh2 client with hostVerifier]
    K --> L{Connection established?}
    L -- Yes --> M[Run logCommand or device command]
    L -- No --> N[Surface error and retry/backoff]
    M --> O[Stream stdout/stderr]
    O --> P[Emit status/data to logPanel]
    P --> Q["Render in Webview (loggerPanel.js)"]
```

## Lifecycle details
1. **Panel creation**: Each remote device or imported local log file opens in its own log Webview panel. Existing panels are reactivated instead of duplicated when the same source is selected again.
2. **Session management**: `LogSession` tracks connection lifecycle events such as connecting, streaming, disconnecting, reconnect countdowns, and errors. SSH resources are disposed when panels close or the extension deactivates.
3. **Back-pressure handling**: Incoming data is buffered until complete lines are available so log entries are not split mid-line.
4. **Presets, filters, highlights, and bookmarks**: Presets and highlights are stored per log target in workspace state keyed by device ID or local source ID. Filtering, search state, bookmark navigation, and highlight rendering live in the Webview state so the UI restores cleanly.
5. **Exports, auto-save, and local files**: The Webview requests exports only for currently visible lines. The extension host handles save dialogs, file writes, local-file refresh, and source-file open requests.
6. **Configuration changes**: When `embeddedLogger` settings change, the devices tree and devices Webview refresh with updated devices, groups, defaults, and commands. Active log panels continue using their existing session until reopened or reconnected.
7. **Security boundaries**: Secrets stay in secret storage or transient prompts, SSH and file operations stay in extension-host code, and Webviews remain limited to rendering and explicit message passing.

## Extending the Current Design

For the current architecture, these are the safest extension points:

- add new device fields in `src/deviceTree.ts` and normalize them in `src/configuration.ts`
- add new Device Manager controls in `src/deviceManagerPanel.ts` and `media/deviceManager.*`
- add new Devices view actions in `src/sidebarView.ts` and `media/sidebarView.js`
- add new log-panel backend behavior in `src/logPanel/logPanel.ts`
- add new log-panel UI behavior in `media/loggerPanel.*`
- add new SSH connection behavior inside `src/logSession/`
- extend SFTP behavior in `src/sftpExplorer.ts`

Keep extension-host logic in `src/` and DOM/state logic in `media/`. That separation is still the clearest architectural boundary in the current codebase.
