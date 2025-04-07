const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

// Configure auto updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// For completely silent updates
autoUpdater.allowDowngrade = true;
autoUpdater.allowPrerelease = false; // Set to true if you want to include pre-releases

// Prevent any install prompts (completely silent)
autoUpdater.disableWebInstaller = true;

let updateCheckInterval = null;

// Initialize update events
function initializeUpdateEvents() {
  // Checking for updates
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  // Update available
  autoUpdater.on('update-available', (info) => {
    console.log(`Update available! New version: ${info.version}`);
    console.log('Downloading update...');
  });

  // Update not available
  autoUpdater.on('update-not-available', (info) => {
    console.log('No updates available. Current version is the latest.');
  });

  // Error in auto-updater
  autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater:', err);
  });

  // Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    console.log(`Downloading update: ${Math.round(progressObj.percent)}% complete`);
  });

  // Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Update downloaded! Version ${info.version} will be installed on next restart.`);
    
    // To automatically install without waiting for app quit
    // Uncomment this if you want updates to install immediately when downloaded
    // autoUpdater.quitAndInstall(false, true);
  });
}

// Initial check for updates
function checkForUpdates() {
  console.log('Checking for updates...');
  autoUpdater.checkForUpdates()
    .catch(err => {
      console.error('Error checking for updates:', err);
    });
}

// Start periodic update checks
function startPeriodicUpdateChecks(intervalMs = 3600000) { // Default: check every hour
  checkForUpdates(); // Check immediately on start
  
  updateCheckInterval = setInterval(() => {
    console.log('Running scheduled update check...');
    checkForUpdates();
  }, intervalMs);
  
  console.log(`Automatic update checks scheduled every ${intervalMs/60000} minutes`);
  return updateCheckInterval;
}

// Stop periodic update checks
function stopPeriodicUpdateChecks() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
    console.log('Periodic update checks stopped');
  }
}

// Initialize events when this module is loaded
initializeUpdateEvents();

// Export functions
module.exports = {
  checkForUpdates,
  startPeriodicUpdateChecks,
  stopPeriodicUpdateChecks
};