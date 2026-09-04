/**
 * End-to-end check in a real browser.
 *
 * Renders a transmission to a WAV, hands it to Chrome as a fake microphone,
 * drives the actual UI, and waits for the decoded text to appear on the page.
 * This is the only test that exercises the AudioWorklet, the real audio graph
 * and the React layer together.
 */
import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MESSAGE = process.env.MSG || 'WhisperWave browser check 42';
const PROFILE = process.env.PROFILE || 'stealth';
const ORIGIN = process.env.ORIGIN || 'http://localhost:4173';
const work = mkdtempSync(join(tmpdir(), 'ww-browser-'));

async function bundle(entry, outfile) {
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'warning' });
  return outfile;
}

const wav = join(work, 'mic.wav');
const mk = await bundle('scripts/make-wav.ts', join(work, 'make-wav.mjs'));
const r = spawnSync(process.execPath, [mk, PROFILE, MESSAGE, wav, '48000'], { stdio: 'inherit' });
if (r.status !== 0 || !existsSync(wav)) throw new Error('could not render the fake microphone WAV');

const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find((p) => existsSync(p));
if (!chrome) throw new Error('no Chrome binary found');

const profileDir = join(work, 'profile');
const args = [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=9333',
  `--user-data-dir=${profileDir}`,
  '--window-size=1400,1000',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}%noloop`,
  'about:blank',
];
const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
proc.stderr.on('data', (d) => { stderr += d.toString(); });

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://localhost:9333/json/list');
      const list = await res.json();
      if (list.length) return list;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`Chrome did not expose a debugging target.\n${stderr.slice(0, 800)}`);
}

const list = await targets();
const page = list.find((t) => t.type === 'page') || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP socket failed')); });

let nextId = 1;
const pending = new Map();
const consoleLines = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    consoleLines.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push(`EXCEPTION: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression, userGesture = false) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate failed');
  return res.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: ORIGIN });
await sleep(2500);

const heading = await evaluate("document.querySelector('h1, .text-\\\\[0\\\\.95rem\\\\]')?.textContent ?? document.title");
console.log(`  page loaded: ${heading}`);

const rendered = await evaluate("document.getElementById('root')?.children.length > 0");
if (!rendered) throw new Error(`React did not render.\n${consoleLines.join('\n')}`);
console.log('  react mounted');

// The receiver decodes whichever profile the UI is tuned to, so select it
// before opening the microphone.
const NAMES = { ghost: 'Ghost', stealth: 'Stealth', balanced: 'Balanced', longrange: 'Long Range' };
const tuned = await evaluate(
  `(() => { const b = [...document.querySelectorAll('[role="radio"]')].find(x => x.textContent.startsWith(${JSON.stringify(NAMES[PROFILE])})); if (!b) return false; b.click(); return true; })()`,
  true,
);
if (!tuned) throw new Error(`could not select the ${PROFILE} profile`);
console.log(`  tuned to ${NAMES[PROFILE]}`);

const clicked = await evaluate(
  `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Start listening'); if (!b) return false; b.click(); return true; })()`,
  true,
);
if (!clicked) throw new Error('could not find the Start listening button');
console.log('  microphone started, waiting for a decode…');

let found = false;
const budget = Number(process.env.WAIT_S || 60) * 2;
for (let i = 0; i < budget; i++) {
  await sleep(500);
  found = await evaluate(`document.body.innerText.includes(${JSON.stringify(MESSAGE)})`);
  if (found) break;
}

const phase = await evaluate(`(document.body.innerText.match(/receiver: (\\w+)/) || [])[1] ?? '?'`);
await send('Page.captureScreenshot', { format: 'png' })
  .then((s) => writeFileSync(process.env.SHOT || join(work, 'shot.png'), Buffer.from(s.data, 'base64')))
  .catch(() => {});

proc.kill();

const errors = consoleLines.filter((l) => /EXCEPTION|error:/i.test(l));
if (errors.length) console.log('  console:\n    ' + errors.join('\n    '));

if (found) {
  console.log(`\n  PASS  decoded "${MESSAGE}" in a real browser (receiver phase: ${phase})`);
  process.exit(0);
}
console.log(`\n  FAIL  no decode after ${budget / 2} s (receiver phase: ${phase})`);
console.log(consoleLines.slice(-20).join('\n'));
process.exit(1);
