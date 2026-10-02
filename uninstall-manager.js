'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Only an installer-created installation may hand off to its Inno uninstaller.
// The helper revalidates hashes, paths, registration and the exact process handle.
class UninstallManager {
  constructor({ root = __dirname, launch = spawn } = {}) {
    this.root = root; this.launch = launch; this.busy = false; this.accepted = false;
  }
  status() {
    let installed = false;
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(this.root, 'installation.json'), 'utf8'));
      installed = marker.schema === 1 && marker.channel === 'windows-x64' &&
        fs.existsSync(path.join(this.root, 'uninstall-trust.json'));
    } catch (_) {}
    return { installed, available: process.platform === 'win32' && installed, uninstalling: this.busy };
  }
  async prepare(removeData) {
    if (this.busy) throw new Error('uninstall-in-progress');
    if (!this.status().available) throw new Error('installed-only');
    this.busy = true;
    let child;
    let recordCreated = false;
    const file = path.join(this.root, '..', 'data', 'uninstall-handoff.json');
    const nonce = crypto.randomBytes(32).toString('hex');
    const record = { schema: 1, ownerPid: process.pid, nonce, removeData, phase: 'preparing' };
    const read = () => {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.nonce !== nonce || saved.ownerPid !== process.pid) throw new Error('handoff-mismatch');
      return saved;
    };
    const write = async phase => {
      const temporary = file + '.' + nonce + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify({ ...record, phase }), { flag: 'wx' });
        for (let i = 0; ; i++) {
          try { fs.renameSync(temporary, file); break; }
          catch (error) { if (i >= 20 || !['EACCES','EPERM','EBUSY'].includes(error.code)) throw error; await pause(10); }
        }
      } finally { try { fs.unlinkSync(temporary); } catch (_) {} }
    };
    try {
      const dataDirectory = path.dirname(file);
      if (fs.realpathSync(dataDirectory).toLowerCase() !== path.resolve(dataDirectory).toLowerCase() || fs.lstatSync(dataDirectory).isSymbolicLink()) throw new Error('unsafe-data');
      const trust = JSON.parse(fs.readFileSync(path.join(this.root, 'uninstall-trust.json'), 'utf8'));
      const helper = path.join(this.root, 'scripts/installed-uninstall.ps1');
      if (fs.lstatSync(helper).isSymbolicLink() || fs.realpathSync(helper).toLowerCase() !== path.resolve(helper).toLowerCase()) throw new Error('helper-invalid');
      if (crypto.createHash('sha256').update(fs.readFileSync(helper)).digest('hex') !== trust.hashes['app\\scripts\\installed-uninstall.ps1']) throw new Error('helper-invalid');
      // Fixed leaf record, no credentials or arbitrary paths/arguments. Rename
      // replaces an entry rather than following a client/user-created symlink.
      await write('preparing');
      recordCreated = true;
      const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        helper, '-Mode', 'Launch'];
      // A short starter uses Windows Start-Process (also used by the existing
      // launcher). The worker has no Node pipes/console lifetime dependency.
      child = this.launch(command, args, { cwd: path.dirname(this.root), windowsHide: true, stdio: 'ignore' });
      let launchError = false;
      child.once('error', () => { launchError = true; });
      child.once('exit', code => { if (code !== 0) launchError = true; });
      const deadline = Date.now() + 15000;
      for (;;) {
        const state = read();
        if (launchError || state.phase === 'failed' || Date.now() >= deadline) throw new Error('handoff-unavailable');
        if (state.phase === 'ready') break;
        await pause(100);
      }
      child.unref();
      let settled = false;
      return {
        commit: async () => {
          if (settled) return; settled = true;
          if (read().phase !== 'ready') throw new Error('commit-unconfirmed');
          await write('committed'); this.accepted = true;
        },
        abort: async () => {
          if (settled) return; settled = true;
          try { await write('aborted'); } finally { this.busy = false; }
        }
      };
    } catch (_) {
      if (child) child.unref();
      if (recordCreated) { try { await write('aborted'); } catch (_) {} }
      this.busy = false;
      throw new Error('handoff-unavailable');
    }
  }
}
module.exports = { UninstallManager };
