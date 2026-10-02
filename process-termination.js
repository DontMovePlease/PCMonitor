'use strict';
const { execFile } = require('child_process');
const path = require('path');

function terminateProcess(identity, execute = execFile) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ success: false, code: 'unavailable' });
    try {
      const child = execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', 'terminate-process.ps1')],
        { windowsHide: true, timeout: 15000, maxBuffer: 16384 }, (error, stdout) => {
          try {
            const result = JSON.parse(String(stdout).trim());
            const codes = ['terminated', 'already-exited', 'stale-process', 'access-denied', 'termination-unconfirmed', 'server-error'];
            if (error || !codes.includes(result.code) || result.success !== (result.code === 'terminated') || (result.success && result.verified !== true)) throw new Error();
            resolve({ success: result.success, code: result.code, verified: result.verified === true });
          } catch (_) { resolve({ success: false, code: 'termination-unconfirmed' }); }
        });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(identity));
    } catch (_) { resolve({ success: false, code: 'server-error' }); }
  });
}
module.exports = { terminateProcess };
