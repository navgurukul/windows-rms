require("../utils/logger");
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { execSync } = require("child_process");
const schedule = require('node-cron');
const { BACKEND_BASE_URL } = require('../config/config');
const { getSerialNumber } = require('./metricService');

// ==========================
// installViaWingetTask()
// ==========================

async function isSoftwareInstalled(wingetId, softwareName) {
    try {
        const output = execSync(`winget list --id "${wingetId}"`, { encoding: "utf-8" });
        if (output.includes(`${wingetId}`) || output.toLowerCase().includes(softwareName.toLowerCase())) {
            return true;
        }
        if (output.includes("No installed package found matching input criteria.")) {
            return false;
        }
        return true;
    } catch (err) {
        return false;
    }
}

async function installViaWingetTask(software_name, softwareId, length, source) {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `${softwareId}-winget-install.ps1`);
    const logPath = path.join(tempDir, `${softwareId}-winget-install.log`);
    const taskName = `WingetInstall_${softwareId}_${Date.now()}`;
    const startTime = getFutureTime(2);
    const effectiveSource = source ? source : "winget";  // default fallback

    // Create PowerShell script (silent install with logging)
    const psContent = `
        Start-Transcript -Path "${logPath}" -Append
        try {
            winget install --id ${softwareId} --source ${effectiveSource} --silent --accept-source-agreements --accept-package-agreements --force --disable-interactivity --scope machine
        } catch {
            Write-Host "Error installing ${softwareId}: $($_.Exception.Message)"
        }
        Write-Host "WingetExitCode=$LASTEXITCODE"
        Stop-Transcript
    `;
    fs.writeFileSync(scriptPath, psContent);

    console.log(`PowerShell script: ${scriptPath}`);
    console.log(`Log file will be: ${logPath}`);
    console.log(`Task name: ${taskName} scheduled for: ${startTime}`);

    const escapedScriptPath = scriptPath.replace(/\\/g, "\\\\");
    try {
        // create scheduled task (run hidden as SYSTEM)
        const taskCmd = `schtasks /Create /TN "${taskName}" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${escapedScriptPath}\\"" /SC ONCE /ST ${startTime} /RL HIGHEST /RU "%USERNAME%" /F`;
        execSync(taskCmd);
        console.log(`✅ ${softwareId} installation scheduled silently via Winget.`);

        // cleanup + history logic
        setTimeout(async () => {
            console.log(`\n🧹 Running cleanup for ${softwareId}...`);
            let isSuccessful = false;

            try {
                const logText = fs.readFileSync(logPath, "utf8");
                console.log(`Log Preview:\n${logText.slice(-1000)}`);

                // Winget success detection
                if (/WingetExitCode=0/.test(logText) || /Successfully installed/i.test(logText) || /installed successfully/i.test(logText)) {
                    isSuccessful = true;
                    console.log(`✅ ${softwareId} installed successfully.`);
                } else {
                    console.log(`⚠️ Could not confirm installation success for ${softwareId}.`);
                }
            } catch {
                console.log("⚠️ No log available.");
            }

            // create backend history entry
            try {
                await axios.post(`${BACKEND_BASE_URL}/api/softwares/addHistory`, {
                    serial_number: await getSerialNumber(),
                    software_name: software_name,
                    isSuccessful
                });
                console.log(`📘 History created for ${softwareId}: ${isSuccessful}`);
            } catch (err) {
                console.error("Error creating history:", err.message);
            }

            // cleanup temp + task
            try {
                execSync(`schtasks /Delete /TN "${taskName}" /F`);
                console.log(`🗑 Deleted task: ${taskName}`);
            } catch (err) {
                console.log(`⚠️ Could not delete task: ${err.message}`);
            }

            try { fs.unlinkSync(scriptPath); } catch { }
            try { fs.unlinkSync(logPath); } catch { }
        }, 150000 * length); // cleanup after 2.5 minutes per software

    } catch (error) {
        console.error(`❌ Scheduled task failed: ${error.message}`);
        try {
            await axios.post(`${BACKEND_BASE_URL}/api/softwares/addHistory`, {
                serial_number: await getSerialNumber(),
                software_name,
                isSuccessful: false
            });
        } catch (err) {
            console.error("Error creating history for failed task:", err.message);
        }
    }
}

// ==========================
// supporting helpers
// ==========================
function getFutureTime(minutesAhead = 3) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutesAhead);
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}

// Example scheduler (if needed)
schedule.schedule("0 5 * * *", async () => {
    console.log("Running Winget install scheduler...");
    try {
        const resp = await axios.get(`${BACKEND_BASE_URL}/api/softwares/notInstalled?serial_number=${await getSerialNumber()}`);
        const ids = resp.data.softwareName || [];
        for (const id of ids) {
            if (typeof id === "string") await installViaWingetTask(id);
        }
    } catch (err) {
        console.error("Error fetching or installing:", err.message);
    }
}, {
    scheduled: false,
    timezone: "Asia/Kolkata"
});

async function attemptWingetHardFix() {
    console.log("🔧 Attempting Winget hard fix...");

    try {
        execSync(`powershell.exe -Command "winget source reset --force"`, { stdio: "ignore" });
        console.log("✅ Winget source reset completed.");
    } catch {
        console.log("⚠️ Winget reset failed or not needed. Continuing normally...");
    }

    try {
        execSync(`powershell.exe -Command "winget source add msstore"`, { stdio: "ignore" });
        console.log("✅ Ensured msstore source exists.");
    } catch {
        console.log("⚠️ Could not add msstore source. Continuing...");
    }

    console.log("🚀 Startup continues normally.");
}

async function installFromRmsRepository(software_name, filename, length, isPortable = false) {
    const tempDir = os.tmpdir();
    const installerPath = path.join(tempDir, filename);
    const scriptPath = path.join(tempDir, `${software_name}-rms-install.ps1`);
    const logPath = path.join(tempDir, `${software_name}-rms-install.log`);
    const taskName = `RMSInstall_${software_name.replace(/\s+/g, '_')}_${Date.now()}`;
    const startTime = getFutureTime(2);

    try {
        console.log(`Downloading ${software_name} from RMS repository...`);
        const response = await axios({
            method: 'get',
            url: `${BACKEND_BASE_URL}/softwares/${encodeURIComponent(filename)}`,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(installerPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log(`✅ Downloaded ${filename} to ${installerPath}`);

        // PowerShell script logic depending on whether it's runnable or installable
        let psContent = '';
        if (isPortable) {
            // Portable: Move to a permanent location and create a shortcut
            const destFolder = `C:\\Program Files\\${software_name.replace(/\\s+/g, '')}`;
            psContent = `
                Start-Transcript -Path "${logPath}" -Append
                try {
                    # Create directory if it doesn't exist
                    if (!(Test-Path -Path "${destFolder}")) {
                        New-Item -ItemType Directory -Force -Path "${destFolder}"
                    }
                    
                    # Move the executable there
                    $destPath = "${destFolder}\\${filename}"
                    Move-Item -Path "${installerPath}" -Destination $destPath -Force
                    
                    # Create Desktop Shortcut
                    $WshShell = New-Object -comObject WScript.Shell
                    $Shortcut = $WshShell.CreateShortcut("$env:Public\\Desktop\\${software_name}.lnk")
                    $Shortcut.TargetPath = $destPath
                    $Shortcut.Save()
                    
                    Write-Host "Portable setup completed for ${software_name}"
                    Write-Host "InstallExitCode=0"
                } catch {
                    Write-Host "Error setting up ${software_name}: $($_.Exception.Message)"
                    Write-Host "InstallExitCode=1"
                }
                Stop-Transcript
            `;
        } else {
            // Installer: Run silent install
            psContent = `
                Start-Transcript -Path "${logPath}" -Append
                try {
                    Start-Process -FilePath "${installerPath}" -ArgumentList "/S" -Wait
                    Write-Host "Installation completed for ${software_name}"
                } catch {
                    Write-Host "Error installing ${software_name}: $($_.Exception.Message)"
                }
                Write-Host "InstallExitCode=$LASTEXITCODE"
                Stop-Transcript
            `;
        }

        fs.writeFileSync(scriptPath, psContent);

        const escapedScriptPath = scriptPath.replace(/\\/g, "\\\\");
        const taskCmd = `schtasks /Create /TN "${taskName}" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${escapedScriptPath}\\"" /SC ONCE /ST ${startTime} /RL HIGHEST /RU "%USERNAME%" /F`;
        execSync(taskCmd);
        console.log(`✅ ${software_name} installation scheduled silently from RMS repository.`);

        // Cleanup + history logic
        setTimeout(async () => {
            console.log(`\n🧹 Running cleanup for ${software_name} (RMS)...`);
            let isSuccessful = false;

            try {
                const logText = fs.readFileSync(logPath, "utf8");
                if (/InstallExitCode=0/.test(logText) || /Installation completed/i.test(logText)) {
                    isSuccessful = true;
                    console.log(`✅ ${software_name} installed successfully.`);
                }
            } catch {
                console.log("⚠️ No log available.");
            }

            // Create backend history entry
            try {
                await axios.post(`${BACKEND_BASE_URL}/api/softwares/addHistory`, {
                    serial_number: await getSerialNumber(),
                    software_name: software_name,
                    isSuccessful
                });
            } catch (err) {
                console.error("Error creating history:", err.message);
            }

            // Cleanup temp + task
            try { execSync(`schtasks /Delete /TN "${taskName}" /F`); } catch (err) { }
            try { fs.unlinkSync(installerPath); } catch { }
            try { fs.unlinkSync(scriptPath); } catch { }
            try { fs.unlinkSync(logPath); } catch { }
        }, 150000 * length);

    } catch (error) {
        console.error(`❌ RMS Repository installation failed: ${error.message}`);
        try {
            await axios.post(`${BACKEND_BASE_URL}/api/softwares/addHistory`, {
                serial_number: await getSerialNumber(),
                software_name: software_name,
                isSuccessful: false
            });
        } catch (err) { }
    }
}

const demoFunction = async () => {
    try {
        setTimeout(async () => {
            const serialNumber = await getSerialNumber();
            const response = await axios.get(
                `${BACKEND_BASE_URL}/api/softwares/notInstalled?serial_number=${serialNumber}`
            );

            const notInstalled = response.data;
            console.log("fetchNotInstalledSoftwares:", notInstalled);

            if (!Array.isArray(notInstalled) || notInstalled.length === 0) {
                console.log("✅ All softwares are already installed or no active softwares found.");
                return;
            }

            for (const software of notInstalled) {
                const { software_name, winget_id, source, isPortable } = software;

                // For RMS repository, we don't check via winget list
                if (source !== 'rms-repository') {
                    if (await isSoftwareInstalled(winget_id, software_name)) {
                        console.log(`✅ ${software_name} is already installed.`);
                        await axios.post(`${BACKEND_BASE_URL}/api/softwares/addHistory`, {
                            serial_number: await getSerialNumber(),
                            software_name: software_name,
                            isSuccessful: true
                        });
                    console.log(`📘 History created for ${software_name}: true`);
                        continue;
                    }
                }

                console.log(`🧩 Installing: ${software_name} (${winget_id}) via ${source || 'winget'}`);

                if (source === 'rms-repository') {
                    await installFromRmsRepository(software_name, winget_id, notInstalled.length, isPortable);
                } else {
                    await installViaWingetTask(software_name, winget_id, notInstalled.length, source);
                }
            }
        }, 5000);
    } catch (error) {
        console.error('Error fetching or installing software in demoFunction:', error.message);
    }
}
demoFunction();

module.exports = { installViaWingetTask, attemptWingetHardFix, installFromRmsRepository }