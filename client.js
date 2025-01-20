// client.js
const os = require('os');
const axios = require('axios');
const { exec } = require('child_process');
const AutoLaunch = require('auto-launch');

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
    name: 'RemoteManagementClient',
    path: process.execPath,
});

// Enable auto-launch on startup
autoLauncher.enable();

class RemoteManagementClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.clientId = this.generateClientId();
        this.connected = false;
    }

    generateClientId() {
        return `${os.hostname()}-${Date.now()}`;
    }

    async registerWithServer() {
        try {
            const systemInfo = {
                hostname: os.hostname(),
                platform: os.platform(),
                release: os.release(),
                uptime: os.uptime(),
                clientId: this.clientId
            };

            const response = await axios.post(`${this.serverUrl}/register`, systemInfo);
            this.connected = true;
            console.log('Successfully registered with server:', response.data);
            return true;
        } catch (error) {
            console.error('Failed to register with server:', error.message);
            return false;
        }
    }

    async pollForCommands() {
        try {
            const response = await axios.get(`${this.serverUrl}/commands/${this.clientId}`);
            const commands = response.data;

            if (commands && commands.length > 0) {
                for (const command of commands) {
                    await this.executeCommand(command);
                }
            }
        } catch (error) {
            console.error('Error polling for commands:', error.message);
        }
    }

    async executeCommand(command) {
        try {
            switch (command.type) {
                case 'INSTALL_SOFTWARE':
                    await this.installSoftware(command.payload);
                    break;
                case 'UPDATE_CONFIG':
                    await this.updateConfiguration(command.payload);
                    break;
                default:
                    console.log('Unknown command type:', command.type);
            }

            // Report command execution status back to server
            await this.reportCommandStatus(command.id, 'completed');
        } catch (error) {
            console.error('Error executing command:', error);
            await this.reportCommandStatus(command.id, 'failed', error.message);
        }
    }

    async installSoftware(software) {
        return new Promise((resolve, reject) => {
            // Using PowerShell to install software silently
            const command = `Start-Process -Wait -FilePath "${software.installerPath}" -ArgumentList "/quiet /norestart"`;

            exec(`powershell -Command "${command}"`, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
    }

    async updateConfiguration(config) {
        // Implement configuration updates using Windows Registry or config files
        // This is a simplified example
        return new Promise((resolve, reject) => {
            const command = `reg add "${config.regPath}" /v "${config.name}" /t "${config.type}" /d "${config.value}" /f`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
    }

    async reportCommandStatus(commandId, status, error = null) {
        try {
            await axios.post(`${this.serverUrl}/command-status`, {
                clientId: this.clientId,
                commandId: commandId,
                status: status,
                error: error
            });
        } catch (error) {
            console.error('Failed to report command status:', error.message);
        }
    }

    async sendSystemMetrics() {
        const metrics = {
            uptime: os.uptime(),
            freeMemory: os.freemem(),
            totalMemory: os.totalmem(),
            cpuUsage: os.loadavg(),
            timestamp: new Date().toISOString()
        };

        try {
            await axios.post(`${this.serverUrl}/metrics/${this.clientId}`, metrics);
        } catch (error) {
            console.error('Failed to send metrics:', error.message);
        }
    }

    async start() {
        // Register with server
        const registered = await this.registerWithServer();
        if (!registered) {
            console.error('Failed to register with server. Retrying in 1 minute...');
            setTimeout(() => this.start(), 60000);
            return;
        }

        // Start polling for commands every 30 seconds
        setInterval(() => this.pollForCommands(), 30000);

        // Send system metrics every 5 minutes
        setInterval(() => this.sendSystemMetrics(), 300000);
    }
}

// Start the client
const client = new RemoteManagementClient('http://your-server-url:3000');
client.start();