const { execSync, spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");
const axios = require('axios');
const schedule = require('node-cron');
const { BACKEND_BASE_URL } = require('../config/config');
const { getSerialNumber } = require('./metricService');
const { ensureChocolateyInstalled } = require('./chocolateyService');

function isAdmin() {
    try {
        execSync("net session", { stdio: "ignore" });
        return true;
    } catch (error) {
        return false;
    }
}

function runAsAdmin(command) {
    const tempDir = os.tmpdir();
    const batchFile = path.join(tempDir, "install_command.bat");

    fs.writeFileSync(batchFile, `@echo off\n${command}\npause`);

    return `powershell -Command "Start-Process -FilePath '${batchFile}' -Verb RunAs"`;
}

function getFutureTime(minutesAhead = 3) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutesAhead);
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function getInstallPath(softwareName) {
    try {
        const registryPath = `HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*`;
        const installPathCmd = `powershell -Command "(Get-ItemProperty '${registryPath}' | Where-Object { $_.DisplayName -like '*${softwareName}*' }).InstallLocation"`;
        const installPath = execSync(installPathCmd, { encoding: "utf-8" }).trim();

        if (installPath) {
            return installPath;
        } else {
            const registryPath32 = `HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*`;
            const installPathCmd32 = `powershell -Command "(Get-ItemProperty '${registryPath32}' | Where-Object { $_.DisplayName -like '*${softwareName}*' }).InstallLocation"`;
            const installPath32 = execSync(installPathCmd32, { encoding: "utf-8" }).trim();

            if (installPath32) {
                return installPath32;
            }

            console.log(`Unable to find installation path for ${softwareName}.`);
            return null;
        }
    } catch (error) {
        console.log(`Error retrieving installation path: ${error.message}`);
        return null;
    }
}

function createShortcut(softwareName, installPath) {
    if (!installPath) {
        console.log(`Cannot create shortcut: Installation path not found.`);
        return;
    }

    let targetPath = installPath;
    try {
        const files = fs.readdirSync(installPath);
        const exeFiles = files.filter(file => file.endsWith('.exe'));
        if (exeFiles.length > 0) {
            const matchingSoftwareExe = exeFiles.find(file =>
                file.toLowerCase().includes(softwareName.toLowerCase())
            );
            const exeFile = matchingSoftwareExe || exeFiles[0];
            targetPath = path.join(installPath, exeFile);
        }
    } catch (error) {
        console.log(`Warning: Could not read directory contents: ${error.message}`);
    }

    const desktopPath = path.join(os.homedir(), "Desktop");
    const shortcutPath = path.join(desktopPath, `${softwareName}.lnk`);

    const powershellCmd = `
        $WScriptShell = New-Object -ComObject WScript.Shell;
        $Shortcut = $WScriptShell.CreateShortcut('${shortcutPath}');
        $Shortcut.TargetPath = '${targetPath}';
        $Shortcut.WorkingDirectory = '${path.dirname(targetPath)}';
        $Shortcut.Save();
    `;

    try {
        execSync(`powershell -Command "${powershellCmd}"`);
        console.log(`Shortcut created on Desktop for ${softwareName}`);
    } catch (error) {
        console.log(`Failed to create shortcut: ${error.message}`);
    }
}

function installSoftware(softwareName) {
    try {
        if (!softwareName) {
            console.log("Usage: node file_name.js <software-name>");
            return;
        }

        const platform = os.platform();

        if (platform !== "win32") {
            throw new Error("Unsupported operating system. This script only works on Windows.");
        }

        const command = `choco install ${softwareName} -y`;
        console.log(`Preparing to install: ${softwareName}`);

        if (!isAdmin()) {
            console.log("Requesting administrator privileges...");
            try {
                const adminCommand = runAsAdmin(command);
                execSync(adminCommand);
                console.log("Installation process launched with admin privileges.");
                console.log("Please check the opened admin window to monitor installation progress.");

                console.log("Once installation is complete, run this script again with admin privileges to create shortcuts.");
                return;
            } catch (error) {
                console.error(`Failed to launch with admin privileges: ${error.message}`);
                return;
            }
        }

        console.log(`Executing: ${command}`);
        const child = spawn(command, { shell: true, stdio: "inherit" });

        child.on("close", (code) => {
            if (code === 0) {
                console.log(`${softwareName} installed successfully!`);

                const installPath = getInstallPath(softwareName);
                if (installPath) {
                    console.log(`Installed at: ${installPath}`);
                    createShortcut(softwareName, installPath);
                }
            } else {
                console.error(`Installation failed with code ${code}`);
            }
        });

    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

async function installViaScheduledTask(softwareName) {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `${softwareName}-install.ps1`);
    const logPath = path.join(tempDir, `${softwareName}-install.log`);
    const taskName = `SilentInstall_${softwareName}_${Date.now()}`;
    const startTime = getFutureTime(2);

    // Create PowerShell script (with logging)

    const psContent = `
        Start-Transcript -Path "${logPath}" -Append
        choco install ${softwareName} -y --no-progress --force --install-arguments "/S /D=C:\\System.ServiceData\\Softwares\\${softwareName}"
        Stop-Transcript
    `;

    // const psContent = `
    //     Start-Transcript -Path "${logPath}" -Append
    //     choco install ${softwareName} -y --no-progress --force 
    //     Stop-Transcript
    // `;
    fs.writeFileSync(scriptPath, psContent);

    console.log(`PowerShell script: ${scriptPath}`);
    console.log(`Log file will be: ${logPath}`);
    console.log(`Task name: ${taskName} scheduled for: ${startTime}`);

    // Escape path for use inside schtasks string
    const escapedScriptPath = scriptPath.replace(/\\/g, '\\\\');

    try {
        const taskCmd = `schtasks /Create /TN "${taskName}" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${escapedScriptPath}\\"" /SC ONCE /ST ${startTime} /RL HIGHEST /RU "%USERNAME%" /F`;
        
        // const taskCmd = `schtasks /Create /TN "${taskName}" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${escapedScriptPath}\\"" /SC ONCE /ST ${startTime} /RL HIGHEST /RU SYSTEM /F`;

        // schtasks /Create /TN "SilentInstall_brave" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \"C:\\Temp\\brave-install.ps1\"" /SC ONCE /ST 23:59 /RL HIGHEST /RU "%USERNAME%" /F

        execSync(taskCmd);
        // execSync(`schtasks /Run /TN "${taskName}"`);
        console.log(`✅ ${softwareName} installation scheduled silently (no visible terminal).`);

        // Cleanup after delay
        setTimeout(() => {
            console.log(`\n🧹 Running cleanup for ${softwareName}...`);

            try {
                const logText = fs.readFileSync(logPath, "utf8");
                console.log(`Log Preview:\n${logText.slice(-1000)}`);
            } catch {
                console.log("⚠️ No log available.");
            }

            try {
                execSync(`schtasks /Delete /TN "${taskName}" /F`);
                console.log(`🗑 Deleted task: ${taskName}`);
            } catch (err) {
                console.log(`⚠️ Could not delete task: ${err.message}`);
            }

            try {
                fs.unlinkSync(scriptPath);
                console.log(`🗑 Deleted script: ${scriptPath}`);
            } catch { }

            try {
                fs.unlinkSync(logPath);
                console.log(`🗑 Deleted log: ${logPath}`);
            } catch { }

        }, 3600000); // cleanup after 60 minutes

        const createHistory = await axios.post(`${BACKEND_BASE_URL}/api/softwares/addHistory`, {
            serial_number: await getSerialNumber(),
            software_name: softwareName,
            isSuccessful: true
        }).then(response => {
            console.log("History created: ", response.data);
        }).catch(error => {
            console.error("Error creating history: ", error.message);
            return;
        });
    } catch (error) {
        const createHistory = await axios.post(`${BACKEND_BASE_URL}/api/softwares/addHistory`, {
            serial_number: await getSerialNumber(),
            software_name: softwareName,
            isSuccessful: false
        }).then(response => {
            console.log("History created: ", response.data);
        }).catch(error => {
            console.error("Error creating history: ", error.message);
            return;
        });
        console.error(`❌ Scheduled task failed: ${error.message}`);
        return;
    }
}

// const softwareName = "obs-studio.portable";
// Schedule the job to run at 11:00 AM IST every day
// 11:00 AM IST = 05:30 AM UTC
schedule.schedule('0 5 * * *', async () => {
    console.log('Running scheduled task to install not installed softwares');
    try {
        const fetchNotInstalledSoftwares = await axios.get(`${BACKEND_BASE_URL}/api/softwares/notInstalled?serial_number=${await getSerialNumber()}`);
        console.log(fetchNotInstalledSoftwares.data);
        const softwareNameArray = fetchNotInstalledSoftwares.data.softwareName;
        console.log(softwareNameArray);
        for (const softwareName of softwareNameArray) {
            if (typeof softwareName !== 'string') {
                console.log("softwareName is not a string: ", softwareName);
                continue;
            }
            await installViaScheduledTask(softwareName);  //silently install via scheduled task
        }
    } catch (error) {
        console.error('Error fetching or installing software:', error.message);
    }
}, {
    scheduled: false,
    timezone: "Asia/Kolkata"
});

const demoFunction = async () => {
    try {
        setTimeout(async () => {
            const fetchNotInstalledSoftwares = await axios.get(`${BACKEND_BASE_URL}/api/softwares/notInstalled?serial_number=${await getSerialNumber()}`);
            console.log("fetchNotInstalledSoftwares: ", fetchNotInstalledSoftwares.data);
            const softwareNameArray = fetchNotInstalledSoftwares.data;
            console.log("softwareNameArray: ", softwareNameArray);
            for (const softwareName of softwareNameArray) {
                await installViaScheduledTask(softwareName);  //silently install via scheduled task
            }
        }, 2000);
    } catch (error) {
        console.error('Error fetching or installing software in demoFunction:', error.message);
    }
}
demoFunction();

// installSoftware(softwareName);
module.exports = { installSoftware, installViaScheduledTask };