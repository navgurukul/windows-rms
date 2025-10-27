const { app, BrowserWindow } = require('electron');
const path = require('path');
const config = require('./config/config');
const metricService = require('./services/metricService');
const { setWallpaper } = require('./services/updateWallpaperWithVBS');
const softwareInstallation = require('./services/softwareInstallUsingWinget');
// const { installSoftware } = require('./services/softwareInstallationService');
// const { ensureChocolateyInstalled } = require('./services/chocolateyService');
const axios = require('axios');
const autoUpdater = require('./services/autoUpdaterService');

// Globals
let mainWindow;
let metricsInterval;
let syncInterval;
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

// -------------------- STARTUP TASKS --------------------

(async () => {
  try {
    const response = await axios.post(`${config.BACKEND_BASE_URL}/api/devices`, {
      username: await metricService.getUsername(),
      serial_number: await metricService.getSerialNumber(),
      mac_address: await metricService.getMacAddress(),
      location: await metricService.getGeolocation(),
    });
    console.log("Synced data to server");
    console.log(response.data);

    // Check if Chocolatey is installed
    // const chocolateyInstalled = await ensureChocolateyInstalled();
    // console.log(chocolateyInstalled);

  } catch (error) {
    console.error("Error syncing data to server:", error);
  }
})();

// -------------------- WALLPAPER --------------------
async function fetchAndSetWallpaper() {
  try {
    console.log('Fetching wallpaper URL...');
    const fetchWallpaper = await axios.get('https://windows-socket.thesama.in/api/wallpaper');
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
    width: 400,
    height: 400,
    skipTaskbar: true,
    icon: path.join(__dirname, 'icons', 'sama.ico'),
    webPreferences: {
      nodeIntegration: false,       // safer
      contextIsolation: true,       // required for preload
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    flushLogBuffer();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// -------------------- APP LIFECYCLE --------------------
app.whenReady().then(async () => {
  await startMetricsCollection();
  mainWindow = createWindow();

  autoUpdater.startPeriodicUpdateChecks(6 * 60 * 60 * 1000); // 6 hours
  await fetchAndSetWallpaper();

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
});

async function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\nInitiating graceful shutdown...');

  try {
    if (metricsInterval) clearInterval(metricsInterval);
    if (syncInterval) clearInterval(syncInterval);

    autoUpdater.stopPeriodicUpdateChecks();

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
