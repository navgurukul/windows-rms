# Windows RMS (Sama Client) Developer Onboarding Guide

Welcome to the **Windows RMS (Sama Client)** project. This application is a background system administration tool built with Electron, designed to manage and monitor Windows machines remotely.

## 🚀 Project Overview

The Sama Client is a specialized Electron app that runs with elevated privileges on Windows systems. Its primary purpose is to:
1.  **Monitor**: Collect system metrics (uptime, geolocation, hardware IDs).
2.  **Configure**: Remotely set desktop wallpapers.
3.  **Deploy**: Silently install software packages via `winget`.
4.  **Update**: Maintain itself using an automatic update mechanism.

---

## 🛠 Tech Stack

-   **Runtime**: [Electron](https://www.electronjs.org/) (Node.js + Chromium)
-   **API Client**: [Axios](https://axios-http.com/)
-   **Package Tracking**: [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) (Windows Package Manager)
-   **Updates**: [electron-updater](https://www.electron.build/auto-update)
-   **Scheduling**: `node-cron` & Windows `schtasks`

---

## 📂 Repository Structure

```text
windows-rms/
├── main.js                 # App entry point & lifecycle management
├── package.json            # Dependencies & build configuration
├── preload.js              # IPC bridge (mostly for logging UI)
├── config/
│   └── config.js           # API endpoints & interval settings
├── services/
│   ├── metricService.js    # Telemetry, hardware info, & offline sync
│   ├── softwareInstall...  # Winget-based silent software deployment
│   ├── updateWallpaper...  # Registry/VBS-based wallpaper management
│   ├── autoUpdaterService.js# GitHub-based auto-update logic
│   └── wingetService.js    # Winget health & installation checks
├── utils/
│   └── logger.js           # Centralized logging & error reporting
└── icons/                  # Application icons (sama.ico)
```

---

## ⚙️ Core Modules & Logic

### 1. Startup & Persistence (`main.js`)
-   **Highest Privileges**: Set to `requireAdministrator` to allow registry edits and task scheduling.
-   **Scheduled Task**: Instead of a standard startup entry, the app creates a Windows Scheduled Task (`SamaSystemAdmin`) to run at logon with "Highest Privileges". This bypasses UAC prompts on subsequent starts.
-   **Headless Mode**: Defaults to `withUI: false` in `config.js` to run invisibly in the background.

### 2. Telemetry & Metric Service (`services/metricService.js`)
-   **Device Identity**: Uses the machine's Serial Number (via WMI) and MAC Address as unique identifiers.
-   **Persistence**: Data is stored in `C:\System.ServiceData` (a hidden system folder).
-   **Offline Sync**:
    -   `daily.json`: Tracks current day's uptime.
    -   `history.json`: Stores records from previous days if they failed to sync.
    -   **Loop**: Tracks every 1 minute, syncs every 5-20 minutes.
-   **WMI Health**: Includes a self-healing mechanism for the Windows Management Instrumentation (WMI) service, which is critical for hardware info.

### 3. Software Deployment (`services/softwareInstallUsingWinget.js`)
-   **The "Shadow Task" Pattern**: `winget` can be unreliable when called directly from a GUI process.
    -   The app fetches a "to-do" list from the backend.
    -   It creates a temporary PowerShell script in `temp`.
    -   It schedules a one-off Windows Task to execute the script in 2 minutes.
    -   The script runs `winget install` with flags for silent, forced, and machine-wide installation.
-   **Feedback Loop**: It checks the generated logs and posts success/failure back to the backend.

### 4. Wallpaper Management (`services/updateWallpaperWithVBS.js`)
-   **Reliability**: Setting wallpapers on Windows is notoriously difficult via code.
-   **Method**:
    1.  Downloads the image to `Downloads\Wallpapers`.
    2.  Generates a `.vbs` script that modifies the registry Keys:
        -   `HKCU\Control Panel\Desktop\Wallpaper`
    3.  Calls `UpdatePerUserSystemParameters` via `rundll32.exe` multiple times to force a refresh.

---

## 📋 Developer Workflow

### Prerequisites
-   **Windows OS**: Necessary for WMI, registry, and `winget` operations.
-   **Node.js**: LTS version (v18+).
-   **Admin Access**: The terminal/IDE must run as Administrator.

### Running Locally
1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Start the app:
    ```bash
    npm start
    ```
    *Note: If `withUI` is false, you won't see a window. Check the logs in `C:\System.ServiceData`.*

### Building & Distributing
The project uses `electron-builder`:
-   **Build EXE**: `npm run build-win`
-   **Publish to GitHub**: `npm run publish` (Requires a `GH_TOKEN` in environment).

---

## ⚠️ Important Considerations

1.  **WMI Errors**: If the app fails to get the Serial Number, it might be due to WMI corruption. Use `metricService.ensureWmiHealthy()` or reset WMI manually.
2.  **Privacy/Security**: The app collects geolocation via IP (ipinfo.io). Ensure your environment allows these outbound requests.
3.  **Winget Source**: If installations fail consistently, the machine might need a `winget source reset`, which the app attempts automatically on startup.
4.  **UI Switch**: To see what's happening visually, toggle `withUI: true` in `config/config.js`.

---

## 🔒 Security Note
Since this app runs as **SYSTEM/Admin**, be extremely careful when modifying the `exec` or `schtasks` commands. Always sanitize inputs and avoid running untrusted scripts.
