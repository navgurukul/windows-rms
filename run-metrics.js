// run-metrics.js
const { initializeJsonFile, sendMetrics, sendFinalMetrics, systemId } = require('./services/metricService');

// 20 minutes in milliseconds
const TWENTY_MINUTES = 20 * 60 * 1000;

async function startMetricsCollection() {
  try {
    console.log('Initializing JSON file...');
    await initializeJsonFile(); // This line is causing the error
    
    console.log('Starting metrics collection at 20-minute intervals');
    console.log(`Current time: ${new Date().toLocaleTimeString()}`);
    
    // Collect metrics immediately on startup
    console.log('Collecting initial metrics...');
    await sendMetrics();
    
    // Set up the 20-minute interval
    const interval = setInterval(async () => {
      const now = new Date();
      console.log(`\n--- Scheduled metrics collection at ${now.toLocaleTimeString()} ---`);
      try {
        await sendMetrics();
        console.log(`Next collection scheduled for: ${new Date(now.getTime() + TWENTY_MINUTES).toLocaleTimeString()}`);
      } catch (error) {
        console.error('Error during scheduled metrics collection:', error);
      }
    }, TWENTY_MINUTES);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down metrics collection...');
      clearInterval(interval);
      await sendFinalMetrics(); // Send final metrics
      console.log('Final metrics sent, exiting');
      process.exit(0);
    });
    
    console.log(`Next collection scheduled for: ${new Date(Date.now() + TWENTY_MINUTES).toLocaleTimeString()}`);
    console.log('Press Ctrl+C to stop');
    
  } catch (error) {
    console.error('Failed to start metrics collection:', error);
    process.exit(1);
  }
}

// Start the collection process
startMetricsCollection();