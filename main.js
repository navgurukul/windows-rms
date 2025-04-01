const { app, BrowserWindow } = require('electron');
const path = require('path');
const config = require('./config/config');
const metricService = require('./services/metricService');
const { setWallpaper } = require('./services/updateWallpaperWithVBS');
const { installSoftware } = require('./services/softwareInstallationService');
const axios = require('axios');
const autoUpdater = require('./services/autoUpdaterService');

// Keep a global reference of the window object
let mainWindow;
let metricsInterval;
let syncInterval;

// Function to fetch wallpaper URL from API and set it
async function fetchAndSetWallpaper() {
  try {
    console.log('Fetching wallpaper URL...');
    const fetchWallpaper = await axios.get('https://windows-socket.thesama.in/api/wallpaper');
    const url = fetchWallpaper.data.wallpaper;
    console.log('Wallpaper URL fetched:', url);
    setWallpaper(url); // Set the wallpaper
  } catch (error) {
    console.error('Error fetching wallpaper:', error.message);
  }
}

// Function to handle the metrics collection
async function startMetricsCollection() {
  console.log('Starting metrics collection...');
  console.log('System ID:', metricService.systemId);
  console.log('Data file location:', metricService.getDataFilePath());

  try {
    // Initialize files first
    await metricService.initializeFiles();
    console.log('Files initialized successfully');

    // Set up regular interval for updating metrics - every minute
    const METRICS_INTERVAL = 60 * 1000; // 1 minute
    metricsInterval = setInterval(metricService.updateMetrics, METRICS_INTERVAL);

    // Set up regular interval for syncing with server - every 20 minutes
    const SYNC_INTERVAL = 20 * 60 * 1000; // 20 minutes
    syncInterval = setInterval(async () => {
      console.log('Attempting scheduled data sync with server...');
      await metricService.syncData();
    }, SYNC_INTERVAL);

    console.log(`Metrics will be updated every minute`);
    console.log(`Data sync will be attempted every 20 minutes`);

    // Set up regular interval for sending metrics
    console.log(`Metrics will be saved to database every ${config.METRICS_INTERVAL / 1000} seconds`);

    // Return the interval so it can be cleared later if needed
    return metricsInterval;
  } catch (error) {
    console.error('Error starting metrics collection:', error);
    return null;
  }
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the index.html file
  mainWindow.loadFile('index.html');

  // Uncomment to open DevTools for debugging
  // mainWindow.webContents.openDevTools();

  // Handle window being closed
  mainWindow.on('closed', function () {
    mainWindow = null;
  });

  return mainWindow;
}

// When Electron has finished initialization
app.whenReady().then(async () => {
  // Start the metrics collection
  const metricsInterval = await startMetricsCollection();

  // Create the application window
  mainWindow = createWindow();

  // Start auto-updater checks (every 6 hours)
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  autoUpdater.startPeriodicUpdateChecks(SIX_HOURS);

  // Fetch and set wallpaper on startup
  await fetchAndSetWallpaper();

  // Install software on startup
  // installSoftware('Brave'); // Change software name

  // Handle app activation (macOS)
  app.on('activate', function () {
    if (mainWindow === null) createWindow();
  });
});

// Handle graceful shutdown
async function handleShutdown() {
  console.log('\nInitiating graceful shutdown...');
  try {
    // Clear the intervals to stop collecting metrics and syncing
    if (metricsInterval) {
      clearInterval(metricsInterval);
    }
    if (syncInterval) {
      clearInterval(syncInterval);
    }
    
    // Stop auto updater periodic checks
    autoUpdater.stopPeriodicUpdateChecks();

    await metricService.sendFinalMetrics(); // This includes a final sync attempt
    app.quit();
  } catch (error) {
    console.error('Error during shutdown:', error);
    app.exit(1);
  }
}

// Handle all windows being closed
app.on('window-all-closed', async function () {
  await handleShutdown();
  if (process.platform !== 'darwin') app.quit();
});

// Handle app before quit
app.on('before-quit', async (event) => {
  event.preventDefault();
  await handleShutdown();
});

// Handle process termination signals
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);