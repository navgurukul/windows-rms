// src/services/metricsService.js
const axios = require('axios');
const os = require('os');
const config = require('../config/config');

const sessionStartTime = Date.now();
const systemId = os.hostname();

async function getSystemLocation() {
    try {
        // Using ipapi.co for geolocation (free tier available)
        const response = await axios.get('https://ipapi.co/json/');
        return `${response.data.city}, ${response.data.region}`;
    } catch (error) {
        console.error('Error getting location:', error);
        return 'Location Unknown';
    }
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

async function collectMetrics() {
    const currentTime = Date.now();
    const activeTime = formatDuration(currentTime - sessionStartTime);
    const location = await getSystemLocation();

    return {
        system_id: systemId,
        name: os.hostname(),
        active_time: activeTime,
        location: location, // Will now be like "Pune, Maharashtra"
        date_of_entry: new Date().toISOString()
    };
}

async function sendMetrics(retryCount = 0) {
    try {
        const metrics = await collectMetrics();
        console.log('Sending metrics:', metrics);

        const response = await axios.post(`${config.SERVER_URL}/api/metrics`, metrics);
        console.log('Metrics sent successfully:', response.data);
        return true;
    } catch (error) {
        console.error('Error sending metrics:', error.message);
        if (retryCount < 3) {
            const retryDelay = 2000 * Math.pow(2, retryCount);
            console.log(`Retrying in ${retryDelay/1000} seconds...`);
            setTimeout(() => sendMetrics(retryCount + 1), retryDelay);
        }
        return false;
    }
}

module.exports = {
    sendMetrics,
    systemId
};