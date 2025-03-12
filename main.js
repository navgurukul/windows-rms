const { app, BrowserWindow } = require('electron');
const path = require('path');
const config = require('./config/config');
const { initializeDb, sendMetrics, sendFinalMetrics, systemId } = require('./services/metricService');
const { setWallpaper } = require('./services/updateWallpaperWithVBS');
const axios = require('axios');

// Keep a global reference of the window object to prevent it from being garbage collected
let mainWindow;

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
  console.log('System ID:', systemId);

  try {
    // Initialize database first
    await initializeDb();
    console.log('Database initialized successfully');

    // Initial metrics send
    await sendMetrics();

    // Set up regular interval for sending metrics
    const metricsInterval = setInterval(sendMetrics, config.METRICS_INTERVAL);
    
    console.log(`Metrics will be saved to database every ${config.METRICS_INTERVAL / 1000} seconds`);
    
    // Return the interval so it can be cleared later if needed
    return metricsInterval;
  } catch (error) {
    console.error('Error starting metrics collection:', error.message);
    return null;
  }
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
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
  mainWindow.on('closed', function() {
    mainWindow = null;
  });
}

// When Electron has finished initialization
app.whenReady().then(async () => {
  // Start the metrics collection
  const metricsInterval = await startMetricsCollection();
  
  // Create the application window
  createWindow();

  // Fetch and set wallpaper on startup
  await fetchAndSetWallpaper(); 
  
  // Handle app activation (macOS)
  app.on('activate', function() {
    if (mainWindow === null) createWindow();
  });
});

// Handle graceful shutdown
async function handleShutdown() {
  console.log('\nInitiating graceful shutdown...');
  try {
    await sendFinalMetrics();
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