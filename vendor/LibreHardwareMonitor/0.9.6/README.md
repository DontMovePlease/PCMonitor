# Approved optional CPU temperature provider

Unmodified .NET Framework 4.7.2 libraries from the official LibreHardwareMonitor
**v0.9.6** release, downloaded from:
https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/tag/v0.9.6

`manifest.json` records the release archive and hashes of the exact bundled files.
Only the managed library dependency closure is included. No GUI, installer,
PawnIO driver installer, service, or independent monitoring application is bundled.
Storage/RAM/HID dependencies are assembly-loading requirements; their collectors
are not enabled. The helper enables **CPU hardware only**.

## Licenses and corresponding source

Keep this entire directory, including notices and source archives, with distributed
copies. Libraries are separate, unmodified components; their licenses do not change
the license of PC Monitor's independently written code.

| Component | Source revision | License / notices |
| --- | --- | --- |
| LibreHardwareMonitorLib | LibreHardwareMonitor/LibreHardwareMonitor, v0.9.6 | MPL-2.0, `LICENSE`, `THIRD-PARTY-NOTICES.txt` |
| BlackSharp.Core | Blacktempel/BlackSharp, 1.0.7 | MPL-2.0, `licenses/BlackSharp.txt` |
| DiskInfoToolkit | Blacktempel/DiskInfoToolkit, 1.1.2 | MPL-2.0, `licenses/DiskInfoToolkit.txt` |
| RAMSPDToolkit-NDD | Blacktempel/RAMSPDToolkit, 1.4.2 | MPL-2.0, `licenses/RAMSPDToolkit.txt` |
| HidSharp | IntergatedCircuits/HidSharp, 2.6.4 | Apache-2.0, license and NOTICE in `licenses/` |
| Microsoft System.* dependencies | dotnet/runtime; binary versions recorded in manifest | MIT, `licenses/Microsoft-System.txt` |
| Embedded PawnIO modules | namazso/PawnIO.Modules, 0.2.2 | LGPL-2.1, `licenses/PawnIO.Modules.txt` and upstream notices |

`source/` contains complete upstream source archives at those revisions. The LHM
module update is identified by upstream commit
`4b3ed8bb4623128927480aaa8cdf0d9e09ebc999`, referencing PawnIO.Modules 0.2.2.
Build instructions and project files are retained in the archives. Use the upstream
LHM project to rebuild/relink the library with modified module sources. PC Monitor
places no restriction on modifying, replacing, or debugging these components for
personal use under their licenses. Remote clients cannot choose library paths.
Review upstream module signing/driver restrictions before redistributing modified
module builds; do not bypass Windows driver protections.

## Runtime requirements

Windows PowerShell 5.1 and the Windows .NET Framework runtime load the fixed helper.
LHM v0.9.6 needs an already installed **PawnIO** driver for CPU sensor access.
The sensor helper checks this prerequisite and never installs a driver or service.
PC Monitor separately offers explicit optional Enhanced support: the unmodified,
hash-pinned and signature-verified official PawnIO installer through Windows UAC,
during setup or from the authenticated local desktop. Remote clients cannot install it.
Sensor access can also require administrator privileges. Missing prerequisites are
reported as optional unavailable capabilities. The experimental ACPI/CIM mode
does not load LHM and is never presented as CPU package temperature.

The one-shot helper closes the Computer object in `finally`; Node bounds its output
and duration and terminates it on lease expiry. Known missing prerequisites back
off for five minutes; operational failures back off for one minute. No idle helper
or background retry timer exists. A mode change explicitly retries the selected
provider on the next active sample.

The Windows package includes these assets/notices/source archives and explains the
optional driver/elevation prerequisite separately. Shared PawnIO is not removed by
PC Monitor uninstall.
