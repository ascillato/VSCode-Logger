# Tasks

- [x] Add a shared cleanup helper in `src/extension.ts` that disposes tracked log panels, SFTP explorer panels, and managed SSH terminals.
- [x] Introduce a managed SSH terminal registry and route extension-created SSH terminals through a single registry-aware creation path.
- [x] Update remote terminal creation from `src/sftpExplorer.ts` to use the managed SSH terminal path.
- [x] Mark extension-created SSH terminals as transient so VS Code does not try to persist them across reload.
- [x] Add an extension-owned reload helper or command and switch `src/deviceManagerPanel.ts` to use it instead of calling `workbench.action.reloadWindow` directly.
- [x] Extend unit tests in `tests/unit/extensionWebBrowserCommands.test.ts` and `tests/unit/deviceManagerPanel.test.ts` to cover reload cleanup and command routing.
