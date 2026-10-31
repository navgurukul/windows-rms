require("../utils/logger");
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const log = require('electron-log');

// Configure electron-log to track auto-updater events in file
log.transports.file.level = 'info';
autoUpdater.logger = log;

// -------------------- AUTO-UPDATER CONFIGURATION --------------------

// 1. Automatically download updates in the background as soon as they are detected
autoUpdater.autoDownload = true;

// 2. Keep autoInstallOnAppQuit as true as an additional safety net
autoUpdater.autoInstallOnAppQuit = true;

// 3. Allow downgrade in case a rollback version needs to be distributed
autoUpdater.allowDowngrade = true;
autoUpdater.allowPrerelease = false;

// 4. Force standalone full installer download (completely silent background installation)
autoUpdater.disableWebInstaller = true;

// Internal state tracking
let updateCheckInterval = null;
let retryTimeout = null;
let isUpdating = false;
let updatePendingHandler = null;

/**
 * Register a listener to notify main.js when an update is downloaded and ready to install.
 * This allows main.js to release locks and clear timers before the installer executes.
 * @param {Function} handler - Callback invoked with update info prior to installation
 */
function setUpdatePendingHandler(handler) {
  updatePendingHandler = handler;
}

/**
 * Check if an update has been downloaded and is actively installing/restarting.
 * Used by main.js to avoid intercepting or delaying the quit event during update.
 * @returns {boolean}
 */
function isUpdateInProgress() {
  return isUpdating;
}

// -------------------- EVENT LISTENERS --------------------

function initializeUpdateEvents() {
  // Checking for updates
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for available updates from GitHub release repository...');
  });

  // Update available
  autoUpdater.on('update-available', (info) => {
    const currentVer = app ? app.getVersion() : 'unknown';
    console.log(`[AutoUpdater] New update discovered: version ${info.version} (current version: ${currentVer}).`);
    console.log('[AutoUpdater] Downloading update package in background...');

    // Clear any pending retry timer since an update was found
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
  });

  // Update not available
  autoUpdater.on('update-not-available', (info) => {
    const currentVer = app ? app.getVersion() : (info && info.version ? info.version : 'latest');
    console.log(`[AutoUpdater] No updates available. Current version (${currentVer}) is up to date.`);
  });

  // Error during update cycle
  autoUpdater.on('error', (err) => {
    const errorMsg = err && err.message ? err.message : String(err);
    console.error('[AutoUpdater] Error encountered during update cycle:', errorMsg);

    // If check or download fails (e.g. temporary network drop) and update is not in progress,
    // retry automatically after 15 minutes instead of waiting for the full periodic interval.
    if (!retryTimeout && !isUpdating) {
      console.log('[AutoUpdater] Scheduling an automatic retry check in 15 minutes...');
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        checkForUpdates();
      }, 15 * 60 * 1000);
    }
  });

  // Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent || 0);
    const speed = progressObj.bytesPerSecond ? `${Math.round(progressObj.bytesPerSecond / 1024)} KB/s` : '';
    console.log(`[AutoUpdater] Download progress: ${percent}% ${speed ? `(${speed})` : ''}`);
  });

  // Update downloaded and verified
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[AutoUpdater] Update downloaded and verified successfully: version ${info.version}.`);

    if (isUpdating) {
      console.log('[AutoUpdater] Update installation is already underway. Ignoring duplicate trigger.');
      return;
    }
    isUpdating = true;

    // Clear any retry timer
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }

    // 1. Notify main.js to clean up intervals and prepare for immediate restart
    if (typeof updatePendingHandler === 'function') {
      try {
        updatePendingHandler(info);
      } catch (handlerErr) {
        console.error('[AutoUpdater] Error in updatePendingHandler callback:', handlerErr);
      }
    }

    // 2. Give a brief 1-second delay for logging and state flush, then execute silent install
    setTimeout(() => {
      try {
        console.log(`[AutoUpdater] Executing silent installation for version ${info.version}...`);

        // CRITICAL: Explicitly release the single-instance lock BEFORE quitting so that
        // the newly spawned installer / restarted application process can acquire the lock
        // without colliding with the shutting-down process.
        try {
          if (app && typeof app.releaseSingleInstanceLock === 'function') {
            app.releaseSingleInstanceLock();
            console.log('[AutoUpdater] Single-instance lock released successfully.');
          }
        } catch (lockErr) {
          console.warn('[AutoUpdater] Warning releasing single-instance lock:', lockErr.message);
        }

        // CRITICAL: Call quitAndInstall with:
        // - isSilent = true: Passes /S to the NSIS installer (completely silent, no user prompts)
        // - isForceRunAfter = true: Forces NSIS to relaunch SamaSystemAdmin after installation finishes
        autoUpdater.quitAndInstall(true, true);
      } catch (installErr) {
        console.error('[AutoUpdater] Critical error executing quitAndInstall:', installErr);
        isUpdating = false;
      }
    }, 1000);
  });
}

// -------------------- CHECK & SCHEDULER CONTROLS --------------------

/**
 * Initiates an immediate update check from the configured GitHub release repository.
 */
function checkForUpdates() {
  if (isUpdating) {
    console.log('[AutoUpdater] Update installation is currently in progress; skipping check.');
    return;
  }
  console.log('[AutoUpdater] Initiating check for updates...');
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[AutoUpdater] Error initiating checkForUpdates:', err && err.message ? err.message : err);
  });
}

/**
 * Starts periodic checks for updates at the specified interval.
 * Checks once immediately on startup, then periodically.
 * @param {number} intervalMs - Interval in milliseconds (default: 1 hour)
 * @returns {NodeJS.Timeout}
 */
function startPeriodicUpdateChecks(intervalMs = 3600000) {
  checkForUpdates(); // Check immediately on application start

  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }

  updateCheckInterval = setInterval(() => {
    console.log('[AutoUpdater] Running scheduled periodic update check...');
    checkForUpdates();
  }, intervalMs);

  console.log(`[AutoUpdater] Automatic update checks scheduled every ${Math.round(intervalMs / 60000)} minutes.`);
  return updateCheckInterval;
}

/**
 * Stops periodic update checks and clears retry timers.
 */
function stopPeriodicUpdateChecks() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
    console.log('[AutoUpdater] Periodic update checks stopped.');
  }
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
}

// Initialize event listeners when module is loaded
initializeUpdateEvents();

// Export functions and state accessors
module.exports = {
  checkForUpdates,
  startPeriodicUpdateChecks,
  stopPeriodicUpdateChecks,
  setUpdatePendingHandler,
  isUpdateInProgress,
  autoUpdater
};
