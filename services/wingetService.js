const { execSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

function getFutureTime(minutesAhead = 1) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutesAhead);
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function isWingetInstalled() {
    try {
        execSync("winget --version", { encoding: "utf-8" });
        return true;
    } catch (error) {
        return false;
    }
}

async function installWinget() {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `winget-install.ps1`);
    const logPath = path.join(tempDir, `winget-install.log`);
    const taskName = `WingetInstall_${Date.now()}`;
    const startTime = getFutureTime(1);

    // Check if already installed
    if (isWingetInstalled()) {
        console.log("✅ Winget is already installed.");
        return { success: true, message: "Winget is already installed.", logPath: null };
    }

    console.log("🔧 Installing Winget (Windows Package Manager) as Administrator in background...");

    const psContent = `
        # PowerShell script to install Winget silently with logging
        Start-Transcript -Path "${logPath}" -Append

        try {
            Write-Host "[$(Get-Date)] Starting Winget installation process..." -ForegroundColor Green

            $ErrorActionPreference = "Stop"
            $ProgressPreference = 'SilentlyContinue'

            # Check current winget installation
            try {
                $wingetVersion = (winget --version)
                if ($wingetVersion) {
                    Write-Host "[$(Get-Date)] Winget already installed: $wingetVersion" -ForegroundColor Green
                    Stop-Transcript
                    exit 0
                }
            } catch { }

            Write-Host "[$(Get-Date)] Winget not found. Proceeding with installation..." -ForegroundColor Yellow

            # Winget is distributed via App Installer (Microsoft.DesktopAppInstaller)
            # Attempt installation/update using PowerShell
            Write-Host "[$(Get-Date)] Installing App Installer from Microsoft Store..." -ForegroundColor Yellow

            # This command forces an update of the App Installer package, which contains winget
            Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -AllUsers | Out-Null
            if ($LASTEXITCODE -ne 0 -or !(Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -AllUsers)) {
                Write-Host "[$(Get-Date)] Attempting to install Microsoft.DesktopAppInstaller via Add-AppxPackage..." -ForegroundColor Yellow
                $appInstallerUrl = "https://aka.ms/getwinget"
                $appxPath = "$env:TEMP\\AppInstaller.appxbundle"
                Invoke-WebRequest -Uri $appInstallerUrl -OutFile $appxPath -UseBasicParsing
                Add-AppxPackage -Path $appxPath -ForceApplicationShutdown -ForceUpdateFromAnyVersion
            } else {
                Write-Host "[$(Get-Date)] App Installer already present. Updating if needed..." -ForegroundColor Yellow
                Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -AllUsers | Foreach {
                    Add-AppxPackage -DisableDevelopmentMode -ForceApplicationShutdown -Register "$($_.InstallLocation)\\AppxManifest.xml"
                }
            }

            # Verify Winget installation
            Write-Host "[$(Get-Date)] Verifying Winget installation..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
            $wingetVersion = winget --version

            if ($wingetVersion) {
                Write-Host "[$(Get-Date)] Winget installation successful: $wingetVersion" -ForegroundColor Green
            } else {
                Write-Host "[$(Get-Date)] ERROR: Winget not found after installation." -ForegroundColor Red
            }

        } catch {
            Write-Host "[$(Get-Date)] ERROR: Winget installation failed: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "[$(Get-Date)] Full error details: $($_.Exception)" -ForegroundColor Red
        } finally {
            Write-Host "[$(Get-Date)] Winget installation attempt finished." -ForegroundColor Cyan
            Stop-Transcript
        }
    `;

    fs.writeFileSync(scriptPath, psContent);

    console.log(`📝 PowerShell script created: ${scriptPath}`);
    console.log(`📄 Log file will be created at: ${logPath}`);
    console.log(`🕐 Installation scheduled for: ${startTime}`);
    console.log(`📋 Task name: ${taskName}`);

    const escapedScriptPath = scriptPath.replace(/\\/g, '\\\\');

    try {
        const taskCmd = `schtasks /Create /TN "${taskName}" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${escapedScriptPath}\\"" /SC ONCE /ST ${startTime} /RL HIGHEST /F`;
        console.log("📅 Creating scheduled task...");
        execSync(taskCmd);
        
        console.log("▶️ Executing Winget installation task...");
        execSync(`schtasks /Run /TN "${taskName}"`);
        
        console.log("✅ Winget installation task launched successfully in background.");
        console.log(`📁 Log location: ${logPath}`);

        setTimeout(() => {
            console.log("\n🧹 Running cleanup for Winget installation...");

            try {
                if (fs.existsSync(logPath)) {
                    const logContent = fs.readFileSync(logPath, "utf8");
                    console.log(`📋 Log Preview:\n${logContent.slice(-1500)}`);
                    
                    if (isWingetInstalled()) {
                        console.log("✅ Winget installation verified successfully!");
                    } else {
                        console.log("⚠️ Winget installation may have failed - check log file for details.");
                    }
                } else {
                    console.log("⚠️ Log file not found - installation may still be in progress.");
                }
            } catch (logError) {
                console.log(`⚠️ Error reading log: ${logError.message}`);
            }

            // Cleanup
            try {
                execSync(`schtasks /Delete /TN "${taskName}" /F`);
                console.log(`🗑️ Deleted scheduled task: ${taskName}`);
            } catch (taskError) {
                console.log(`⚠️ Could not delete scheduled task: ${taskError.message}`);
            }

            try {
                fs.unlinkSync(scriptPath);
                console.log(`🗑️ Deleted script: ${scriptPath}`);
            } catch {}
        }, 200000); // ~3.5 minutes

        return { 
            success: true, 
            message: "Winget installation task launched successfully", 
            logPath: logPath,
            taskName: taskName
        };

    } catch (error) {
        console.error(`❌ Failed to launch Winget installation task: ${error.message}`);
        try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch {}
        return { 
            success: false, 
            message: `Failed to launch Winget installation: ${error.message}`, 
            logPath: logPath,
            taskName: taskName
        };
    }
}

async function ensureWingetIsInstalled() {
    if (!isWingetInstalled()) {
        console.log("🔧 Winget not found, installing...");
        const result = await installWinget();
        if (!result.success) {
            throw new Error("Failed to install Winget: " + result.message);
        }
        return result;
    }
    return { success: true, message: "Winget is already installed.", logPath: null };
}

module.exports = { 
    installWinget, 
    isWingetInstalled, 
    ensureWingetIsInstalled 
};
