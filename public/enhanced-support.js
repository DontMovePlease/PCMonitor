'use strict';
(() => {
  const button = document.getElementById('installEnhancedSupport');
  const status = document.getElementById('enhancedSupportStatus');
  let busy = false;
  async function refresh() {
    if (busy) return;
    try {
      const response = await fetch('/api/temperature/enhanced', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/'); return; }
      if (!response.ok) throw new Error('failed');
      const data = await response.json();
      button.hidden = !data.localDesktop || !data.bundled;
      button.disabled = data.installing;
      status.textContent = !data.localDesktop ? 'Enhanced support must be installed from the PC Monitor desktop dashboard.'
        : !data.bundled ? 'Use the PC Monitor Windows installer to add Enhanced support.'
        : data.installing ? 'Installation is running or its result is unconfirmed. Check Windows on this PC.'
        : data.note || 'Install the optional signed PawnIO hardware-access driver using Windows UAC. CPU sensors may require administrator access.';
    } catch (_) { status.textContent = 'Could not check Enhanced support. Try refreshing Diagnostics.'; }
  }
  button.addEventListener('click', async () => {
    if (busy || !window.confirm('Install the optional PawnIO hardware-access driver on this PC? Windows will ask for administrator approval.')) return;
    busy = true; button.disabled = true;
    status.textContent = 'Approve the Windows UAC prompt on this PC. Installing Enhanced support…';
    try {
      const response = await fetch('/api/temperature/enhanced/install', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (response.status === 401) { window.location.replace('/'); return; }
      const result = await response.json();
      status.textContent = result.success ? result.rebootRequired ? 'Installed. Restart Windows to finish.' : 'Installed. CPU sensor status will update on the next active temperature sample.' : result.error || 'Installation could not be confirmed.';
      document.getElementById('refreshDiagnostics').click();
    } catch (_) { status.textContent = 'Installation result is unconfirmed. Check Windows on this PC before trying again.'; }
    finally { busy = false; button.disabled = false; }
  });
  window.addEventListener('pc-monitor-pagechange', event => { if (event.detail.page === 'diagnosticsPage') refresh(); });
  document.getElementById('refreshDiagnostics').addEventListener('click', refresh);
})();
