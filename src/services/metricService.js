// src/services/metricsService.js
const axios = require('axios');
const os = require('os');
const config = require('../config/config');
const {
    generateSystemId,
    getSystemInfo,
    getSystemLocation,
    formatDuration
} = require('../utils/systemUtils');

const sessionStartTime = Date.now();
const clientId = `${os.hostname()}-${Date.now()}`;
console.log("this is the client id")
const systemId = generateSystemId();

function displayMetrics(metrics) {
    console.clear();
    // console.log('\nSession Status Update:', new Date().toISOString());
    // console.log('System ID:', systemId);
    // console.log('Location:', metrics.location.computerName, '(' + metrics.location.domain + ')');
    // console.log('Session Duration:', metrics.session.duration.formatted);
    // console.log('Memory Usage:', metrics.system.memory.usagePercent + '%');
    // console.log('CPU Load (1m):', metrics.system.cpu.loadAvg[0].toFixed(2));
}

async function collectMetrics() {
    const currentTime = Date.now();
    const sessionDuration = currentTime - sessionStartTime;
    const location = await getSystemLocation();

    return {
        clientId,
        systemId,
        timestamp: new Date().toISOString(),
        session: {
            startTime: new Date(sessionStartTime).toISOString(),
            currentTime: new Date(currentTime).toISOString(),
            duration: {
                milliseconds: sessionDuration,
                formatted: formatDuration(sessionDuration)
            }
        },
        location,
        system: getSystemInfo(),
        date: new Date().toISOString().split('T')[0]
    };
}

async function sendMetrics(retryCount = 0) {
    console.log("this is the function that is called")
    try {
        const metrics = await collectMetrics();
        displayMetrics(metrics);

        const response = await axios.post(`${config.SERVER_URL}/metrics`, metrics);
        
        if (response.data.status === 'received') {
            return true;
        }
    } catch (error) {
        console.error('Error sending metrics:', error.message);

        if (retryCount < config.MAX_RETRIES) {
            const retryDelay = config.RETRY_INTERVAL * Math.pow(2, retryCount);
            console.log(`Retrying in ${retryDelay / 1000} seconds...`);
            setTimeout(() => sendMetrics(retryCount + 1), retryDelay);
        }
        return false;
    }
}

async function sendFinalMetrics() {
    try {
        const endTime = Date.now();
        const location = await getSystemLocation();
        
        const finalMetrics = {
            clientId,
            systemId,
            type: 'SESSION_END',
            session: {
                startTime: new Date(sessionStartTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                totalDuration: formatDuration(endTime - sessionStartTime)
            },
            location,
            system: getSystemInfo(),
            date: new Date().toISOString().split('T')[0]
        };
        console.log(`${config.SERVER_URL}/api/metrics/${clientId}`)

        await axios.post(`${config.SERVER_URL}/api/metrics/${clientId}`, finalMetrics);
        console.log('Final session metrics sent successfully');
        return true;
    } catch (error) {
        console.error('Error sending final metrics:', error.message);
        return false;
    }
}  

module.exports = {
    sendMetrics,
    sendFinalMetrics,
    clientId,
    systemId
};