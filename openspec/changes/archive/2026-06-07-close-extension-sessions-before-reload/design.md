# Design: Close extension sessions before reload

## Current state

`src/extension.ts` owns the main session lifecycle:

- `panelMap` stores remote and local `LogPanel` instances.
- `sftpPanels` stores `SftpExplorerPanel` instances.
- `deactivate()` disposes both collections.

There are two gaps:

1. SSH terminals are not tracked centrally. `openSshTerminal()` in `src/extension.ts` creates a terminal and shows it, but does not retain the `vscode.Terminal` instance.
2. `SftpExplorerPanel` can also open remote SSH terminals from `src/sftpExplorer.ts`, bypassing any extension-level terminal lifecycle tracking.

This means reload-sensitive UI is only partially managed today.

## Proposed changes

### 1. Add a shared session cleanup helper

Create a single helper in `src/extension.ts` that disposes all active extension-owned sessions:

- every `LogPanel` in `panelMap`
- every `SftpExplorerPanel` in `sftpPanels`
- every tracked extension-created `vscode.Terminal`

`deactivate()` should call this helper instead of duplicating partial cleanup logic.

### 2. Track extension-owned SSH terminals

Add a terminal registry such as `managedSshTerminals: Set<vscode.Terminal>` in `src/extension.ts`.

Every SSH terminal created by the extension should:

- be added to the registry immediately after `vscode.window.createTerminal(...)`
- remove itself from the registry when VS Code reports terminal closure
- be disposed by the shared cleanup helper

This registry should include:

- SSH terminals opened from the sidebar or commands in `src/extension.ts`
- remote SSH terminals opened from the SFTP explorer

It should not include unrelated local terminals that VS Code or the user creates independently.

### 3. Route SSH terminal creation through one managed path

To ensure the SFTP explorer participates in the same cleanup behavior, move remote SSH terminal creation behind a shared extension-owned helper instead of calling `vscode.window.createTerminal(...)` directly in multiple places.

Reasonable implementation options:

- pass a terminal-opening callback from `src/extension.ts` into `SftpExplorerPanel`, or
- extract a small helper module that creates and registers managed SSH terminals

The key requirement is that all extension-created SSH terminals go through one registry-aware path.

### 4. Mark managed SSH terminals as transient

When creating extension-owned SSH terminals, set the terminal option that opts out of persistence across reload/restart (`isTransient` in current typings).

This reduces the chance that VS Code restores a dead terminal UI after reload, even if cleanup timing is imperfect.

### 5. Add an extension-owned reload wrapper

Introduce a command or internal helper that performs:

1. session cleanup
2. `workbench.action.reloadWindow`

`src/deviceManagerPanel.ts` should call this wrapper instead of invoking `workbench.action.reloadWindow` directly.

This gives the extension a reliable reload path for its own workflows without depending on a generic global command listener that is not available in this repository’s current VS Code typings.

## Tradeoffs

- This does not guarantee interception of every possible reload initiated outside the extension. The stable API surface available in this repo does not currently expose a reliable generic pre-reload hook for arbitrary command execution.
- Centralizing SSH terminal creation adds a small amount of plumbing, but it removes duplicated lifecycle behavior and makes reload cleanup testable.

## Testing

Add unit coverage for:

- reload wrapper closes tracked log panels, SFTP panels, and managed SSH terminals before invoking `workbench.action.reloadWindow`
- `deactivate()` closes managed SSH terminals in addition to existing panel cleanup
- device manager save flows call the extension-owned reload wrapper instead of the raw workbench reload command
- SSH terminals created from both the main extension command path and the SFTP explorer path are registered for cleanup
