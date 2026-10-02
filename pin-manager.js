'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const validPin = value => typeof value === 'string' && (value.length === 6 || value.length === 12) && /^(?:\d{6}|\d{12})$/.test(value);
function dataDirectory(root = __dirname) {
  return fs.existsSync(path.join(root, 'installation.json')) ? path.join(root, '..', 'data') : root;
}
function readConfig(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe configuration file.');
  const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validPin(value.pin)) throw new Error('Invalid saved PIN configuration.');
  return value;
}
function generatePin(previous) {
  let pin;
  do { pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); } while (pin === previous);
  return pin;
}
function writeConfig(file, value) {
  if (!validPin(value.pin)) throw new Error('Invalid PIN.');
  const temp = file + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
    if (readConfig(file).pin !== value.pin) throw new Error('PIN persistence could not be verified.');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (_) {}
  }
}
function loadConfig(file) {
  try { return readConfig(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; } // Never replace malformed/inaccessible data.
  const value = { pin: generatePin() };
  writeConfig(file, value);
  return value;
}
function regeneratePin(root = __dirname) {
  const directory = dataDirectory(root);
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe data directory.');
  const file = path.join(directory, 'config.json');
  const value = readConfig(file);
  const pin = generatePin(value.pin);
  writeConfig(file, { ...value, pin });
  return pin;
}
if (require.main === module) {
  // Fixed native-local command. No PIN, path, or configuration fields accepted.
  try {
    if (process.argv.length !== 3) throw new Error('Invalid invocation.');
    if (process.argv[2] === '--regenerate') {
      regeneratePin();
      process.stdout.write('PIN updated. Open the local Setup window to view it.\n');
    } else if (['--desktop-pin-on', '--desktop-pin-off'].includes(process.argv[2])) {
      // Fixed installer-only preference, one canonical config/PIN. No PIN arguments.
      const file = path.join(dataDirectory(), 'config.json');
      const saved = loadConfig(file);
      writeConfig(file, { ...saved, requireDesktopPin: process.argv[2] === '--desktop-pin-on', desktopLocked: false });
      process.stdout.write('Desktop PIN preference saved.\n');
    } else throw new Error('Invalid invocation.');
  } catch (_) { process.stderr.write('PIN update failed; check the saved configuration locally.\n'); process.exitCode = 1; }
}
// Only the fixed Windows helper can unwrap the current Windows user's DPAPI
// credential. It is never sent to the canonical frontend or placed in a URL.
let desktopTrustPromise;
function desktopTrust() {
  if (!desktopTrustPromise) desktopTrustPromise = new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(null);
    require('child_process').execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', 'native-trust.ps1')],
      { windowsHide: true, timeout: 15000, maxBuffer: 4096 }, (error, stdout) => {
        const key = String(stdout || '').trim();
        resolve(!error && /^[A-Za-z0-9+/]{43}=$/.test(key) ? key : null);
      });
  });
  return desktopTrustPromise;
}
module.exports = { validPin, generatePin, readConfig, writeConfig, loadConfig, dataDirectory, regeneratePin, desktopTrust };
