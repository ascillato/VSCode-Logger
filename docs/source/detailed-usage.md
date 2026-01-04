# Usage Examples

This template ships with two commands you can use for smoke testing and as examples for your own implementation.

## Say Hello

- Command ID: `extension-template.sayHello`
- Behavior: reads the optional `template.greetingPrefix` setting and shows a greeting in VS Code.
- How to replace: update the command in `src/extension.ts` and adjust the configuration schema in `package.json`.

## Welcome Panel

- Command ID: `extension-template.showWelcomePanel`
- Behavior: opens a Webview with simple instructions and a placeholder data payload.
- How to replace: edit `src/welcomePanel.ts` and the assets under `media/` to render your UI. Use `webview.postMessage` to exchange data with the extension host.

## Customizing for your project

1. Rename the commands and activation events in `package.json`.
2. Add any additional configuration fields your extension needs.
3. Update the README and docs to reflect your features.
4. Expand the tests in `tests/` to cover new behaviors.
