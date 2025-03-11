// src/index.js
const config = require('./config/config');
const { initializeDb, sendMetrics, sendFinalMetrics, systemId } = require('./services/metricService');

async function handleShutdown() {
    console.log('\nInitiating graceful shutdown...');
    await sendFinalMetrics();
    process.exit(0);
}

async function startClient() {
    console.log('Starting client...');
    console.log('System ID:', systemId);

    try {
        // Initialize database first
        await initializeDb();
        console.log('Database initialized successfully');

        // Initial metrics send
        await sendMetrics();

        // Set up regular interval for sending metrics
        setInterval(sendMetrics, config.METRICS_INTERVAL);

        // Handle graceful shutdown
        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);

        console.log(`Metrics will be saved to database every ${config.METRICS_INTERVAL / 1000} seconds`);
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