// installer.js
const { Service } = require('node-windows');
const path = require('path');
const fs = require('fs').promises;

async function install() {
    try {
        // Create program directory
        const programDir = path.join(process.env.PROGRAMFILES, 'WindowsRMSClient');
        await fs.mkdir(programDir, { recursive: true });

        // Copy client.js to program directory
        await fs.copyFile(
            path.join(__dirname, 'client.js'),
            path.join(programDir, 'client.js')
        );

        // Create and configure the service
        const svc = new Service({
            name: 'WindowsRMSClient',
            description: 'Windows Remote Management System Client',
            script: path.join(programDir, 'client.js')
        });

        // Install the service
        svc.on('install', () => {
            console.log('Service installed successfully');
            svc.start();
        });

        svc.on('start', () => {
            console.log('Service started');
            console.log('Installation complete! The client will start automatically on system boot.');
        });

        svc.on('error', (err) => {
            console.error('Service error:', err);
        });

        console.log('Installing service...');
        svc.install();

    } catch (error) {
        console.error('Installation failed:', error);
        process.exit(1);
    }
}

// Run installer
install().catch(console.error);