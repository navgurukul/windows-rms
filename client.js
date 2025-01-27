const os = require('os');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    SERVER_URL: 'http://localhost:3000',
    METRICS_INTERVAL: 10000, // 10 seconds for testing
    RETRY_INTERVAL: 5000,    // 5 seconds retry interval
    INSTALL_DIR: path.join(os.tmpdir(), 'software_installs')
};

// Session and system tracking variables
let sessionStartTime = Date.now();
let lastMetricsSend = Date.now();
const clientId = `${os.hostname()}-${Date.now()}`;
const systemId = generateSystemId();

// Software Installation Functions
async function installSoftware(softwareName) {
    console.log(`\nAttempting to install ${softwareName}...`);

    try {
        // PowerShell command to install silently
        const psCommand = `
            $progressPreference = 'silentlyContinue';
            if (!(Get-Package -Name "${softwareName}" -ErrorAction SilentlyContinue)) {
                winget install --id "${softwareName}" --silent --accept-package-agreements --accept-source-agreements | Out-Null
            }
        `;

        // Execute PowerShell command with hidden window
        const { stdout, stderr } = await execAsync(`powershell.exe -WindowStyle Hidden -Command "${psCommand}"`);

        console.log('\nInstallation Output:', stdout);

        if (stderr) {
            console.error('Installation Warnings:', stderr);
        }

        console.log(`\nSuccessfully installed ${softwareName}`);
        await cleanupInstallFiles();
        return true;
    } catch (error) {
        console.error(`Error installing ${softwareName}:`, error.message);
        return false;
    }
}

async function cleanupInstallFiles() {
    try {
        const wingetCache = path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe', 'LocalCache', 'Downloaded');

        // Clean winget cache
        await execAsync(`powershell.exe -Command "Remove-Item -Path '${wingetCache}\\*' -Recurse -Force -ErrorAction SilentlyContinue"`);

        console.log('Cleaned up installation files');
    } catch (error) {
        console.error('Error during cleanup:', error.message);
    }
}

async function processCommand(command) {
    if (!command) return;

    const [action, ...params] = command.split(':');

    switch (action.toLowerCase()) {
        case 'install':
            const softwareName = params.join(':');
            return await installSoftware(softwareName);
        default:
            console.log(`Unknown command: ${action}`);
            return false;
    }
}

// System Monitoring Functions
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

async function sendSessionMetrics(retryCount = 0) {
    const currentTime = Date.now();
    const sessionDuration = currentTime - sessionStartTime;

    try {
        const location = await getSystemLocation();
        const metrics = {
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
            system: {
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
            },
            date: new Date().toISOString().split('T')[0]
        };

        console.clear();
        console.log('\nSession Status Update:', new Date().toISOString());
        console.log('System ID:', systemId);
        console.log('Location:', location.computerName, '(' + location.domain + ')');
        console.log('Session Duration:', metrics.session.duration.formatted);
        console.log('Memory Usage:', metrics.system.memory.usagePercent + '%');
        console.log('CPU Load (1m):', metrics.system.cpu.loadAvg[0].toFixed(2));

        const response = await axios.post(`${CONFIG.SERVER_URL}/metrics/${clientId}`, metrics);
        if (response.data.status === 'received') {
            lastMetricsSend = currentTime;

            // Check for commands in the response
            if (response.data.command) {
                await processCommand(response.data.command);
            }
        }
    } catch (error) {
        console.error('Error sending metrics:', error.message);

        if (retryCount < 3) {
            const retryDelay = CONFIG.RETRY_INTERVAL * Math.pow(2, retryCount);
            console.log(`Retrying in ${retryDelay / 1000} seconds...`);
            setTimeout(() => sendSessionMetrics(retryCount + 1), retryDelay);
        }
    }
}

function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    return `${hours}h ${minutes}m ${remainingSeconds}s`;
}

async function handleShutdown() {
    console.log('\nInitiating graceful shutdown...');

    try {
        const endTime = Date.now();
        const finalMetrics = {
            clientId,
            systemId,
            type: 'SESSION_END',
            session: {
                startTime: new Date(sessionStartTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                totalDuration: formatDuration(endTime - sessionStartTime)
            },
            date: new Date().toISOString().split('T')[0]
        };

        await axios.post(`${CONFIG.SERVER_URL}/metrics/${clientId}`, finalMetrics);
        console.log('Final session metrics sent successfully');
    } catch (error) {
        console.error('Error sending final metrics:', error.message);
    }

    process.exit(0);
}

async function startClient() {
    console.log('Starting client...');
    console.log('System ID:', systemId);
    console.log('Client ID:', clientId);

    try {
        // Test software installation (uncomment to test)
        await installSoftware('VideoLAN.VLC');

        // Initial metrics send
        await sendSessionMetrics();

        // Set up regular interval for sending metrics
        setInterval(sendSessionMetrics, CONFIG.METRICS_INTERVAL);

        // Handle graceful shutdown
        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);

        console.log(`Metrics will be sent every ${CONFIG.METRICS_INTERVAL / 1000} seconds`);
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