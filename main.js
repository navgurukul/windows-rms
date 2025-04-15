const { app, BrowserWindow } = require("electron");
const path = require("path");
const config = require("./config/config");
const metricService = require("./services/metricService");
const { setWallpaper } = require("./services/updateWallpaperWithVBS");
const {
  installSoftware,
  main,
} = require("./services/softwareInstallationService");
const axios = require("axios");
const autoUpdater = require("./services/autoUpdaterService");

// Keep a global reference of the window object
let mainWindow;
let metricsInterval;
let syncInterval;
let logBuffer = []; // Store logs before window is ready
let isShuttingDown = false; // Flag to prevent multiple shutdown attempts

// Override console methods to display logs in the window
const originalConsole = { ...console };

function addToLogBuffer(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  logBuffer.push({ level, text: logEntry });

  // Keep buffer from growing too large
  if (logBuffer.length > 100) {
    logBuffer.shift();
  }
}

function sendLogToWindow(level, ...args) {
  const message = args.join(" ");

  // Add to buffer first (in case window isn't ready)
  addToLogBuffer(level, message);

  // Send to window if it exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents
      .executeJavaScript(
        `
      (function() {
        // Create log container if it doesn't exist
        let logContainer = document.getElementById('electron-log-container');
        if (!logContainer) {
          logContainer = document.createElement('div');
          logContainer.id = 'electron-log-container';
          logContainer.style.position = 'fixed';
          logContainer.style.bottom = '0';
          logContainer.style.left = '0';
          logContainer.style.right = '0';
          logContainer.style.maxHeight = '150px';
          logContainer.style.overflow = 'auto';
          logContainer.style.backgroundColor = 'rgba(0,0,0,0.8)';
          logContainer.style.color = 'white';
          logContainer.style.fontFamily = 'monospace';
          logContainer.style.fontSize = '12px';
          logContainer.style.padding = '5px';
          logContainer.style.zIndex = '9999';
          logContainer.style.borderTop = '1px solid #444';
          document.body.appendChild(logContainer);
          
          // Add toggle button
          const toggleButton = document.createElement('button');
          toggleButton.textContent = 'Hide Logs';
          toggleButton.style.position = 'fixed';
          toggleButton.style.right = '5px';
          toggleButton.style.bottom = '155px';
          toggleButton.style.zIndex = '10000';
          toggleButton.style.padding = '2px 5px';
          toggleButton.style.fontSize = '10px';
          toggleButton.onclick = function() {
            if (logContainer.style.display === 'none') {
              logContainer.style.display = 'block';
              this.textContent = 'Hide Logs';
            } else {
              logContainer.style.display = 'none';
              this.textContent = 'Show Logs';
            }
          };
          document.body.appendChild(toggleButton);
        }
        
        // Add the log message
        const logEntry = document.createElement('div');
        logEntry.textContent = '${message.replace(/'/g, "\\'")}';
        
        // Set color based on log level
        if ('${level}' === 'error') {
          logEntry.style.color = '#ff6b6b';
        } else if ('${level}' === 'warn') {
          logEntry.style.color = '#feca57';
        } else {
          logEntry.style.color = '#ffffff';
        }
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
      })();
    `
      )
      .catch((err) =>
        originalConsole.error("Failed to send log to window:", err)
      );
  }
}

// Add flush buffer function to send all buffered logs when window is ready
function flushLogBuffer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    logBuffer.forEach((log) => {
      sendLogToWindow(log.level, log.text);
    });
    logBuffer = [];
  }
}

// Override console methods
console.log = (...args) => {
  originalConsole.log(...args);
  sendLogToWindow("info", ...args);
};

console.error = (...args) => {
  originalConsole.error(...args);
  sendLogToWindow("error", ...args);
};

console.warn = (...args) => {
  originalConsole.warn(...args);
  sendLogToWindow("warn", ...args);
};

// Function to fetch wallpaper URL from API and set it
async function fetchAndSetWallpaper() {
  try {
    console.log("Fetching wallpaper URL...");
    const fetchWallpaper = await axios.get(
      "https://windows-socket.thesama.in/api/wallpaper"
    );
    const url = fetchWallpaper.data.wallpaper;
    console.log("Wallpaper URL fetched:", url);

    console.log(
      "VBS script location:",
      require("./services/updateWallpaperWithVBS").getSystemDataFolder()
    );
    setWallpaper(url); // Set the wallpaper
  } catch (error) {
    console.error("Error fetching wallpaper:", error.message);
  }
}

// Function to handle the metrics collection
async function startMetricsCollection() {
  console.log("Starting metrics collection...");
  console.log("System ID:", metricService.systemId);
  console.log("Data file location:", metricService.getDataFilePath());

  try {
    // Initialize files first
    await metricService.initializeFiles();
    console.log("Files initialized successfully");

    // Set up regular interval for updating metrics - every minute
    const METRICS_INTERVAL = 60 * 1000; // 1 minute
    metricsInterval = setInterval(
      metricService.updateMetrics,
      METRICS_INTERVAL
    );

    // Set up regular interval for syncing with server - every 20 minutes
    const SYNC_INTERVAL = 20 * 60 * 1000; // 20 minutes
    syncInterval = setInterval(async () => {
      console.log("Attempting scheduled data sync with server...");
      await metricService.syncData();
    }, SYNC_INTERVAL);

    console.log(`Metrics will be updated every minute`);
    console.log(`Data sync will be attempted every 20 minutes`);

    // Set up regular interval for sending metrics
    console.log(
      `Metrics will be saved to database every ${
        config.METRICS_INTERVAL / 1000
      } seconds`
    );

    // Return the interval so it can be cleared later if needed
    return metricsInterval;
  } catch (error) {
    console.error("Error starting metrics collection:", error);
    return null;
  }
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    // show: false,
    width: 400,
    height: 400,
    skipTaskbar: true,
    icon: path.join(__dirname, "icons", "sama.ico"), // Add this line
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Load the index.html file
  mainWindow.loadFile("index.html");

  // After window loads, flush any buffered logs
  mainWindow.webContents.on("did-finish-load", () => {
    flushLogBuffer();
  });

  // Uncomment to open DevTools for debugging
  // mainWindow.webContents.openDevTools();

  // Handle window being closed
  mainWindow.on("closed", function () {
    mainWindow = null;
  });

  return mainWindow;
}

// When Electron has finished initialization
app.whenReady().then(async () => {
  console.log("===================================");
  main();
  console.log("===================================");

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
  app.on("activate", function () {
    if (mainWindow === null) createWindow();
  });
});

// Handle graceful shutdown
async function handleShutdown() {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log("\nInitiating graceful shutdown...");

  try {
    // Clear the intervals to stop collecting metrics and syncing
    if (metricsInterval) {
      clearInterval(metricsInterval);
      metricsInterval = null;
    }

    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }

    // Stop auto updater periodic checks
    autoUpdater.stopPeriodicUpdateChecks();

    try {
      // Set a timeout to force quit if the final metrics take too long
      const forceQuitTimeout = setTimeout(() => {
        console.log("Forcing app quit due to timeout...");
        app.exit(0);
      }, 5000); // 5 seconds timeout

      await metricService.sendFinalMetrics(); // This includes a final sync attempt

      // Clear the timeout since we completed successfully
      clearTimeout(forceQuitTimeout);

      // Properly exit
      app.exit(0);
    } catch (finalError) {
      console.error("Error sending final metrics:", finalError);
      app.exit(1);
    }
  } catch (error) {
    console.error("Error during shutdown:", error);
    app.exit(1);
  }
}

// Handle all windows being closed
app.on("window-all-closed", function () {
  handleShutdown();
  // Don't call app.quit() here as handleShutdown will do it
});

// Handle app before quit
app.on("before-quit", (event) => {
  // Only prevent default if we haven't started shutdown yet
  if (!isShuttingDown) {
    event.preventDefault();
    handleShutdown();
  }
});

// Handle process termination signals
process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
