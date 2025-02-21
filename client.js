    // const os = require('os');
    // const axios = require('axios');
    // const fs = require('fs').promises;
    // const path = require('path');
    // const crypto = require('crypto');

    // // Configuration
    // const CONFIG = {
    //     SERVER_URL: 'http://localhost:3000',
    //     METRICS_INTERVAL: 10000, // 10 seconds for testing (change to 600000 for 10 minutes in production)
    //     RETRY_INTERVAL: 5000     // 5 seconds retry interval
    // };

    // // Session and system tracking variables
    // let sessionStartTime = Date.now();
    // let lastMetricsSend = Date.now();
    // const clientId = `${os.hostname()}-${Date.now()}`;
    // const systemId = generateSystemId();

    // function generateSystemId() {
    //     // Generate a unique system ID based on hardware information
    //     const systemInfo = [
    //         os.hostname(),
    //         os.platform(),
    //         os.arch(),
    //         os.cpus()[0].model,
    //         os.totalmem()
    //     ].join('|');

    //     return crypto.createHash('sha256').update(systemInfo).digest('hex').substring(0, 12);
    // }

    // async function getSystemLocation() {
    //     try {
    //         // Get network interfaces to determine location context
    //         const interfaces = os.networkInterfaces();
    //         const networkInfo = Object.keys(interfaces)
    //             .filter(iface => interfaces[iface].some(addr => !addr.internal))
    //             .map(iface => ({
    //                 name: iface,
    //                 addresses: interfaces[iface]
    //                     .filter(addr => !addr.internal)
    //                     .map(addr => addr.address)
    //             }));

    //         return {
    //             hostname: os.hostname(),
    //             network: networkInfo,
    //             domain: os.hostname().split('.').slice(1).join('.') || 'local',
    //             computerName: process.env.COMPUTERNAME || os.hostname()
    //         };
    //     } catch (error) {
    //         console.error('Error getting system location:', error);
    //         return {
    //             hostname: os.hostname(),
    //             network: [],
    //             domain: 'unknown',
    //             computerName: os.hostname()
    //         };
    //     }
    // }

    // async function sendSessionMetrics(retryCount = 0) {
    //     const currentTime = Date.now();
    //     const sessionDuration = currentTime - sessionStartTime;

    //     try {
    //         const location = await getSystemLocation();
    //         const metrics = {
    //             clientId,
    //             systemId,
    //             timestamp: new Date().toISOString(),
    //             session: {
    //                 startTime: new Date(sessionStartTime).toISOString(),
    //                 currentTime: new Date(currentTime).toISOString(),
    //                 duration: {
    //                     milliseconds: sessionDuration,
    //                     formatted: formatDuration(sessionDuration)
    //                 }
    //             },
    //             location,
    //             system: {
    //                 hostname: os.hostname(),
    //                 platform: os.platform(),
    //                 arch: os.arch(),
    //                 release: os.release(),
    //                 uptime: formatDuration(os.uptime() * 1000),
    //                 memory: {
    //                     total: os.totalmem(),
    //                     free: os.freemem(),
    //                     usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
    //                 },
    //                 cpu: {
    //                     model: os.cpus()[0].model,
    //                     cores: os.cpus().length,
    //                     loadAvg: os.loadavg()
    //                 }
    //             },
    //             date: new Date().toISOString().split('T')[0]
    //         };

    //         // Log to console
    //         console.clear(); // Clear console for better readability
    //         console.log('\nSession Status Update:', new Date().toISOString());
    //         console.log('System ID:', systemId);
    //         console.log('Location:', location.computerName, '(' + location.domain + ')');
    //         console.log('Session Duration:', metrics.session.duration.formatted);
    //         console.log('Memory Usage:', metrics.system.memory.usagePercent + '%');
    //         console.log('CPU Load (1m):', metrics.system.cpu.loadAvg[0].toFixed(2));

    //         const response = await axios.post(`${CONFIG.SERVER_URL}/metrics/${clientId}`, metrics);
    //         if (response.data.status === 'received') {
    //             lastMetricsSend = currentTime;
    //         }
    //     } catch (error) {
    //         console.error('Error sending metrics:', error.message);

    //         // Implement retry logic with backoff
    //         if (retryCount < 3) {
    //             const retryDelay = CONFIG.RETRY_INTERVAL * Math.pow(2, retryCount);
    //             console.log(`Retrying in ${retryDelay / 1000} seconds...`);
    //             setTimeout(() => sendSessionMetrics(retryCount + 1), retryDelay);
    //         }
    //     }
    // }

    // function formatDuration(milliseconds) {
    //     const seconds = Math.floor(milliseconds / 1000);
    //     const hours = Math.floor(seconds / 3600);
    //     const minutes = Math.floor((seconds % 3600) / 60);
    //     const remainingSeconds = seconds % 60;

    //     return `${hours}h ${minutes}m ${remainingSeconds}s`;
    // }

    // async function handleShutdown() {
    //     console.log('\nInitiating graceful shutdown...');

    //     try {
    //         const endTime = Date.now();
    //         const finalMetrics = {
    //             clientId,
    //             systemId,
    //             type: 'SESSION_END',
    //             session: {
    //                 startTime: new Date(sessionStartTime).toISOString(),
    //                 endTime: new Date(endTime).toISOString(),
    //                 totalDuration: formatDuration(endTime - sessionStartTime)
    //             },
    //             date: new Date().toISOString().split('T')[0]
    //         };

    //         await axios.post(`${CONFIG.SERVER_URL}/metrics/${clientId}`, finalMetrics);
    //         console.log('Final session metrics sent successfully');
    //     } catch (error) {
    //         console.error('Error sending final metrics:', error.message);
    //     }

    //     process.exit(0);
    // }

    // async function startClient() {
    //     console.log('Starting client...');
    //     console.log('System ID:', systemId);
    //     console.log('Client ID:', clientId);

    //     try {
    //         // Initial metrics send
    //         await sendSessionMetrics();

    //         // Set up regular interval for sending metrics
    //         setInterval(sendSessionMetrics, CONFIG.METRICS_INTERVAL);

    //         // Handle graceful shutdown
    //         process.on('SIGINT', handleShutdown);
    //         process.on('SIGTERM', handleShutdown);

    //         console.log(`Metrics will be sent every ${CONFIG.METRICS_INTERVAL / 1000} seconds`);
    //     } catch (error) {
    //         console.error('Error starting client:', error.message);
    //         process.exit(1);
    //     }
    // }

    // // Start the client
    // startClient().catch(error => {
    //     console.error('Fatal error starting client:', error);
    //     process.exit(1);
    // });