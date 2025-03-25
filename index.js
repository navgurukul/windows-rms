const config = require('./config/config');
const metricService = require('./services/metricService');


const { 
  initAutoUpdater, 
  checkForUpdatesAndNotify, 
  setupAutoUpdateChecks 
} = require('./autoUpdater');

let metricsInterval;
let syncInterval;
let updateCheckInterval;

async function handleShutdown() {
    console.log('\nInitiating graceful shutdown...');
    
    // Clear the intervals to stop collecting metrics and syncing
    if (metricsInterval) {
        clearInterval(metricsInterval);
    }
    if (syncInterval) {
        clearInterval(syncInterval);
    }
    if (updateCheckInterval) {
        clearInterval(updateCheckInterval);
    }
    
    await metricService.sendFinalMetrics(); // This includes a final sync attempt
    process.exit(0);
}

async function startClient() {
    console.log('Starting client...');
    console.log('System ID:', metricService.systemId);

    try {
        // Initialize auto-updater
        initAutoUpdater();
        
        // Check for updates on startup
        checkForUpdatesAndNotify();
        
        // Setup regular checks for updates (every hour)
        updateCheckInterval = setupAutoUpdateChecks();
        
        // Initialize JSON file first
        await metricService.initializeJsonFile();
        console.log('JSON file initialized successfully');

        // Initial metrics send
        await metricService.sendMetrics();

        // Set up regular interval for sending metrics
        metricsInterval = setInterval(metricService.sendMetrics, config.METRICS_INTERVAL);
        
        // Set up regular interval for syncing with server (every hour)
        const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
        syncInterval = setInterval(async () => {
            console.log('Attempting scheduled data sync with server...');
            await metricService.syncDataWithServer();
        }, SYNC_INTERVAL);

        // Handle graceful shutdown
        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);

        console.log(`Metrics will be saved to JSON file every ${config.METRICS_INTERVAL / 1000} seconds`);
        console.log(`Data sync will be attempted every hour`);
    } catch (error) {
        console.error('Error starting client:', error.message);
        process.exit(1);
    }
}

// Start the client
startClient().catch(error => {
    console.error('Fatal error starting client:', error);
    process.exit(1);
});