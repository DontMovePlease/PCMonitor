// Test-only harness; never included in the installer. Exercises the exact
// packaged Form/WebView2 and real authenticated frontend in an owned fixture.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
internal static class NativeDesktopTest
{
    static Form form; static Type window; static string origin; static int result = 1;
    static BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd,int message,IntPtr wparam,IntPtr lparam);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd,int index);
    static WebView2 View { get { return (WebView2)window.GetField("view", flags).GetValue(form); } }
    static void Check(bool test, string message) { if (!test) throw new Exception(message); }
    static void Invoke(string method) { window.GetMethod(method, flags).Invoke(form, null); }
    static async Task<bool> Condition(string script) {
        try { return await View.CoreWebView2.ExecuteScriptAsync(script) == "true"; } catch { return false; }
    }
    static async Task Wait(string script, string label, int seconds = 12) {
        var limit = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < limit) { if (await Condition(script)) return; await Task.Delay(100); }
        throw new Exception(label + "; pending=" + window.GetField("visibilityPending",flags).GetValue(form) + "; loading=" + window.GetField("loading",flags).GetValue(form) + "; visible=" + form.Visible + "; doc=" + await View.CoreWebView2.ExecuteScriptAsync("document.visibilityState"));
    }
    static async Task<int> Leases() {
        // ExecuteScript doesn't await promises. Use a test-only fixed scratch value.
        await View.CoreWebView2.ExecuteScriptAsync("window.__qaLeases=null;void fetch('/api/monitoring/status').then(r=>r.json()).then(x=>window.__qaLeases=x.leaseCount)");
        await Wait("Number.isInteger(window.__qaLeases)", "Status read failed");
        return Int32.Parse(await View.CoreWebView2.ExecuteScriptAsync("window.__qaLeases"));
    }
    static async Task WaitLeases(bool active) {
        var limit = DateTime.UtcNow.AddSeconds(12);
        while (DateTime.UtcNow < limit) {
            View.CoreWebView2.Resume();
            if ((await Leases() > 0) == active) return;
            await Task.Delay(200);
        }
        throw new Exception((active ? "Lease did not recover" : "Hidden window retained lease") + "; count=" + await Leases() + "; state=" + await View.CoreWebView2.ExecuteScriptAsync("JSON.stringify({lease:window.monitoringLeaseId,visible:dashboardClientVisible(),profile:desiredMonitoringProfile})"));
    }
    [STAThread] static int Main() {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        var assembly = Assembly.LoadFrom(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"PCMonitor.exe"));
        window = assembly.GetType("DesktopWindow");
        form = (Form)Activator.CreateInstance(window, true);
        var json = new JavaScriptSerializer();
        var saved = json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..","data","config.json")));
        string pin = (string)saved["pin"];
        form.Shown += async delegate {
            try {
                var deadline=DateTime.UtcNow.AddSeconds(45);
                while((View==null || View.CoreWebView2==null) && DateTime.UtcNow<deadline) await Task.Delay(100);
                Check(View!=null && View.CoreWebView2!=null,"WebView2 did not initialize");
                origin=(string)window.GetField("origin",flags).GetValue(form);
                await Wait("location.origin==="+json.Serialize(origin)+" && document.readyState==='complete'", "Login document not ready");
                Check(View.CoreWebView2.Source.StartsWith(origin),"Wrong dashboard origin");
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaAuth=null;void fetch('/api/metrics').then(r=>window.__qaAuth=r.status)");
                await Wait("window.__qaAuth===401", "Native shell bypassed authentication");
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaLogin=null;void fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:"+json.Serialize(pin)+"})}).then(r=>window.__qaLogin=r.status)");
                await Wait("window.__qaLogin===200", "Native PIN login failed");
                View.CoreWebView2.Navigate(origin+"/");
                await Wait("document.readyState==='complete' && !!window.monitoringLeaseId", "Dashboard did not acquire lease",30);
                await WaitLeases(true);
                await Wait("eventSource?.readyState===1", "Native SSE did not connect");
                Console.WriteLine("PASS native dashboard/authentication ready");
                Check(form.FormBorderStyle==FormBorderStyle.None && !form.ControlBox,"Windows caption/control box remains");
                Check((GetWindowLong(form.Handle,-16)&0xC00000)==0,"Windows caption style remains");
                Check(form.ClientSize==form.Size,"Native UI does not reach window edges");
                Check(View.Bounds==form.ClientRectangle,"WebView does not fill client area");
                Check(View.CoreWebView2.Settings.IsNonClientRegionSupportEnabled && !View.AllowExternalDrop,"Native drag/drop settings incorrect");
                await Wait("document.documentElement.classList.contains('native-shell') && getComputedStyle(document.querySelector('.native-app-bar')).display==='flex' && document.querySelector('.native-app-bar').getBoundingClientRect().top===0", "Integrated native bar missing");
                await Wait("getComputedStyle(document.querySelector('.native-app-bar')).getPropertyValue('app-region')==='drag' && getComputedStyle(document.getElementById('nativeSettingsButton')).getPropertyValue('app-region')==='no-drag'", "Native drag region/settings hit target incorrect");
                await Wait("getComputedStyle(document.documentElement).scrollbarWidth==='none' && getComputedStyle(document.body).scrollbarWidth==='none'", "Visual scrollbar not hidden");
                await Wait("!document.querySelector('.live-pill') && !document.querySelector('.header-bar') && !!document.getElementById('logoutButton').closest('#securitySettingsPanel') && !!document.getElementById('nativeSettingsButton').closest('.native-app-bar')", "Top bar/security placement incorrect");
                await View.CoreWebView2.ExecuteScriptAsync("setSidebarOpen(false);document.getElementById('sidebarToggle').click()");
                await Wait("document.body.classList.contains('sidebar-expanded') && localStorage.getItem('pc-monitor-sidebar-expanded')==='true' && getComputedStyle(document.querySelector('.app-sidebar span')).display!=='none'", "Desktop sidebar did not expand/persist");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('sidebarToggle').click()");
                await Wait("!document.body.classList.contains('sidebar-expanded') && localStorage.getItem('pc-monitor-sidebar-expanded')==='false'", "Desktop sidebar did not collapse/persist");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-page=maintenancePage]').click()");
                await Wait("!document.getElementById('maintenancePage').hidden && document.querySelectorAll('#maintenanceMount .maint-action-card').length>0", "Maintenance sidebar navigation/actions missing");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-page=dashboardPage]').click()");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('.host-details').open=true;scrollTo(0,160)");
                await Wait("scrollY>0", "Normal document scrolling was disabled");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('.host-details').open=false;scrollTo(0,0);document.getElementById('nativeSettingsButton').click()");
                await Wait("!document.getElementById('diagnosticsPage').hidden && document.activeElement.id==='monitorSettings'", "Settings did not reuse existing preferences");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('securitySettingsTab').click()");
                await Wait("!document.getElementById('securitySettingsPanel').hidden && !document.getElementById('nativeSecurityControls').hidden && !document.getElementById('desktopPinPreference').disabled && document.getElementById('desktopPinPreference').checked", "Native Security did not load authenticated default preference");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('generalSettingsTab').click()");
                // Fixture only: exercise actual native credential -> HttpOnly cookie
                // provisioning, not merely the API or a frontend/class flag.
                var nativeRequest = window.GetMethod("NativeRequestAsync", flags);
                var preferenceOff = (Task<System.Collections.Generic.Dictionary<string,object>>)nativeRequest.Invoke(form, new object[] { "/api/desktop/security", new { action="preference", requireDesktopPin=false, confirmed=true } });
                await preferenceOff;
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaReleased=false;void releaseMonitoringLease().then(()=>window.__qaReleased=true)");
                await Wait("window.__qaReleased===true", "Pre-auto-login lease release failed");
                View.CoreWebView2.CookieManager.DeleteAllCookies();
                await (Task)window.GetMethod("StartAsync", flags).Invoke(form,new object[] { false });
                await Wait("document.readyState==='complete' && !!window.monitoringLeaseId && !!document.getElementById('dashboardPage')", "Trusted native optional auto-login failed",30);
                var preferenceOn = (Task<System.Collections.Generic.Dictionary<string,object>>)nativeRequest.Invoke(form, new object[] { "/api/desktop/security", new { action="preference", requireDesktopPin=true, confirmed=true } });
                await preferenceOn;
                View.CoreWebView2.Navigate(origin+"/");
                await Wait("document.readyState==='complete' && !!document.getElementById('pinInput')", "Re-enabled native PIN did not show login");
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaLogin=null;void fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:"+json.Serialize(pin)+"})}).then(r=>window.__qaLogin=r.status)");
                await Wait("window.__qaLogin===200", "Canonical PIN failed after re-enable");
                View.CoreWebView2.Navigate(origin+"/");
                await Wait("document.readyState==='complete' && !!window.monitoringLeaseId", "Dashboard did not return after re-enable",30);
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('nativeSettingsButton').click()");
                Console.WriteLine("PASS actual native passwordless cookie provisioning and PIN re-enable");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('nativeBackButton').click()");
                await Wait("!document.getElementById('dashboardPage').hidden && !document.getElementById('nativeForwardButton').disabled", "Back did not return to dashboard");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('nativeForwardButton').click()");
                await Wait("!document.getElementById('diagnosticsPage').hidden", "Forward did not restore settings page");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('nativeBackButton').click();showAppPage('processesPage')");
                await Wait("document.getElementById('nativeForwardButton').disabled", "New navigation did not discard forward history");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-page=dashboardPage]').click();scrollTo(0,0)");
                Console.WriteLine("PASS page Back/Forward, branch history and Settings navigation");
                // Change only this disposable fixture's canonical frontend. The
                // running shell must see it through the ordinary backend revision.
                string assetPath=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"public","app.js");
                byte[] originalAsset=File.ReadAllBytes(assetPath);
                try {
                    File.AppendAllText(assetPath,"\nwindow.__qaSharedFrontend='updated';\n");
                    await View.CoreWebView2.ExecuteScriptAsync("void checkDashboardUpdate()");
                    await Wait("window.__qaSharedFrontend==='updated' && !!window.monitoringLeaseId", "Native shared frontend update did not reload",45);
                    await Wait("eventSource?.readyState===1", "SSE did not recover after frontend update");
                } finally { File.WriteAllBytes(assetPath,originalAsset); }
                await Task.Delay(5100);
                await View.CoreWebView2.ExecuteScriptAsync("void checkDashboardUpdate()");
                await Wait("typeof window.__qaSharedFrontend==='undefined' && !!window.monitoringLeaseId", "Restored canonical frontend did not reload",45);
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('openCpuDetailButton').click()");
                await Wait("cpuDetailDialog.open && cpuDetailProfileReady", "Native CPU detail did not activate");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('closeCpuDetailButton').click()");
                await Wait("!cpuDetailDialog.open", "Native CPU detail did not close");
                Check(form.Text=="PC Monitor" && form.MinimumSize.Width>=760 && form.Width==980 && form.Height==740,"Window chrome/compact default size incorrect");
                Check(!View.CoreWebView2.Settings.AreDevToolsEnabled && !View.CoreWebView2.Settings.AreHostObjectsAllowed,"Unsafe native bridge/settings");
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaApi=null;void Promise.all(['/api/metrics','/api/diagnostics','/api/maintenance/status','/api/maintenance/history'].map(p=>fetch(p,{headers:{'X-Monitor-Lease':window.monitoringLeaseId}}).then(r=>r.status))).then(x=>window.__qaApi=x.every(s=>s===200))");
                await Wait("window.__qaApi===true", "Existing API regression");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-page=processesPage]').click()");
                await Wait("document.getElementById('processesPage')?.hidden===false", "Processes page navigation failed");
                await Wait("document.querySelector('.processes-killbar').getBoundingClientRect().bottom<=innerHeight && getComputedStyle(document.querySelector('.processes-table-wrap')).overflowY==='auto'", "Processes controls require outer-page scrolling");
                await Task.Delay(500);
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaProcesses=null;void fetch('/api/processes',{headers:{'X-Monitor-Lease':window.monitoringLeaseId}}).then(r=>window.__qaProcesses=r.status)");
                await Wait("window.__qaProcesses===200", "Processes API unavailable");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-page=dashboardPage]').click()");
                await View.CoreWebView2.ExecuteScriptAsync("scrollTo(0,0)");
                using(var image=File.Create(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"native-dashboard.png")))
                    await View.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
                // Phone-sized presentation of the SAME document; no native bar.
                var desktopSize=form.Size; var desktopMinimum=form.MinimumSize;
                form.MinimumSize=new System.Drawing.Size(320,400); form.Size=new System.Drawing.Size(390,844);
                await View.CoreWebView2.ExecuteScriptAsync("document.documentElement.classList.remove('native-shell');document.body.style.setProperty('--app-safe-top','47px');scrollTo(0,0)");
                await Wait("innerWidth<=430 && document.documentElement.scrollWidth<=innerWidth && !document.body.classList.contains('sidebar-expanded') && getComputedStyle(document.querySelector('.app-sidebar')).visibility==='hidden'", "Shared mobile presentation overflow/closed drawer");
                await Wait("document.querySelector('.native-app-bar').getBoundingClientRect().height===93 && document.getElementById('sidebarToggle').getBoundingClientRect().top>=47 && document.getElementById('sidebarToggle').contains(document.elementFromPoint(document.getElementById('sidebarToggle').getBoundingClientRect().left+22,document.getElementById('sidebarToggle').getBoundingClientRect().top+22))", "iPhone safe-area menu button obscured");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('sidebarToggle').click()");
                await Wait("document.body.classList.contains('sidebar-expanded') && !document.getElementById('sidebarBackdrop').hidden", "Mobile drawer did not open");
                await Wait("document.getElementById('appSidebar').getBoundingClientRect().top===93 && Math.abs(document.getElementById('appSidebar').getBoundingClientRect().left)<1 && document.getElementById('sidebarBackdrop').getBoundingClientRect().top===93 && getComputedStyle(document.getElementById('sidebarBackdrop')).opacity==='1'", "Phone drawer/backdrop safe-area alignment or animation failed");
                using(var image=File.Create(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"native-mobile-drawer.png")))
                    await View.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('sidebarBackdrop').click()");
                await Wait("!document.body.classList.contains('sidebar-expanded') && getComputedStyle(document.getElementById('sidebarBackdrop')).pointerEvents==='none' && getComputedStyle(document.getElementById('appSidebar')).visibility==='hidden'", "Phone drawer did not close cleanly on outside tap");
                await View.CoreWebView2.ExecuteScriptAsync("document.getElementById('sidebarToggle').click()");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-page=diagnosticsPage]').click()");
                await Wait("!document.body.classList.contains('sidebar-expanded') && !document.getElementById('diagnosticsPage').hidden", "Mobile drawer did not close after navigation");
                await View.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-page=dashboardPage]').click()");
                using(var image=File.Create(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"native-mobile.png")))
                    await View.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
                form.MinimumSize=desktopMinimum; form.Size=desktopSize;
                await View.CoreWebView2.ExecuteScriptAsync("document.body.style.removeProperty('--app-safe-top');document.documentElement.classList.add('native-shell')");
                // The same SC_CLOSE path used by Alt+F4 hides to tray, preserving Node.
                SendMessage(form.Handle,0x112,new IntPtr(0xF060),IntPtr.Zero);
                await Task.Delay(100);
                Check(!form.Visible,"System close did not hide to tray");
                View.CoreWebView2.Resume();
                await Wait("!dashboardClientVisible()", "Hidden desktop did not hide client");
                await WaitLeases(false);
                Invoke("OpenWindow");
                await Wait("dashboardClientVisible()", "Tray reopen did not show client");
                await WaitLeases(true);
                form.WindowState=FormWindowState.Minimized;
                View.CoreWebView2.Resume();
                await Wait("!dashboardClientVisible()", "Minimized desktop did not hide client");
                await WaitLeases(false);
                Invoke("OpenWindow"); await WaitLeases(true);
                // Embedded remote/file navigation is rejected without changing origin.
                View.CoreWebView2.Navigate("file:///C:/Windows/win.ini"); await Task.Delay(300);
                Check(View.CoreWebView2.Source.StartsWith(origin),"Untrusted navigation accepted");
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaLogout=null;void fetch('/api/logout',{method:'POST'}).then(r=>window.__qaLogout=r.status)");
                await Wait("window.__qaLogout===200", "Logout failed");
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaRevoked=null;void fetch('/api/metrics').then(r=>window.__qaRevoked=r.status)");
                await Wait("window.__qaRevoked===401", "Revoked native cookie accepted");
                await View.CoreWebView2.ExecuteScriptAsync("window.__qaLogin=null;void fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:"+json.Serialize(pin)+"})}).then(r=>window.__qaLogin=r.status)");
                await Wait("window.__qaLogin===200", "Session persistence setup failed");
                var exitButton=(Button)window.GetField("desktopExit",flags).GetValue(form);
                Check(exitButton.Visible && exitButton.AccessibleName=="Exit desktop app","Native top-right X missing");
                Console.WriteLine("PASS native borderless edges, draggable shared top bar, existing Settings, hidden scrollbars with scrolling, system-close/tray reopen, PIN auth/revocation, APIs, CPU detail, SSE, processes navigation, lease release, restricted navigation");
                result=0;
                exitButton.PerformClick();
                Check((bool)window.GetField("exiting",flags).GetValue(form),"Top-right X did not request shell-only exit");
            } catch(Exception error) { result=1; Console.Error.WriteLine(error.Message); }
            finally { Invoke("ExitShell"); }
        };
        Application.Run(form); form.Dispose(); return result;
    }
}

