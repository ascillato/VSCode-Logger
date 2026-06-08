# Proposal: Close extension sessions before reload

## Summary

Add a reload-cleanup path that closes all extension-owned live sessions before the VS Code window reloads. This includes log panels, SFTP explorer panels, and SSH terminals created by the extension.

## Problem

The extension already disposes tracked log panels and SFTP explorer panels in `deactivate()`, but reload-triggered teardown is still inconsistent:

- `src/extension.ts` tracks log panels in `panelMap` and SFTP explorer panels in `sftpPanels`, but SSH terminals are created without a shared registry.
- `src/deviceManagerPanel.ts` currently calls `workbench.action.reloadWindow` directly after some settings saves.
- Reloading can leave extension-owned panels or terminals visible after the extension host restarts, even though those sessions are no longer usable.

The result is stale UI that looks active but no longer has a working backend session.

## Goals

- Close every extension-owned live session before a reload initiated through the extension.
- Reuse the same cleanup path during extension deactivation so all shutdown paths behave consistently.
- Track extension-owned SSH terminals explicitly instead of relying on implicit VS Code teardown.
- Avoid adding new user configuration for this behavior.

## Non-goals

- Restoring log streams, SFTP sessions, or SSH terminals automatically after reload.
- Closing unrelated VS Code terminals, editors, or browser tabs.
- Depending on proposed or unsupported VS Code APIs to observe every command executed globally.

## User impact

After the change, a reload triggered from extension workflows will close stale log panels, SFTP panels, and extension-managed SSH terminals before VS Code reloads. Users will come back to a clean window instead of dead sessions.

## Success criteria

- Reloads triggered by extension UI do not leave stale log panels or SFTP explorers open.
- Extension-created SSH terminals are closed before reload and during deactivation.
- Existing commands for opening devices, SFTP explorers, and SSH terminals continue to work unchanged before reload.
