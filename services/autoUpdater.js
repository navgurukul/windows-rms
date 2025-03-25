// autoUpdater.js
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging for auto-updater
log.transports.file.level = 'debug';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Initialize auto-updater
function initAutoUpdater() {
  // Set up auto-updater events
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
  });

  autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater:', err);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
    log.info(logMessage);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded; will install now');
    // Install the update automatically
    autoUpdater.quitAndInstall();
  });
}

// Function to check for updates
function checkForUpdates() {
  autoUpdater.checkForUpdates()
    .catch(err => {
      log.error('Error checking for updates:', err);
    });
}

// Function to check for updates and notify
function checkForUpdatesAndNotify() {
  autoUpdater.checkForUpdatesAndNotify()
    .catch(err => {
      log.error('Error checking for updates and notifying:', err);
    });
}

// Setup regular checks for updates
function setupAutoUpdateChecks(interval = 60 * 60 * 1000) { // Default: 1 hour
  return setInterval(() => {
    log.info('Scheduled update check started');
    checkForUpdates();
  }, interval);
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  checkForUpdatesAndNotify,
  setupAutoUpdateChecks
};