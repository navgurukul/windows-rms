require("./utils/logger");
const { app, BrowserWindow } = require('electron');
const path = require('path');
const config = require('./config/config');
const metricService = require('./services/metricService');
const { setWallpaper } = require('./services/updateWallpaperWithVBS');
const softwareInstallation = require('./services/softwareInstallUsingWinget');
const { ensureWingetIsInstalled } = require('./services/wingetService')
const axios = require('axios');
const autoUpdater = require('./services/autoUpdaterService');
const { execSync } = require("child_process");
const loggerUtil = require('./utils/logger');

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
    console.log("✅ Scheduled Task created for startup.");
  } catch (err) {
    console.error("🚩 Failed to register scheduled task:", err);
  }
}

// -------------------- STARTUP TASKS --------------------
async function registerDeviceToServer() {
  try {
    console.log("Registering device to server");
    const response = await axios.post(`${config.BACKEND_BASE_URL}/api/devices`, {
      username: await metricService.getUsername(),
      serial_number: await metricService.getSerialNumber(),
      mac_address: await metricService.getMacAddress(),
      location: await metricService.getGeolocation(),
    });
    console.log(response?.data);
  } catch (error) {
    console.error(error.response || 'Failed to register device');
  }
}

(async () => {
  try {
    registerAsStartup();

    // await axios.post(`${config.BACKEND_BASE_URL}/api/devices/statusUpdate`, {
    //   serial_number: await metricService.getSerialNumber(),
    //   isActive: true,
    // });

    // Check if Winget is installed
    const wingetInstalled = await ensureWingetIsInstalled();
    console.log(wingetInstalled);

  } catch (error) {
    console.error("Error syncing data to server:", error);
  }
})();

// -------------------- WALLPAPER --------------------
async function fetchAndSetWallpaper() {
  try {
    console.log('Fetching wallpaper URL...');
    const fetchWallpaper = await axios.get(`${config.BACKEND_BASE_URL}/api/wallpaper`);
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
  } catch {}
  errorUploadInterval = setInterval(uploadErrorsOnce, 0.5 * 60 * 1000); // every 5 minutes
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
  await registerDeviceToServer();
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
  console.log('\nInitiating graceful shutdown...');

  try {
    if (metricsInterval) clearInterval(metricsInterval);
    if (syncInterval) clearInterval(syncInterval);
    if (errorUploadInterval) clearInterval(errorUploadInterval);

    autoUpdater.stopPeriodicUpdateChecks();

    await axios.post(`${config.BACKEND_BASE_URL}/api/devices/statusUpdate`, {
      serial_number: await metricService.getSerialNumber(),
      isActive: false,
    });

    const forceQuitTimeout = setTimeout(() => {
      console.log('Forcing app quit due to timeout...');
      app.exit(0);
    }, 5000);

    await metricService.sendFinalMetrics();
    clearTimeout(forceQuitTimeout);
    app.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    app.exit(1);
  }
}

app.on('window-all-closed', () => handleShutdown());
app.on('before-quit', (event) => {
  if (!isShuttingDown) {
    event.preventDefault();
    handleShutdown();
  }
});
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
