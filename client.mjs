import os from 'os';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    SERVER_URL: 'http://localhost:3000',
    METRICS_INTERVAL: 10000, // 10 seconds for testing
    RETRY_INTERVAL: 5000,    // 5 seconds retry interval
    INSTALL_DIR: path.join(os.tmpdir(), 'software_installs')
};

    // // Session and system tracking variables
    // let sessionStartTime = Date.now();
    // let lastMetricsSend = Date.now();
    // const clientId = `${os.hostname()}-${Date.now()}`;
    // const systemId = generateSystemId();

// Enhanced Software Installation Functions
async function checkWingetAvailability() {
    try {
        await execAsync('winget --version');
        return true;
    } catch (error) {
        console.error('Error: Winget is not installed on this system.');
        console.error('Please install App Installer from the Microsoft Store to use this script.');
        return false;
    }
}

async function searchSoftware(softwareName) {
    try {
        const { stdout } = await execAsync(`winget search "${softwareName}"`);
        console.log('\nAvailable packages:');
        console.log(stdout);

        if (!stdout.toLowerCase().includes(softwareName.toLowerCase())) {
            throw new Error(`Software "${softwareName}" not found in winget repository`);
        }

        return true;
    } catch (error) {
        console.error(`Error searching for ${softwareName}:`, error.message);
        return false;
    }
}

async function installSoftware(softwareName) {
    console.log(`\n=== Starting installation of ${softwareName} ===`);

    try {
        // First check if winget is available
        if (!await checkWingetAvailability()) {
            return false;
        }

        // Search for the software first
        console.log('\nSearching for software...');
        if (!await searchSoftware(softwareName)) {
            return false;
        }

        console.log('\nStarting installation...');

        // PowerShell command to install with progress
        const psCommand = `
            $progressPreference = 'Continue';
            Write-Host "Installing ${softwareName}...";
            winget install --id "${softwareName}" --accept-package-agreements --accept-source-agreements
        `;

        // Execute installation with real-time output
        const childProcess = exec(`powershell.exe -Command "${psCommand}"`);

        // Stream output in real-time
        childProcess.stdout.on('data', (data) => {
            console.log(data.toString().trim());
        });

        childProcess.stderr.on('data', (data) => {
            console.error('Error:', data.toString().trim());
        });

        // Wait for process to complete
        await new Promise((resolve, reject) => {
            childProcess.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Installation failed with code ${code}`));
                }
            });
        });

        console.log(`\n✓ Successfully installed ${softwareName}`);
        await cleanupInstallFiles();
        return true;
    } catch (error) {
        console.error(`\n✗ Error installing ${softwareName}:`, error.message);
        return false;
    }
}

async function cleanupInstallFiles() {
    try {
        const wingetCache = path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe', 'LocalCache', 'Downloaded');
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

    //     return crypto.createHash('sha256').update(systemInfo).digest('hex').substring(0, 12);
    // }

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

        console.log('\nSession Status Update:', new Date().toISOString());
        console.log('System ID:', systemId);
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

}