/**
 * Capture README screenshots from the running runtime.
 *
 * WHY A SCRIPT AND NOT A ONE-OFF.
 *
 * Screenshots rot exactly the way version numbers and file paths do, and
 * nothing catches it: a README showing a UI from four releases ago looks
 * current to a first-time visitor and wrong to everyone who has used the
 * product. Regenerating them has to be one command, or it will not happen.
 *
 *     npm run screenshots            # requires the runtime on :3090
 *
 * Uses the Electron already in devDependencies rather than adding Puppeteer.
 * The app has no URL routing — tabs are internal state — so each view is
 * reached by clicking, the same way a user reaches it.
 *
 * PRIVACY: the sidebar lists every indexed workspace, with absolute paths that
 * include the operator's home directory. `--redact` (the default) blanks those
 * before capture. Publishing an un-redacted capture puts private project names
 * and a username into a public README, so redaction is opt-out, not opt-in.
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const URL = process.env.YODAMAN_URL || 'http://localhost:3090';
const OUT_DIR = path.join(__dirname, '..', 'website', 'assets', 'screenshots');
const REDACT = !process.argv.includes('--no-redact');
const WIDTH = 1440;
const HEIGHT = 900;

/** Views to capture: a label, and the tab button text that opens it. */
const VIEWS = [
    { file: 'dashboard.png', tab: 'Dashboard', settle: 2500, expect: 'System Dashboard' },
    { file: 'graph.png', tab: 'Graph', settle: 4000, expect: 'Graph' },
    { file: 'stardust.png', tab: 'Stardust', settle: 3000, expect: 'Stardust' },
    { file: 'plugins.png', tab: 'Plugins', settle: 1500, expect: 'Plugins' }
];

/**
 * Click a top-level tab by its visible text.
 *
 * Returns whether it found one, so a renamed tab fails loudly instead of
 * silently capturing whatever was already on screen — the screenshot
 * equivalent of a test asserting on an empty result.
 */
const clickTabScript = (label) => `
(() => {
  const wanted = ${JSON.stringify(label)}.toLowerCase();
  const btns = [...document.querySelectorAll('button')];
  const hit = btns.find(b => (b.textContent || '').trim().toLowerCase() === wanted);
  if (!hit) return false;
  hit.click();
  return true;
})()
`;

/**
 * Dismiss the first-run onboarding modal.
 *
 * SKIP explicitly, never "Continue". An earlier version matched
 * /^(skip|continue)$/ and took whichever appeared first in the DOM — which is
 * "Continue", so it advanced the carousel instead of closing it and every
 * capture was of the modal with a blurred app behind it. The script reported
 * success because the PNGs were a plausible size.
 */
const dismissOnboarding = `
(() => {
  const btns = [...document.querySelectorAll('button')];
  const skip = btns.find(b => /^skip$/i.test((b.textContent || '').trim()));
  if (skip) { skip.click(); return 'skip'; }
  const close = btns.find(b => /^(close|dismiss|×|✕)$/i.test((b.textContent || '').trim()));
  if (close) { close.click(); return 'close'; }
  return null;
})()
`;

/**
 * Is a modal still covering the app?
 *
 * The precondition every capture depends on. Asserting it is the difference
 * between "a PNG was written" and "the view was photographed".
 */
const modalIsOpen = `
(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog && dialog.offsetParent !== null) return true;
  // The onboarding carousel is the other overlay, identified by its own
  // controls rather than by styling.
  //
  // A first version tested for backdrop-filter: blur and reported a modal on
  // every run. The app uses backdrop-blur decoratively on the sidebar and the
  // starfield background, so the check was reading the design as a dialog and
  // refusing to capture anything. Detect the thing, not a style it happens to
  // share with half the layout.
  return [...document.querySelectorAll('button')].some(b =>
    /^skip$/i.test((b.textContent || '').trim()) && b.offsetParent !== null);
})()
`;

/** Activate the workspace named 'yodaman' — the project itself, safe to show. */
const selectWorkspace = `
(() => {
  const el = [...document.querySelectorAll('*')]
    .find(e => e.children.length === 0 && (e.textContent || '').trim() === 'yodaman');
  if (!el) return false;
  (el.closest('[class*=cursor], div') || el).click();
  return true;
})()
`;

/**
 * Blank anything that identifies the operator: absolute home paths and the
 * names of workspaces other than this project.
 */
const redactScript = `
(() => {
  // A MutationObserver, not a single pass.
  //
  // The dashboard polls live metrics, so React re-renders every few seconds
  // and restores the original text. A one-shot rewrite redacted the workspace
  // cards and then lost the sidebar and the vector-storage path to the next
  // render — a leak that looked like partial success, which is worse than
  // none, because it appears to have worked.
  const HOME = /\\/Users\\/[^/\\s"']+/g;

  const scrub = (root) => {
    let n = 0;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      if (!text) continue;
      const replaced = text.replace(HOME, '~');
      if (replaced !== text) { node.nodeValue = replaced; n += 1; }
    }
    return n;
  };

  let total = scrub(document.body);

  if (!window.__yodamanRedactObserver) {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData' && record.target.nodeValue) {
          const replaced = record.target.nodeValue.replace(HOME, '~');
          if (replaced !== record.target.nodeValue) record.target.nodeValue = replaced;
        }
        for (const added of record.addedNodes || []) {
          if (added.nodeType === Node.TEXT_NODE) {
            const replaced = (added.nodeValue || '').replace(HOME, '~');
            if (replaced !== added.nodeValue) added.nodeValue = replaced;
          } else if (added.nodeType === Node.ELEMENT_NODE) {
            scrub(added);
          }
        }
      }
    });
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true
    });
    window.__yodamanRedactObserver = observer;
  }

  return total;
})()
`;

async function capture(win, view) {
    const opened = await win.webContents.executeJavaScript(clickTabScript(view.tab));
    if (!opened) {
        // A renamed or removed tab must not produce a stale-but-plausible image.
        throw new Error(`Tab "${view.tab}" not found — the UI changed; update VIEWS in this script.`);
    }

    await new Promise((r) => setTimeout(r, view.settle));

    // Refuse to photograph a modal. File size cannot tell the difference
    // between the dashboard and an onboarding dialog over a blurred dashboard —
    // both are ~130KB — and that is exactly the picture this script shipped
    // once already.
    if (await win.webContents.executeJavaScript(modalIsOpen)) {
        throw new Error(`A modal is covering the app; ${view.file} would be a photo of the dialog.`);
    }

    // And confirm the view itself is on screen, so a click that silently did
    // nothing cannot pass as a capture.
    const present = await win.webContents.executeJavaScript(
        `document.body.innerText.toLowerCase().includes(${JSON.stringify(view.expect.toLowerCase())})`
    );
    if (!present) throw new Error(`${view.file}: expected to see "${view.expect}" after opening ${view.tab}.`);

    if (REDACT) {
        await win.webContents.executeJavaScript(redactScript);
        await new Promise((r) => setTimeout(r, 400));

        // Assert the leak is gone rather than assuming the observer won the
        // race with the next render. This is the check that would have caught
        // the half-redacted capture instead of shipping it.
        const leaked = await win.webContents.executeJavaScript(
            `(document.body.innerText.match(/\\/Users\\/[^/\\s"']+/g) || []).length`
        );
        if (leaked > 0) {
            throw new Error(`${view.file}: ${leaked} absolute home path(s) still visible — refusing to write a capture that leaks them.`);
        }
    }
    await new Promise((r) => setTimeout(r, 250));

    const image = await win.webContents.capturePage();
    const target = path.join(OUT_DIR, view.file);
    fs.writeFileSync(target, image.toPNG());

    const kb = Math.round(fs.statSync(target).size / 1024);
    if (kb < 10) throw new Error(`${view.file} is only ${kb}KB — the view probably did not render.`);
    console.log(`  ${view.file.padEnd(16)} ${kb}KB  ("${view.expect}" visible)`);
}

app.whenReady().then(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        show: false,
        webPreferences: { offscreen: false }
    });

    try {
        console.log(`Loading ${URL}`);
        await win.loadURL(URL);
        await new Promise((r) => setTimeout(r, 3000));

        // Loop rather than clicking twice and hoping: the carousel may already
        // have been advanced, and "I clicked something" is not "the modal closed".
        for (let attempt = 0; attempt < 6; attempt += 1) {
            if (!(await win.webContents.executeJavaScript(modalIsOpen))) break;
            await win.webContents.executeJavaScript(dismissOnboarding);
            await new Promise((r) => setTimeout(r, 700));
        }
        if (await win.webContents.executeJavaScript(modalIsOpen)) {
            throw new Error('Could not dismiss the onboarding modal — every capture would be of the dialog.');
        }

        const picked = await win.webContents.executeJavaScript(selectWorkspace);
        if (!picked) console.warn('  (no "yodaman" workspace found — capturing whatever is active)');
        await new Promise((r) => setTimeout(r, 2500));

        if (REDACT) {
            const scrubbed = await win.webContents.executeJavaScript(redactScript);
            console.log(`  redaction active (${scrubbed} node(s) on install)`);
        }

        console.log(`Capturing to ${path.relative(process.cwd(), OUT_DIR)}${REDACT ? ' (redacted)' : ' (NOT redacted)'}`);
        for (const view of VIEWS) await capture(win, view);

        console.log('Done.');
        app.exit(0);
    } catch (err) {
        console.error(`Capture failed: ${err.message}`);
        app.exit(1);
    }
});
