// src/utils/systemUtils.js
const os = require('os');
const crypto = require('crypto');

function generateSystemId() {
    const systemInfo = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.cpus()[0].model,
        os.totalmem()
    ].join('|');

    return crypto.createHash('sha256').update(systemInfo).digest('hex').substring(0, 12);
}

function getSystemInfo() {
    return {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        uptime: formatDuration(os.uptime() * 1000),
        memory: {
            total: os.totalmem(),
            free: os.freemem(),
            usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
        },
        cpu: {
            model: os.cpus()[0].model,
            cores: os.cpus().length,
            loadAvg: os.loadavg()
        }
    };
}

function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    return `${hours}h ${minutes}m ${remainingSeconds}s`;
}

async function getSystemLocation() {
    try {
        const interfaces = os.networkInterfaces();
        const networkInfo = Object.keys(interfaces)
            .filter(iface => interfaces[iface].some(addr => !addr.internal))
            .map(iface => ({
                name: iface,
                addresses: interfaces[iface]
                    .filter(addr => !addr.internal)
                    .map(addr => addr.address)
            }));

        return {
            hostname: os.hostname(),
            network: networkInfo,
            domain: os.hostname().split('.').slice(1).join('.') || 'local',
            computerName: process.env.COMPUTERNAME || os.hostname()
        };
    } catch (error) {
        console.error('Error getting system location:', error);
        return {
            hostname: os.hostname(),
            network: [],
            domain: 'unknown',
            computerName: os.hostname()
        };
    }
}

module.exports = {
    generateSystemId,
    getSystemInfo,
    getSystemLocation,
    formatDuration
};