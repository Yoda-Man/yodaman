// The extension uses core's shared client, which lives outside this folder, so
// vsce never packaged it and an installed extension could not start. Copy it in
// before every package and publish (vscode:prepublish).
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', '..', 'shared');
const to = path.join(__dirname, 'src', 'shared');
fs.mkdirSync(to, { recursive: true });
for (const file of ['yodamanClient.js', 'yodamanProtocol.js']) {
    fs.copyFileSync(path.join(from, file), path.join(to, file));
}
