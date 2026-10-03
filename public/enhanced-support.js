'use strict';
(() => {
  const button = document.getElementById('installEnhancedSupport');
  const status = document.getElementById('enhancedSupportStatus');
  let busy = false;
  let checking = false;
  let support = null;
  function renderActions() {
    for (const container of document.querySelectorAll('[data-enhanced-actions]')) {
      container.replaceChildren();
      if (!window.chrome?.webview || !support?.localDesktop) continue;
      const note = document.createElement('p');
      if (support.installing) {
        note.textContent = 'Installation is pending or unconfirmed. Check Windows before retrying.';
      } else if (support.driverInstalled === false && !support.bundled) {
        const download = document.createElement('a'); download.textContent = 'Download PawnIO';
        download.href = 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe';
        download.target = '_blank'; download.rel = 'noopener noreferrer'; container.append(download);
        note.textContent = 'Optional CPU temperature support. Opens the approved official 2.2.0 download in your browser. Run the signed Official edition only; never choose Unrestricted. Then re-check.';
      } else if (support.driverInstalled === false && support.bundled) {
        const install = document.createElement('button'); install.type = 'button'; install.textContent = 'Install PawnIO';
        install.disabled = busy || support.installing; install.addEventListener('click', () => button.click()); container.append(install);
        note.textContent = 'Uses the bundled, verified signed installer. Windows UAC approval is required. CPU sensor support is not guaranteed.';
      } else {
        note.textContent = support.installing ? 'Installation is pending or unconfirmed. Check Windows before retrying.'
          : support.driverInstalled === true ? support.sensor === 'available' ? 'PawnIO and CPU temperature sensing are available.' : 'PawnIO is installed. A missing sensor may be a hardware or permission limitation; reinstalling is not a verified fix.'
          : 'Driver detection is unconfirmed. Re-check before installing anything.';
      }
      const recheck = document.createElement('button'); recheck.type = 'button'; recheck.textContent = 'Re-check';
      recheck.disabled = busy || support.installing;
      recheck.addEventListener('click', () => document.getElementById('refreshDiagnostics').click());
      container.append(recheck, note);
    }
  }
  async function refresh() {
    if (busy || checking) return;
    checking = true;
    try {
      const response = await fetch('/api/temperature/enhanced', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/'); return; }
      if (!response.ok) throw new Error('failed');
      const data = await response.json();
      support = data;
      button.hidden = !data.localDesktop || !data.bundled || data.driverInstalled === true;
      button.disabled = data.installing;
      status.textContent = !data.localDesktop ? 'Enhanced support must be installed from the Rovarin desktop dashboard.'
        : !data.bundled ? 'Use the Rovarin Windows installer to add Enhanced support.'
        : data.installing ? 'Installation is running or its result is unconfirmed. Check Windows on this PC.'
        : data.note || 'Install the optional signed PawnIO hardware-access driver using Windows UAC. CPU sensors may require administrator access.';
    } catch (_) { support = null; button.hidden = true; status.textContent = 'Could not check Enhanced support. Try refreshing Diagnostics.'; }
    finally { checking = false; renderActions(); }
  }
  button.addEventListener('click', async () => {
    if (busy || !window.confirm('Install the optional PawnIO hardware-access driver on this PC? Windows will ask for administrator approval.')) return;
    busy = true; button.disabled = true;
    renderActions();
    status.textContent = 'Approve the Windows UAC prompt on this PC. Installing Enhanced support…';
    try {
      const response = await fetch('/api/temperature/enhanced/install', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (response.status === 401) { window.location.replace('/'); return; }
      const result = await response.json();
      status.textContent = result.success ? result.rebootRequired ? 'Installed. Restart Windows to finish.' : 'Installed. CPU sensor status will update on the next active temperature sample.' : result.error || 'Installation could not be confirmed.';
    } catch (_) { status.textContent = 'Installation result is unconfirmed. Check Windows on this PC before trying again.'; }
    finally { busy = false; await refresh(); document.getElementById('refreshDiagnostics').click(); }
  });
  window.addEventListener('pc-monitor-pagechange', event => { if (event.detail.page === 'diagnosticsPage') refresh(); });
  document.getElementById('refreshDiagnostics').addEventListener('click', refresh);
  window.addEventListener('rovarin-diagnostics-rendered', renderActions);
})();
