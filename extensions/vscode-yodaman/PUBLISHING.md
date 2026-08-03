# VS Code Marketplace Publishing

YodaMan VS Code extension publishing uses `vsce`.

## Package

```bash
npm install
npm run package
```

This creates:

```text
vscode-yodaman-0.3.8.vsix
```

## Publish

Prerequisites:

- A Visual Studio Marketplace publisher named `yodaman`, or update `publisher` in `package.json`.
- A Personal Access Token available to `vsce`.

Publish with:

```bash
VSCE_PAT=<token> npm run publish
```

If the publisher name is not available, update `publisher` in `package.json` before publishing. The current extension identifier is:

```text
yodaman.vscode-yodaman
```
