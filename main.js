const { app, BrowserWindow } = require('electron');
const path = require('path');
const metricService = require('./services/metricService');

// Keep a global reference of the window object
let mainWindow;
let metricsInterval;
let syncInterval;

// Function to handle the metrics collection
async function startMetricsCollection() {
  console.log('Starting metrics collection...');
  console.log('System ID:', metricService.systemId);

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
    
    return metricsInterval;
  } catch (error) {
    console.error('Error starting metrics collection:', error);
    return null;
  }
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 100,
    height: 100,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the index.html file
  mainWindow.loadFile('index.html');
  
  // Handle window being closed
  mainWindow.on('closed', function() {
    mainWindow = null;
  });
}

// When Electron has finished initialization
app.whenReady().then(async () => {
  // Start the metrics collection
  metricsInterval = await startMetricsCollection();
  
  // Create the application window
  createWindow();
  
  // Handle app activation (macOS)
  app.on('activate', function() {
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
    
    await metricService.sendFinalMetrics(); // This includes a final sync attempt
    app.quit();
  } catch (error) {
    console.error('Error during shutdown:', error);
    app.exit(1);
  }
}

// Handle all windows being closed
app.on('window-all-closed', async function() {
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