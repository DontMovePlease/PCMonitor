param([switch]$UiSmoke)
$ErrorActionPreference = 'Stop'
try {
    # CreateNoWindow suppresses only the console. WSH's SW_HIDE also hides WinForms.
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $script = Join-Path $PSScriptRoot 'release-manager.ps1'
    $info.Arguments = '-NoProfile -STA -ExecutionPolicy Bypass -File "' + $script + '" -Mode Gui'
    if ($UiSmoke -or $env:PC_MONITOR_RELEASE_UI_SMOKE -eq '1') { $info.Arguments += ' -UiSmoke' }
    $info.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardOutput = $true
    $child = [Diagnostics.Process]::Start($info)
    try {
        $errorRead = $child.StandardError.ReadToEndAsync()
        $outputRead = $child.StandardOutput.ReadToEndAsync()
        $child.WaitForExit()
        $reason = $errorRead.Result + "`r`n" + $outputRead.Result
        if ($child.ExitCode -ne 0) { throw "Release Manager failed (exit $($child.ExitCode)).`r`n$reason" }
    } finally { $child.Dispose() }
} catch {
    if ($UiSmoke -or $env:PC_MONITOR_RELEASE_UI_SMOKE -eq '1') { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
    Add-Type -AssemblyName System.Windows.Forms
    # This bootstrap itself inherits WSH's SW_HIDE; explicitly show its error form.
    Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class ReleaseStartupError {
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int mode);
    public static void Show(string reason) {
        using(var form = new Form()) {
            form.Text="Rovarin Release Manager could not open";
            form.Width=700; form.Height=420; form.StartPosition=FormStartPosition.CenterScreen;
            var text=new TextBox {Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill,Text=reason};
            var close=new Button {Text="Close",Dock=DockStyle.Bottom,Height=40,DialogResult=DialogResult.Cancel};
            form.Controls.Add(text);form.Controls.Add(close);form.CancelButton=close;
            form.Shown += (s,e) => { ShowWindow(form.Handle,9); form.Activate(); };
            form.ShowDialog();
        }
    }
}
'@
    [ReleaseStartupError]::Show($_.Exception.Message)
    exit 1
}
