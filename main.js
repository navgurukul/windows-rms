require("./utils/logger");
const { app, BrowserWindow } = require('electron');

// -------------------- SINGLE INSTANCE LOCK --------------------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("[Main] Another instance is already running. Quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    console.log("[Main] Second instance attempted to launch.");
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const path = require('path');
const config = require('./config/config');
const axios = require('axios');
const { execSync } = require("child_process");
const loggerUtil = require('./utils/logger');

// Deferred service variables
let metricService;
let setWallpaper;
let softwareInstallation;
let ensureWingetIsInstalled;
let autoUpdater;

// Globals
let mainWindow;
let metricsInterval;
let syncInterval;
let errorUploadInterval;
let logBuffer = [];
let isShuttingDown = false;

// Save original console
const originalConsole = { ...console };

// -------------------- LOGGING --------------------
function addToLogBuffer(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  logBuffer.push({ level, message: logEntry });

  if (logBuffer.length > 100) {
    logBuffer.shift();
  }
}

function sendLogToWindow(level, ...args) {
  const message = args.join(' ');
  addToLogBuffer(level, message);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { level, message });
  }
}

function flushLogBuffer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    logBuffer.forEach(log => {
      mainWindow.webContents.send('log-message', log);
    });
    logBuffer = [];
  }
}

// Override console
console.log = (...args) => {
  originalConsole.log(...args);
  sendLogToWindow('info', ...args);
};

console.error = (...args) => {
  originalConsole.error(...args);
  sendLogToWindow('error', ...args);
};

console.warn = (...args) => {
  originalConsole.warn(...args);
  sendLogToWindow('warn', ...args);
};

// -------------------- AUTO STARTUP REGISTRATION --------------------
function registerAsStartup() {
  // try {
  //   const appPath = process.execPath;
  //   const runKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`;
  //   const regQuery = `reg query "${runKey}" /v "SAMAClient"`;

  //   try {
  //     execSync(regQuery, { stdio: "ignore" });
  //     console.log("Startup entry already exists.");
  //   } catch {
  //     console.log("Startup entry not found. Registering...");
  //     const addCmd = `reg add "${runKey}" /v "SAMAClient" /d "${appPath}" /f`;
  //     execSync(addCmd);
  //     console.log("Startup entry added successfully.");
  //   }
  // } catch (err) {
  //   console.error("Error registering startup entry:", err.message);
  // }
  try {
    const exePath = process.execPath; // escape slashes
    // const exePath = process.execPath.replace(/\\/g, "\\\\"); // escape slashes

    const cmd = `SCHTASKS /Create /F /RL HIGHEST /SC ONLOGON /TN "SamaSystemAdmin" /TR "\\"${exePath}\\""`;
    // const cmd = `SCHTASKS /Create /F /RL HIGHEST /SC ONLOGON /TN "SamaSystemAdmin" /TR "${exePath}"`;
    // const cmd = `SCHTASKS /Create /F /RL HIGHEST /SC ONLOGON /TN "SamaSystemAdmin" /TR "${exePath} --hidden\"`;


    execSync(cmd, { stdio: "ignore" });
    console.log("[Main] Scheduled Task created for startup.");
  } catch (err) {
    console.error("[Main] Failed to register scheduled task:", err);
  }
}

// -------------------- STARTUP TASKS --------------------
async function registerDeviceToServer() {
  if (!metricService) {
    metricService = require('./services/metricService');
  }
  while (true) {
    try {
      console.log("Registering device to server...");
      const response = await axios.post(`${config.BACKEND_BASE_URL}/api/devices`, {
        username: await metricService.getUsername(),
        serial_number: await metricService.getSerialNumber(),
        mac_address: await metricService.getMacAddress(),
        location: await metricService.getGeolocation(),
        rms_version: app.getVersion(),
      });
      console.log("Device registered successfully:", response?.data);
      if (response?.data?.serial_number) {
        await metricService.updateCachedSerialNumber(response.data.serial_number);
      }
      break;
    } catch (error) {
      console.error("Failed to register device, retrying in 10 seconds...", {
        code: error.code,
        message: error.message,
        url: error.config?.url,
      });
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

// -------------------- WALLPAPER --------------------
async function fetchAndSetWallpaper() {
  try {
    console.log('Fetching wallpaper URL...');
    const fetchWallpaper = await axios.get(`${config.BACKEND_BASE_URL}/api/wallpaper?serial_number=${await metricService.getSerialNumber()}`);
    const url = fetchWallpaper.data.wallpaper;
    console.log('Wallpaper URL fetched:', url);

    console.log('VBS script location:', require('./services/updateWallpaperWithVBS').getSystemDataFolder());
    setWallpaper(url);
  } catch (error) {
    console.error('Error fetching wallpaper:', error.message);
  }
}

// -------------------- METRICS --------------------
async function startMetricsCollection() {
  console.log('Starting metrics collection...');
  console.log('System ID:', metricService.systemId);
  console.log('Data file location:', metricService.getDataFilePath());

  try {
    await metricService.initializeFiles();
    console.log('Files initialized successfully');

    metricsInterval = setInterval(metricService.updateMetrics, 60 * 1000); // 1 min
    syncInterval = setInterval(metricService.syncData, 20 * 60 * 1000); // 20 min

    console.log(`Metrics will be updated every minute`);
    console.log(`Data sync will be attempted every 20 minutes`);

    return metricsInterval;
  } catch (error) {
    console.error('Error starting metrics collection:', error);
    return null;
  }
}

// -------------------- WINDOW --------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    skipTaskbar: true,
    icon: path.join(__dirname, 'icons', 'sama.ico'),
    webPreferences: {
      nodeIntegration: false,       // safer
      contextIsolation: true,       // required for preload
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (config.withUI) {
    mainWindow.loadFile('index.html');

    mainWindow.webContents.on('did-finish-load', () => {
      flushLogBuffer();
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  return mainWindow;
}

// -------------------- APP LIFECYCLE --------------------
async function startErrorUpload() {
  try {
    // first attempt immediately
    await uploadErrorsOnce();
  } catch { }
  errorUploadInterval = setInterval(uploadErrorsOnce, 6 * 60 * 60 * 1000); // every 6 hours
}

async function uploadErrorsOnce() {
  try {
    const errors = loggerUtil.drainErrorQueue();
    if (!errors || errors.length === 0) return;

    const serial = await metricService.getSerialNumber();
    const payload = {
      deviceId: serial,
      timestamp: new Date().toISOString(),
      logs: errors
    };
    await axios.post(`${config.BACKEND_BASE_URL}/api/logs`, payload);
    console.log(`Uploaded ${errors.length} error logs`);
  } catch (e) {
    console.error('Failed to upload error logs:', e?.message || e);
  }
}

app.whenReady().then(async () => {
  console.log('App ready');
  
  // 1. Block further execution until device is registered
  await registerDeviceToServer();

  // 2. Load the remaining service modules
  metricService = require('./services/metricService');
  ({ setWallpaper } = require('./services/updateWallpaperWithVBS'));
  softwareInstallation = require('./services/softwareInstallUsingWinget');
  ({ ensureWingetIsInstalled } = require('./services/wingetService'));
  ({ ensureCertificateInstalled } = require('./services/certificateService'));
  autoUpdater = require('./services/autoUpdaterService');

  // Connect update pending handler to prepare main process for silent update and restart
  autoUpdater.setUpdatePendingHandler((info) => {
    console.log(`[Main] Update v${info.version} downloaded. Stopping background services for immediate restart...`);
    if (metricsInterval) clearInterval(metricsInterval);
    if (syncInterval) clearInterval(syncInterval);
    if (errorUploadInterval) clearInterval(errorUploadInterval);
    autoUpdater.stopPeriodicUpdateChecks();
  });

  // 3. Consolidate other startup tasks that were originally in the IIFE
  try {
    registerAsStartup();

    // Ensure required code signing certificates are installed
    await ensureCertificateInstalled();

    // Check if Winget is installed
    const wingetInstalled = await ensureWingetIsInstalled();
    console.log("Winget installed status:", wingetInstalled);
    await softwareInstallation.attemptWingetHardFix();
  } catch (error) {
    console.error("Error executing startup setup tasks:", error);
  }

  // 4. Start background services
  await startMetricsCollection();
  await startErrorUpload();
  if (config.withUI) mainWindow = createWindow();

  autoUpdater.startPeriodicUpdateChecks(6 * 60 * 60 * 1000); // 6 hours
  await fetchAndSetWallpaper();

  app.on("activate", () => {
    if (config.withUI && mainWindow === null) createWindow();
  });
});

// -------------------- SHUTDOWN HANDLING --------------------

async function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n[Main] Initiating graceful shutdown...');

  try {
    if (metricsInterval) clearInterval(metricsInterval);
    if (syncInterval) clearInterval(syncInterval);
    if (errorUploadInterval) clearInterval(errorUploadInterval);

    if (autoUpdater && typeof autoUpdater.stopPeriodicUpdateChecks === "function") {
      autoUpdater.stopPeriodicUpdateChecks();
    }

    try {
      await axios.post(`${config.BACKEND_BASE_URL}/api/devices/statusUpdate`, {
        serial_number: await metricService.getSerialNumber(),
        isActive: false,
        rms_version: app.getVersion(),
      }, { timeout: 4000 });
    } catch (netErr) {
      console.warn('[Main] Could not notify server of statusUpdate on shutdown:', netErr.message);
    }

    const forceQuitTimeout = setTimeout(() => {
      console.log('[Main] Forcing app exit due to shutdown timeout...');
      app.exit(0);
    }, 5000);

    try {
      await metricService.sendFinalMetrics();
    } catch (metricErr) {
      console.warn('[Main] Could not send final metrics on shutdown:', metricErr.message);
    }

    clearTimeout(forceQuitTimeout);

    // Release single-instance lock before exit
    try {
      if (typeof app.releaseSingleInstanceLock === "function") {
        app.releaseSingleInstanceLock();
      }
    } catch (_) {}

    app.exit(0);
  } catch (err) {
    console.error('[Main] Error during shutdown:', err);
    app.exit(1);
  }
}

app.on('window-all-closed', () => handleShutdown());

app.on('before-quit', (event) => {
  // CRITICAL: If quitting because an auto-update is ready to install, DO NOT call event.preventDefault()!
  // Allowing the quit to proceed immediately lets elevate.exe and the NSIS installer overwrite files cleanly without file-locking.
  if (autoUpdater && typeof autoUpdater.isUpdateInProgress === "function" && autoUpdater.isUpdateInProgress()) {
    console.log('[Main] Application is quitting for auto-update installation. Allowing immediate exit.');
    return;
  }

  if (!isShuttingDown) {
    event.preventDefault();
    handleShutdown();
  }
});

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
