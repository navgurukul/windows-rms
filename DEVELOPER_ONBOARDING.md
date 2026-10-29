# Windows RMS (Sama Client) Developer Onboarding Guide

Welcome to the **Windows RMS (Sama Client)** project. This application is an elevated background system administration and fleet management daemon built with Electron, engineered to manage, configure, monitor, and maintain Windows laptops deployed across educational centers, rural schools, and partner ecosystems (including Amazon Future Engineer - AFE).

---

## 1. Project Overview

The Sama Client is a specialized Electron application that runs with elevated administrator privileges on Windows 10 and Windows 11 systems. It is engineered specifically for constrained and intermittent connectivity environments (such as rural schools operating on cellular dongles or offline setups).

### Core Responsibilities
1. **Fleet Telemetry & Identity**: Collects system metrics (uptime, geolocation, hardware serial numbers, MAC addresses) with multi-tier fallback resolution and offline buffering.
2. **Multi-Modal Software Deployment**: Deploys applications silently via `winget`, server-hosted repository binaries (`rms-repository`), and remote execution scripts (`.bat`, `.cmd`, `.ps1`, `.sh`).
3. **Controlled Software Store**: Maintains an authoritative local database (`installed_softwares.json`) to prevent redundant multi-gigabyte downloads.
4. **Certificate Management**: Automatically installs required trusted root certificates into Windows certificate stores.
5. **Remote Desktop Configuration**: Synchronizes and dynamically sets branded desktop wallpapers via Windows Registry and VBScript.
6. **Self-Healing & Diagnostics**: Detects and remediates Windows Management Instrumentation (WMI) corruption and repairs `winget` sources.
7. **Silent Auto-Update**: Maintains itself through GitHub Releases using `electron-updater`.

---

## 2. Tech Stack

- **Runtime Environment**: [Electron](https://www.electronjs.org/) (Node.js + Chromium runtime)
- **HTTP Client**: [Axios](https://axios-http.com/)
- **Native OS Automation**: PowerShell 5.1+, Windows Task Scheduler (`schtasks.exe`), Windows Registry (`reg.exe`)
- **Package Management**: [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) (Windows Package Manager), [Chocolatey](https://chocolatey.org/)
- **Application Packaging**: [electron-builder](https://www.electron.build/)
- **Auto-Updates**: [electron-updater](https://www.electron.build/auto-update)
- **Task Scheduling**: `node-cron` & Windows `schtasks`
- **Logging & Diagnostics**: `electron-log`, native rotating file logger with backend error telemetry upload

---

## 3. Repository Structure

```text
windows-rms/
├── main.js                             # Application entry point, single-instance lock, lifecycle
├── package.json                        # Dependencies, electron-builder NSIS config, build scripts
├── preload.js                          # IPC bridge for rendering logs in debug GUI
├── index.html                          # Lightweight real-time log viewer interface
├── config/
│   └── config.js                       # Server endpoints, polling intervals, and UI flags
├── services/
│   ├── metricService.js                # Telemetry, multi-tier serial resolution, offline sync
│   ├── softwareInstallUsingWinget.js   # Multi-modal deployment (Winget, RMS binaries, scripts)
│   ├── certificateService.js           # Automated code-signing root certificate installer
│   ├── chocolateyService.js            # Chocolatey installation and environment health checks
│   ├── softwareInstallationService.js  # Registry-based software detection & alternate installer
│   ├── updateWallpaperWithVBS.js       # Registry & VBS-driven desktop wallpaper manager
│   ├── updateWallpaper.js              # Direct wallpaper update helper
│   ├── wingetService.js                # Winget availability and package manager validation
│   └── autoUpdaterService.js           # GitHub-backed silent auto-updater
├── utils/
│   ├── logger.js                       # Centralized rotating file logger and error queue
│   └── systemUtils.js                  # System diagnostics, memory, CPU, and hardware hashing
└── icons/
    └── sama.ico                        # Application tray and installer icon
```

---

## 4. Architectural Deep Dive

### 4.1 Process Lifecycle & Elevation ([main.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/main.js))
- **Single-Instance Lock**: Utilizes `app.requestSingleInstanceLock()` to ensure only one instance runs per machine. Duplicate launches terminate immediately.
- **Privilege Level**: Configured with `requestedExecutionLevel: requireAdministrator` in `package.json`.
- **Logon Persistence via Scheduled Tasks**: Instead of standard registry `Run` keys (which can trigger UAC prompts or execute with standard user tokens), RMS creates an elevated Windows Scheduled Task:
  ```cmd
  SCHTASKS /Create /F /RL HIGHEST /SC ONLOGON /TN "SamaSystemAdmin" /TR "\"<path-to-exe>\""
  ```
  This guarantees execution at user logon with `HIGHEST` privileges without interrupting the end user.
- **Headless Execution**: Controlled via `withUI: false` in [config/config.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/config/config.js). When `false`, the app runs completely invisible in the background without a taskbar item or desktop window.
- **Graceful Shutdown**: Catches `SIGINT`, `SIGTERM`, and `before-quit` events to notify the backend via `POST /api/devices/statusUpdate` (`{ isActive: false }`) and flush accumulated metrics via `metricService.sendFinalMetrics()` before exiting.

---

### 4.2 Device Identity & Telemetry Engine ([services/metricService.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/services/metricService.js))

#### Multi-Tier Serial Resolution Cascade
Refurbished laptops frequently have erased or unpopulated motherboard serial numbers (e.g., `"To be filled by O.E.M."`, `"Default string"`). To guarantee a persistent, collision-free device identity, RMS employs an 8-stage resolution cascade in `getSerialNumber()`:
1. **Local Persistent Cache**: Checks [C:\System.ServiceData\device_info.json](file:///c:/System.ServiceData/device_info.json).
2. **AFE Co-located Probe**: Checks `%APPDATA%\OfflineLearningApp\config.json` for coordinator-verified `customSerialNumber`.
3. **PowerShell WMI / CIM Queries**: Evaluates `Win32_BIOS`, `Win32_BaseBoard`, and `Win32_SystemEnclosure`.
4. **WMIC CLI**: Direct execution of `wmic bios get serialnumber /value`.
5. **Kernel Registry BIOS**: Reads `HKLM\HARDWARE\DESCRIPTION\System\BIOS` for `SystemSerialNumber` and `BaseBoardSerialNumber`.
6. **Windows Product ID**: Reads `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProductId` prefixed with `WIN-`.
7. **Hardware Fingerprint**: SHA-256 hash derived from combining MAC Address + CPU Processor ID + Disk Serial Number prefixed with `FP-`.
8. **Guaranteed UUID Fallback**: Generates a persistent random UUID prefixed with `NG-`.

> **Note**: The client NEVER returns `"Unknown"`. An identifier is always produced, cached, and persisted.

#### MAC-Based Serial Self-Healing (`verifyOrSelfHealDeviceRegistration`)
If the server returns `404 Not Found` when verifying a cached serial number (e.g., following an admin database merge or manual correction), RMS queries `GET /api/devices/mac/:mac`. When found, it automatically adopts the server's registered serial number and reconciles `device_info.json`, `daily.json`, and `history.json`.

#### Offline-First Uptime Tracking & Buffering
All operational files are stored in the hidden system folder `C:\System.ServiceData`:
- [daily.json](file:///c:/System.ServiceData/daily.json): Tracks active uptime minutes for the current calendar date (updated every 60 seconds).
- [history.json](file:///c:/System.ServiceData/history.json): Queues historical records from previous offline dates.
- **Date Boundary Handling**: Automatically rolls over midnight, moving previous records into `history.json` and triggering an immediate bulk sync once network connectivity returns.
- **Resilient Connectivity Check**: Avoids brittle HTTP requests by testing raw TCP socket connections directly to Cloudflare DNS (`1.1.1.1:53`) with a 5-second timeout.
- **Sync Intervals**: Local metric updates run every 1 minute (`METRICS_INTERVAL = 3000ms`), and backend synchronization runs every 20 minutes (`SYNC_INTERVAL = 30000ms`).

---

### 4.3 Multi-Modal Software Deployment ([services/softwareInstallUsingWinget.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/services/softwareInstallUsingWinget.js))

The deployment engine handles three distinct distribution models:

#### 1. Winget Packages (`installViaWingetTask`)
Uses the "Shadow Task" pattern to avoid interactive desktop interruptions:
- Generates a transient PowerShell script wrapped in `Start-Transcript` and `Stop-Transcript`.
- Schedules an elevated Windows task via `schtasks` set to trigger 2 minutes in the future.
- Executes `winget install --id <id> --source <source> --silent --accept-source-agreements --accept-package-agreements --force --disable-interactivity --scope machine`.
- Parses exit codes (`$LASTEXITCODE`), posts success/failure telemetry to `/api/softwares/addHistory`, and cleans up all scheduled tasks and temporary scripts.

#### 2. RMS Server Repository Binaries (`installFromRmsRepository`)
For bespoke educational software hosted on the RMS server:
- Automatically validates and installs code-signing certificates before executing the binary.
- Streams the installer directly from `${BACKEND_BASE_URL}/softwares/:filename`.
- Supports standard silent installers (`Start-Process -FilePath <path> -ArgumentList "/S" -Wait`) as well as portable executable distributions.

#### 3. Remote Script Execution (`installScriptFileViaTask`)
Introduced in v1.4.0 for utilities like Time Watch / Active Watch:
- Detects `.bat`, `.cmd`, `.ps1`, and `.sh` URLs in software payloads.
- Automatically selects the appropriate engine (`powershell.exe -ExecutionPolicy Bypass`, `cmd.exe /c`, or `bash`).
- Runs hidden and elevated via scheduled tasks, evaluates script return codes, and logs transcripts to temporary directory logs.

#### 4. Controlled Software Store (`installed_softwares.json`)
To protect rural cellular bandwidth and prevent repeated 1.3 GB+ installer downloads:
- Tracks all verified applications in `C:\System.ServiceData\installed_softwares.json`.
- Normalizes application names (`normalizeAppName`) and registers multi-alias keys (e.g. `afe` and `amazon-future-engineer`).
- Performs pre-download fallback checks across `Program Files`, `%LOCALAPPDATA%\Programs`, and Desktop shortcuts (`checkPhysicalInstallationFallback`). If detected, downloads are completely aborted and the server is updated immediately.
- Runs automated garbage collection (`cleanOrphanedTempInstallers`) on temp files older than 30 minutes.

---

### 4.4 Automated Certificate Installation ([services/certificateService.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/services/certificateService.js))

Enterprise educational installers (e.g., AFE) often require custom root code-signing certificates.
- Checks Windows certificate stores via PowerShell:
  - `Cert:\LocalMachine\Root`
  - `Cert:\LocalMachine\TrustedPublisher`
  - `Cert:\CurrentUser\Root`
- If missing, downloads the certificate (`AFE_Public.cer`) from the RMS server endpoint `/softwares/certs/`.
- Executes `certutil.exe -addstore -f "Root" <certFile>` and `certutil.exe -addstore -f "TrustedPublisher" <certFile>` to register the certificate silently at startup.

---

### 4.5 Wallpaper Remote Management ([services/updateWallpaperWithVBS.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/services/updateWallpaperWithVBS.js))

Setting wallpapers reliably across varied Windows editions without user logoff requires a multi-step approach:
1. Downloads the remote wallpaper to `Downloads\Wallpapers`.
2. Generates a VBScript in `C:\System.ServiceData\wallpaperSet.vbs`.
3. Injects registry keys:
   - `HKCU\Control Panel\Desktop\Wallpaper`
   - `HKCU\Control Panel\Desktop\WallpaperStyle`
4. Calls `rundll32.exe user32.dll,UpdatePerUserSystemParameters 1, True` multiple times to force the Windows desktop shell to repaint.

---

### 4.6 Centralized Logging & Error Queue ([utils/logger.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/utils/logger.js))

- **File Destination**: `C:\System.ServiceData\logs\YYYY-MM-DD.log`.
- **Log Rotation**: Automatically rotates when log files exceed 5 MB (`MAX_LOG_SIZE`).
- **Retention**: Purges logs older than 7 days (`RETENTION_DAYS`) on startup.
- **Backend Error Upload**: Hooks into `console.error` to queue error events in memory. Every 6 hours, `uploadErrorsOnce()` flushes this queue to `POST /api/logs` with the device's hardware serial number.

---

### 4.7 Auto-Updater ([services/autoUpdaterService.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/services/autoUpdaterService.js))

- Configured using `electron-updater` tied to GitHub repository releases (`navgurukul/windows-rms`).
- `autoDownload = true` and `autoInstallOnAppQuit = true`.
- Background scheduler triggers periodic update checks every 6 hours (`startPeriodicUpdateChecks`).
- Staged updates install silently on application restart or scheduled reboot.

---

## 5. Developer Workflow & Setup

### Prerequisites
- **Operating System**: Windows 10 or Windows 11 (64-bit).
- **Node.js**: LTS version (Node.js 18.x or 20.x recommended).
- **Terminal**: PowerShell or Windows Terminal launched as **Administrator**.
- **Git**: Installed and accessible on PATH.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/navgurukul/windows-rms.git
   cd windows-rms
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally for Development
1. **Headless Mode (Default)**:
   ```bash
   npm start
   ```
   *The application will run in the background. Tail logs using PowerShell:*
   ```powershell
   Get-Content -Path "C:\System.ServiceData\logs\*.log" -Wait -Tail 30
   ```
2. **GUI Debugging Mode**:
   Edit [config/config.js](file:///c:/Mukul/Navgurukul/RMS/windows-rms/config/config.js):
   ```javascript
   withUI: true
   ```
   Run `npm start` to open the internal real-time Electron log console window.

---

## 6. Build & Distribution

The project uses `electron-builder` configured for 64-bit NSIS one-click installation.

| Command | Description |
| :--- | :--- |
| `npm run start` | Launches Electron with `--trace-warnings` in local development mode |
| `npm run pack` | Prepares the unpacked application directory under `dist/` |
| `npm run dist` | Builds the full NSIS executable installer under `dist/` |
| `npm run build-win` | Builds 64-bit Windows NSIS setup package |
| `npm run build-win-no-sign` | Builds 64-bit package with code signing disabled |
| `npm run publish` | Builds and publishes setup binaries directly to GitHub Releases |

### Publishing Releases
To publish an update to GitHub Releases:
1. Ensure `GH_TOKEN` is exported in your environment:
   ```powershell
   $env:GH_TOKEN = "your_github_personal_access_token"
   ```
2. Update the version number in `package.json`.
3. Run the publish script:
   ```bash
   npm run publish
   ```

---

## 7. Troubleshooting & Operational Tips

### 1. WMI Repository Inconsistency
If hardware detection fails or logs report WMI timeouts:
```powershell
# Verify WMI repository health
winmgmt /verifyrepository

# Salvage or reset repository if corrupted
winmgmt /salvagerepository
winmgmt /resetrepository
```
The client also includes an automated check in `metricService.ensureWmiHealthy()`.

### 2. Winget Source Failures
If Winget package installations fail to resolve IDs:
```powershell
winget source reset --force
winget source add msstore
```
The client attempts this repair automatically during initialization via `softwareInstallation.attemptWingetHardFix()`.

### 3. Inspecting Local Service Data
All persistent data, cached serial numbers, and daily telemetry can be inspected in PowerShell:
```powershell
Get-ChildItem -Path "C:\System.ServiceData" -Force
Get-Content -Path "C:\System.ServiceData\device_info.json"
Get-Content -Path "C:\System.ServiceData\daily.json"
Get-Content -Path "C:\System.ServiceData\installed_softwares.json"
```

### 4. Clearing Startup Scheduled Task
To manually inspect or delete the startup task during testing:
```powershell
# Query task status
schtasks /Query /TN "SamaSystemAdmin" /V /FO LIST

# Delete task
schtasks /Delete /TN "SamaSystemAdmin" /F
```

---

## 8. Security & Code Integrity Guidelines

- **Elevated Execution**: Because the daemon executes with administrative privileges, never pass unsanitized input to `exec`, `execSync`, or `schtasks`.
- **Ephemeral Script Deletion**: Temporary PowerShell scripts created in `%TEMP%` must always be cleaned up in `finally` blocks to prevent disk clutter or credential exposure.
- **Credential Storage**: Never hardcode API keys or credentials. Add environment variables or use `.env` files.
- **Emoji Free Documentation & Code**: Avoid emojis across code comments, commit messages, and documentation. Use clean text markers and icons.

