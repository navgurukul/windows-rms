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

async function installViaWingetTask(software_name, softwareId, length) {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `${softwareId}-winget-install.ps1`);
    const logPath = path.join(tempDir, `${softwareId}-winget-install.log`);
    const taskName = `WingetInstall_${softwareId}_${Date.now()}`;
    const startTime = getFutureTime(2);

    // Create PowerShell script (silent install with logging)
    const psContent = `
        Start-Transcript -Path "${logPath}" -Append
        try {
            winget install --id ${softwareId} --silent --accept-source-agreements --accept-package-agreements --force --disable-interactivity --scope machine
        } catch {
            Write-Host "Error installing ${softwareId}: $($_.Exception.Message)"
        }
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
                if (/Successfully installed/i.test(logText) || /installed successfully/i.test(logText)) {
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
                software_name: software_name,
                isSuccessful: false
            });
        } catch (err) {
            console.error("Error creating history for failed task:", err.message);
        }
    }
}

// ==========================
// installScriptFileViaTask()
// Installs a bash/batch/script file the same way winget packages are installed:
// downloads the file and runs it silently via a hidden, elevated scheduled task.
// ==========================
async function installScriptFileViaTask(software_name, scriptInfo, length) {
    const { url, ext } = scriptInfo;
    const tempDir = os.tmpdir();
    const safeName = String(software_name).replace(/[^a-zA-Z0-9._-]/g, "_");
    const downloadPath = path.join(tempDir, `${safeName}-script${ext}`);
    const scriptPath = path.join(tempDir, `${safeName}-script-install.ps1`);
    const logPath = path.join(tempDir, `${safeName}-script-install.log`);
    const taskName = `ScriptInstall_${safeName}_${Date.now()}`;
    const startTime = getFutureTime(2);

    // Pick how the downloaded file is executed based on its extension
    let runLine;
    switch (ext.toLowerCase()) {
        case ".ps1":
            runLine = `& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $localPath`;
            break;
        case ".sh":
            runLine = `& bash $localPath`;
            break;
        case ".cmd":
        case ".bat":
        default:
            runLine = `& cmd.exe /c $localPath`;
            break;
    }

    // Create PowerShell wrapper: download the script, run it silently, log the result
    const psContent = `
        Start-Transcript -Path "${logPath}" -Append
        try {
            $scriptUrl = "${url}"
            $localPath = "${downloadPath.replace(/\\/g, "\\\\")}"
            $ProgressPreference = 'SilentlyContinue'
            Write-Host "Downloading script from $scriptUrl"
            Invoke-WebRequest -Uri $scriptUrl -OutFile $localPath -UseBasicParsing
            Write-Host "Running script $localPath"
            ${runLine}
            if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) {
                Write-Host "SCRIPT_INSTALL_SUCCESS"
            } else {
                Write-Host "SCRIPT_INSTALL_FAILED exit $LASTEXITCODE"
            }
        } catch {
            Write-Host "Error running script for ${safeName}: $($_.Exception.Message)"
        } finally {
            try { Remove-Item -Path $localPath -Force -ErrorAction SilentlyContinue } catch {}
            Stop-Transcript
        }
    `;
    fs.writeFileSync(scriptPath, psContent);

    console.log(`PowerShell script: ${scriptPath}`);
    console.log(`Log file will be: ${logPath}`);
    console.log(`Task name: ${taskName} scheduled for: ${startTime}`);

    const escapedScriptPath = scriptPath.replace(/\\/g, "\\\\");
    try {
        // create scheduled task (run hidden, elevated)
        const taskCmd = `schtasks /Create /TN "${taskName}" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${escapedScriptPath}\\"" /SC ONCE /ST ${startTime} /RL HIGHEST /RU "%USERNAME%" /F`;
        execSync(taskCmd);
        console.log(`✅ ${safeName} script install scheduled silently.`);

        // cleanup + history logic
        setTimeout(async () => {
            console.log(`\n🧹 Running cleanup for ${safeName}...`);
            let isSuccessful = false;

            try {
                const logText = fs.readFileSync(logPath, "utf8");
                console.log(`Log Preview:\n${logText.slice(-1000)}`);

                if (/SCRIPT_INSTALL_SUCCESS/i.test(logText)) {
                    isSuccessful = true;
                    console.log(`✅ ${safeName} script ran successfully.`);
                } else {
                    console.log(`⚠️ Could not confirm script success for ${safeName}.`);
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
                console.log(`📘 History created for ${safeName}: ${isSuccessful}`);
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
            try { fs.unlinkSync(downloadPath); } catch { }
        }, 150000 * length); // cleanup after 2.5 minutes per item

    } catch (error) {
        console.error(`❌ Scheduled task failed: ${error.message}`);
        try {
            await axios.post(`${BACKEND_BASE_URL}/api/softwares/addHistory`, {
                serial_number: await getSerialNumber(),
                software_name: software_name,
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

// Detect whether a server software item is a script/bash file rather than a winget package.
// Returns { url, ext } when it is a script, otherwise null.
function getScriptInfo(software) {
    const url =
        software.file_url ||
        software.script_url ||
        software.url ||
        (typeof software.winget_id === "string" && /^https?:\/\//i.test(software.winget_id) ? software.winget_id : "") ||
        "";

    if (!url) return null;

    const match = url.match(/\.(bat|cmd|sh|ps1)(?:\?.*)?$/i);
    if (!match) return null;

    return { url, ext: `.${match[1].toLowerCase()}` };
}

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
                const { software_name, winget_id } = software;

                // If the item is a bash/script file, install it via a scheduled task
                // the same way winget packages are installed, instead of using winget.
                const scriptInfo = getScriptInfo(software);
                if (scriptInfo) {
                    console.log(`📝 Installing script: ${software_name} (${scriptInfo.url})`);
                    await installScriptFileViaTask(software_name, scriptInfo, notInstalled.length);
                    continue;
                }

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
                console.log(`🧩 Installing: ${software_name} (${winget_id})`);
                await installViaWingetTask(software_name, winget_id, notInstalled.length);
            }
        }, 5000);
    } catch (error) {
        console.error('Error fetching or installing software in demoFunction:', error.message);
    }
}
demoFunction();

module.exports = { installViaWingetTask, installScriptFileViaTask, getScriptInfo }