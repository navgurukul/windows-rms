// src/config/config.js
const config = {
    SERVER_URL: 'http://localhost:3000',
    METRICS_INTERVAL: 10000, // 10 seconds for testing
    RETRY_INTERVAL: 5000,    // 5 seconds retry interval
    MAX_RETRIES: 3
};

module.exports = config;