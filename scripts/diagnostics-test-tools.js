'use strict';
// Test-only preload. Never loaded by the application or development launcher.
const assert = require('assert');
const childProcess = require('child_process');
const os = require('os');
os.networkInterfaces = () => ({});
const mode = process.env.PC_MONITOR_DIAGNOSTICS_FIXTURE;
let tailscaleChecks = 0;
childProcess.execFile = (command, args, options, callback) => {
  assert(options.timeout > 0 && options.timeout <= 12000);
  assert(options.maxBuffer > 0);
  assert(!options.shell);
  console.log(`DIAGNOSTICS_TEST_TOOL:${require('path').basename(command)}`);
  const startup = args.some(arg => arg.includes('Win32_OperatingSystem'));
  let error = null, output = '';
  if (mode.startsWith('collector-')) {
    const kind = mode.slice('collector-'.length);
    const failing = command === 'powershell.exe' || command === 'netstat' || command === 'ping' || command.includes('tailscale');
    if (failing && kind === 'throws') throw Object.assign(new Error('test synchronous failure'), { code: 'ENOENT' });
    if (failing && ['missing', 'failed', 'timeout'].includes(kind)) error = Object.assign(new Error('test tool failure'), { code: kind === 'missing' ? 'ENOENT' : kind === 'timeout' ? 'ETIMEDOUT' : 1, killed: kind === 'timeout' });
    else if (failing && kind === 'malformed') output = 'unreadable-output';
    else if (failing && kind === 'empty') output = '';
    else if (startup) output = JSON.stringify({ caption: 'Microsoft Windows 11 Professionnel', cores: 6, gpus: ['NVIDIA Test GPU'] });
    else if (command === 'powershell.exe' && args.join(' ').includes('WorkingSet64')) output = JSON.stringify([{ Id: 123456, ProcessName: 'fixture', CPU: 1.25, WorkingSet64: 1048576, StartedAt: '2026-09-30T12:00:00.0000000Z' }]);
    else if (command === 'powershell.exe') output = JSON.stringify({ admin: false, processCollector: true });
    else if (command === 'netstat') output = 'Statistiques\n\tReçus\tEnvoyés\n Octets\t12345\t67890\n Paquets\t10\t20';
    else if (command === 'ping') output = 'Réponse de 1.1.1.1 : octets=32 temps<1 ms TTL=57';
    else if (command.includes('tailscale')) output = JSON.stringify({ BackendState: 'Running', TailscaleIPs: ['100.64.1.2'] });
    else output = 'NVIDIA Test GPU, 10, 5, 6144, 1024, 5120, 55';
  }
  else if (mode === 'missing') error = Object.assign(new Error('secret-path-C:\\private\\tool.exe'), { code: 'ENOENT' });
  else if (mode === 'failed') error = Object.assign(new Error('secret failure'), { code: 'ETIMEDOUT', killed: true });
  else if (mode === 'throws') throw Object.assign(new Error('secret sync failure'), { code: 'ENOENT' });
  else if (mode === 'malformed') output = 'not-json-or-counters';
  else if (startup) output = JSON.stringify({ caption: 'Microsoft Windows 11 Pro', cores: 6, gpus: ['Intel UHD Graphics', 'NVIDIA Test GPU'] });
  else if (command.includes('tailscale')) output = JSON.stringify({ BackendState: mode === 'offline' || (mode === 'recheck' && ++tailscaleChecks === 1) ? 'NeedsLogin' : 'Running', Self: { TailscaleIPs: ['100.64.1.2'], UserID: 'secret-account' }, Peers: ['secret-peer'] });
  else if (command.includes('nvidia')) output = 'NVIDIA Test GPU, 10, 5, 6144, 1024, 5120, 55';
  else if (command === 'netstat') output = 'Bytes 12345 67890';
  else if (command === 'powershell.exe') output = JSON.stringify({ admin: false, processCollector: true });
  setTimeout(() => callback(error, output, ''), 20);
  return { kill() {}, once() {} };
};
