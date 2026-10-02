#define AppVersion "0.1.0"
[Setup]
AppId={{C51A4180-26D2-4F48-93BD-B40B182B78DA}
AppName=PC Monitor
AppVersion={#AppVersion}
AppPublisher=PC Monitor
Uninstallable=yes
CreateUninstallRegKey=yes
UninstallDisplayName=PC Monitor
DefaultDirName={localappdata}\PCMonitor
DefaultGroupName=PC Monitor
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.22000
OutputDir=..\dist
OutputBaseFilename=PCMonitorSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern dark polar includetitlebar
WizardSizePercent=110
LicenseFile=payload\app\LICENSE
UninstallDisplayIcon={app}\app\PCMonitor.exe
SetupIconFile=payload\app\PCMonitor.ico
CloseApplications=no
RestartApplications=no
SetupLogging=no

[Types]
Name: "full"; Description: "PC Monitor with optional Enhanced CPU Temperature support"
Name: "custom"; Description: "Custom installation"; Flags: iscustom
[Components]
Name: "core"; Description: "PC Monitor (self-contained Node runtime)"; Types: full custom; Flags: fixed
Name: "enhanced"; Description: "Enhanced CPU Temperature - Recommended (installs the signed PawnIO hardware-access driver; Windows UAC approval required)"; Types: full
[Tasks]
Name: "startup"; Description: "Start PC Monitor with Windows (quietly at sign-in)"; Flags: checkedonce
Name: "desktopPin"; Description: "Require a PIN when opening PC Monitor on this PC"; Flags: checkedonce; Check: FreshDesktopPreference
[Dirs]
Name: "{app}\data"
[Files]
Source: "payload\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "payload\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\PC Monitor"; Filename: "{app}\app\PCMonitor.exe"; WorkingDir: "{app}\app"; IconFilename: "{app}\app\PCMonitor.exe"
Name: "{group}\PC Monitor Setup and PIN Recovery"; Filename: "{app}\app\PCMonitor.exe"; Parameters: "setup"; WorkingDir: "{app}\app"; IconFilename: "{app}\app\PCMonitor.exe"
Name: "{group}\Disable PC Monitor Startup"; Filename: "{app}\app\PCMonitor.exe"; Parameters: "disable-startup"; WorkingDir: "{app}\app"
Name: "{group}\Uninstall PC Monitor"; Filename: "{uninstallexe}"
Name: "{autodesktop}\PC Monitor"; Filename: "{app}\app\PCMonitor.exe"; WorkingDir: "{app}\app"; IconFilename: "{app}\app\PCMonitor.exe"
Name: "{userstartup}\PC Monitor"; Filename: "{app}\app\PCMonitor.exe"; Parameters: "startup"; WorkingDir: "{app}\app"; Tasks: startup
[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\app\scripts\install-enhanced.ps1"" -Notify"; Components: enhanced; Flags: runhidden waituntilterminated skipifsilent
Filename: "{app}\app\PCMonitor.exe"; Description: "Launch PC Monitor"; Flags: postinstall nowait skipifsilent
[InstallDelete]
Type: files; Name: "{group}\PC Monitor Web Dashboard.lnk"
[Messages]
FinishedHeadingLabel=PC Monitor installed successfully
FinishedLabel=PC Monitor is ready on this PC. Launch it to finish Setup or open your dashboard. Tailscale is needed only to connect from another device.
[UninstallDelete]
Type: files; Name: "{app}\app\uninstall-trust.json"
Type: dirifempty; Name: "{app}\app"
[Code]
var FullRemoval, ExistingOnboarding, ExistingConfiguration: Boolean;
function FreshDesktopPreference(): Boolean;
begin
  Result := not FileExists(ExpandConstant('{app}\data\config.json'));
end;
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpSelectTasks) and FreshDesktopPreference() and not WizardIsTaskSelected('desktopPin') then
    Result := MsgBox('Allow this Windows account to open the native PC Monitor app without entering a PIN?' + #13#10 + #13#10 +
      'Anyone with access to this account may open PC Monitor. Other devices and ordinary browsers will still require the same PC Monitor PIN.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
end;
function UninstallHelper(Mode: String; Extra: String): Boolean;
var ExitCode: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\app\scripts\installed-uninstall.ps1') + '" -Mode ' + Mode + Extra,
    ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) and (ExitCode = 0);
end;
function StopInstalledServer(): String;
var ExitCode: Integer; Helper, Desktop: String;
begin
  Result := '';
  Desktop := ExpandConstant('{app}\app\PCMonitor.exe');
  if FileExists(Desktop) then begin
    if not Exec(Desktop, 'close-desktop', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
      Result := 'PC Monitor desktop could not close safely. Exit it from the tray before continuing.'; exit;
    end;
    { Previous fixed-mode launcher returns 2: it has no resident desktop shell. }
    if (ExitCode <> 0) and (ExitCode <> 2) then begin
      Result := 'PC Monitor desktop is still open. Exit it from the tray before continuing.'; exit;
    end;
  end;
  Helper := ExpandConstant('{app}\app\scripts\stop.ps1');
  if not FileExists(Helper) then exit;
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + Helper + '"', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := 'PC Monitor could not be stopped safely. Close it before continuing.'
  else if ExitCode <> 0 then
    Result := 'Existing PC Monitor ownership could not be confirmed. No process was stopped. Close PC Monitor and try again.';
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  ExistingOnboarding := FileExists(ExpandConstant('{app}\app\server.js')) and FileExists(ExpandConstant('{app}\data\config.json'));
  ExistingConfiguration := FileExists(ExpandConstant('{app}\data\config.json'));
  Result := StopInstalledServer();
end;
function InitializeUninstall(): Boolean;
var Problem: String; I: Integer;
begin
  Result := False;
  if not UninstallHelper('Validate', '') then begin
    SuppressibleMsgBox('Installation safety checks failed. No files were removed. Inspect the installation before trying again.', mbError, MB_OK, IDOK); exit;
  end;
  FullRemoval := False;
  for I := 1 to ParamCount do if Uppercase(ParamStr(I)) = '/FULLREMOVAL' then FullRemoval := True;
  if not UninstallSilent then
    FullRemoval := MsgBox('Full removal: also erase your PC Monitor PIN, configuration and temperature preferences?' + #13#10 + #13#10 +
      'Choose No to preserve settings for reinstall (default). Shared PawnIO and Tailscale will remain installed.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  Problem := StopInstalledServer();
  Result := Problem = '';
  if not Result then SuppressibleMsgBox(Problem, mbError, MB_OK, IDOK);
end;
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Extra: String;
begin
  if CurUninstallStep = usUninstall then begin
    Extra := ''; if FullRemoval then Extra := ' -FullRemoval';
    if not UninstallHelper('Cleanup', Extra) then
      RaiseException('PC Monitor data cleanup could not be verified. Uninstall stopped; inspect the installation.');
  end;
end;
procedure CurStepChanged(CurStep: TSetupStep);
var Extra, Preference: String; ExitCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    { Never overwrite an upgrade/preserved-data PIN or desktop preference. }
    if not ExistingConfiguration then begin
      Preference := '--desktop-pin-on';
      if not WizardIsTaskSelected('desktopPin') then begin
        if WizardSilent then RaiseException('Passwordless desktop requires interactive confirmation.');
        Preference := '--desktop-pin-off';
      end;
      if not Exec(ExpandConstant('{app}\runtime\node.exe'), '"' + ExpandConstant('{app}\app\pin-manager.js') + '" ' + Preference,
        ExpandConstant('{app}\app'), SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
        RaiseException('Could not save the desktop PIN preference. Installation needs repair.');
    end;
  end;
  if CurStep = ssDone then begin
    Extra := ''; if not WizardIsTaskSelected('startup') then Extra := ' -RemoveStartup';
    if not UninstallHelper('Register', Extra) then
      RaiseException('Could not register trusted PC Monitor uninstall metadata. Installation needs repair.');
    { Existing users must not receive an automatic PIN reveal after upgrade. }
    if ExistingOnboarding and not FileExists(ExpandConstant('{app}\data\onboarding-complete.json')) then
      if not SaveStringToFile(ExpandConstant('{app}\data\onboarding-complete.json'), '{"completed":true}', False) then
        RaiseException('Could not preserve local Setup completion. Installation needs repair.');
  end;
end;
