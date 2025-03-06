// src/index.js
const config = require('./config/config');
const { sendMetrics, sendFinalMetrics, clientId, systemId } = require('./services/metricService');

async function handleShutdown() {
    console.log('\nInitiating graceful shutdown...');
    await sendFinalMetrics();
    process.exit(0);
}

async function startClient() {
    console.log('Starting client...');
    console.log('System ID:', systemId);

    try {
        // Initial metrics send
        await sendMetrics();

        // Set up regular interval for sending metrics
        setInterval(sendMetrics, config.METRICS_INTERVAL);

        // Handle graceful shutdown
        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);

        console.log(`Metrics will be sent every ${config.METRICS_INTERVAL / 1000} seconds`);
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