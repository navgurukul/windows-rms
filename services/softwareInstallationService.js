const { exec, execSync, spawn } = require('child_process');
const os = require('os');

function isAdmin() {
    try {
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch (error) {
        return false;
    }
}

function runAsAdmin(command) {
    return `powershell -Command "Start-Process cmd -ArgumentList '/c ${command}' -Verb RunAs"`;
}

function installSoftware(softwareName) {
    try {
        if (!softwareName) {
            console.log('Usage: node file_name.js <software-name>');
            return;
        }

        const platform = os.platform();
        let command;

        if (platform === 'win32') {
            command = `choco install ${softwareName} -y`;
        } else {
            throw new Error('Unsupported operating system');
        }
        console.log(`Executing: ${command}`);

        if (platform === 'win32' && !isAdmin()) {
            console.log("Re-launching with administrator privileges...");
            execSync(runAsAdmin(command));
            return;
        }

        const child = spawn(command, { shell: true, stdio: 'inherit' });
        child.on('close', (code) => {
            if (code === 0) {
                console.log(`${softwareName} installed successfully!`);
            } else {
                console.error(`Installation failed with code ${code}`);
            }
        });

    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

const softwareName = process.argv[2];
installSoftware(softwareName);