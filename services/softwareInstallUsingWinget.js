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
        }, 300000 * length); // cleanup after 5 mins

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
                console.log(`🧩 Installing: ${software_name} (${winget_id})`);
                await installViaWingetTask(software_name, winget_id, notInstalled.length);
            }
        }, 2000);
    } catch (error) {
        console.error('Error fetching or installing software in demoFunction:', error.message);
    }
}
demoFunction();

module.exports = { installViaWingetTask }