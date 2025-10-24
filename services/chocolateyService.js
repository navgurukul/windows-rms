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

function isChocolateyInstalled() {
    try {
        execSync("choco --version", { encoding: "utf-8" });
        return true;
    } catch (error) {
        return false;
    }
}

async function installChocolatey() {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `chocolatey-install.ps1`);
    const logPath = path.join(tempDir, `chocolatey-install.log`);
    const taskName = `ChocolateyInstall_${Date.now()}`;
    const startTime = getFutureTime(1);

    // Check if Chocolatey is already installed
    if (isChocolateyInstalled()) {
        console.log("✅ Chocolatey is already installed.");
        return { success: true, message: "Chocolatey is already installed.", logPath: null };
    }

    console.log("🔧 Installing Chocolatey as Administrator in background...");

    // Create PowerShell script for Chocolatey installation with comprehensive logging

    // const OLD_SCRIPT = "
    // try {
    //         Write-Host "[$(Get-Date)] Starting Chocolatey installation process..." -ForegroundColor Green
            
    //         # Set execution policy
    //         Write-Host "[$(Get-Date)] Setting execution policy..." -ForegroundColor Yellow
    //         Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine -Force
            
    //         # Install Chocolatey using official installation script
    //         Write-Host "[$(Get-Date)] Downloading and executing Chocolatey installation script..." -ForegroundColor Yellow
    //         $installScript = @"
    //             \$ErrorActionPreference = "Stop"
    //             \$ProgressPreference = 'SilentlyContinue'
    //             Set-PSDebug -Trace 2
                
    //             Write-Host "Setting up Chocolatey..." 3>$null
    //             Invoke-Expression (Invoke-WebRequest https://chocolatey.org/install.ps1 -UseBasicParsing).Content
    //             Write-Host "Chocolatey setup completed." 3>$null
    //             "@
            
    //         Invoke-Expression $installScript
            
    //         # Refresh environment variables
    //         Write-Host "[$(Get-Date)] Refreshing environment variables..." -ForegroundColor Yellow
    //         \$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            
    //         # Verify installation
    //         Write-Host "[$(Get-Date)] Verifying Chocolatey installation..." -ForegroundColor Yellow
    //         choco --version
            
    //         Write-Host "[$(Get-Date)] Chocolatey installation completed successfully!" -ForegroundColor Green
            
    //     } catch {
    //         Write-Host "[$(Get-Date)] ERROR: Chocolatey installation failed: \$(\$_.Exception.Message)" -ForegroundColor Red
    //         Write-Host "[$(Get-Date)] Full error details: \$(\$_.Exception)" -ForegroundColor Red
            
    //         # Try alternative installation method
    //         try {
    //             Write-Host "[$(Get-Date)] Attempting alternative installation method..." -ForegroundColor Yellow
                
    //             # Get PowerShell version and download appropriate installer
    //             if (\$PSVersionTable.PSVersion.Major -ge 5) {
    //                 Invoke-RestMethod -Uri "https://community.chocolatey.org/api/v2/packages/chocolatey" -UseBasicParsing | Invoke-RestMethod -ContentType "application/json" | Invoke-Expression
    //             } else {
    //                 Write-Host "[$(Get-Date)] PowerShell version too old for Chocolatey installation" -ForegroundColor Red
    //             }
                
    //             Write-Host "[$(Get-Date)] Alternative installation method completed." -ForegroundColor Green
                
    //         } catch {
    //             Write-Host "[$(Get-Date)] Alternative installation method also failed: \$(\$_.Exception.Message)" -ForegroundColor Red
    //         }
    //     } finally {
    //         Write-Host "[$(Get-Date)] Chocolatey installation attempt finished." -ForegroundColor Cyan
    //     }
    //     "
    
    const psContent = `
        # PowerShell script to install Chocolatey as Administrator
        Start-Transcript -Path "${logPath}" -Append
        
        try {
            Write-Host "[$(Get-Date)] Starting Chocolatey installation process..." -ForegroundColor Green
            
            # 1. Set execution policy
            Write-Host "[$(Get-Date)] Setting execution policy..." -ForegroundColor Yellow
            # Scope: Process only affects the current session, safer and common for this task
            Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force
            
            # Set standard script preferences
            $ErrorActionPreference = "Stop"
            $ProgressPreference = 'SilentlyContinue'
            
            # 2. Install Chocolatey using official installation script
            Write-Host "[$(Get-Date)] Downloading and executing official Chocolatey installation script..." -ForegroundColor Yellow
            
            # Standard installation command - simplified and direct
            Invoke-Expression (
                Invoke-WebRequest https://chocolatey.org/install.ps1 -UseBasicParsing
            ).Content
            
            # 3. Verify installation
            Write-Host "[$(Get-Date)] Verifying Chocolatey installation..." -ForegroundColor Yellow
            # The Chocolatey install script sets the path, but 'refreshenv' ensures it's available.
            # Note: If choco is not immediately found, refreshenv won't work. We test choco --version first.
            
            # Check if choco is immediately available
            $chocoVersion = choco --version
            
            if (-not $chocoVersion) {
                # Optional: Attempt to refresh path for the current session (though usually not necessary)
                Write-Host "[$(Get-Date)] Chocolatey path not immediately available. Attempting refresh..." -ForegroundColor DarkYellow
                # Use the refreshenv command that is installed by Chocolatey
                refreshenv
                # Re-check the version
                $chocoVersion = choco --version
            }
            
            Write-Host "[$(Get-Date)] Chocolatey Version: $chocoVersion" -ForegroundColor Green
            Write-Host "[$(Get-Date)] Chocolatey installation completed successfully!" -ForegroundColor Green
            
        } catch {
            # The official error message for the failed attempt
            Write-Host "[$(Get-Date)] ERROR: Chocolatey installation failed: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "[$(Get-Date)] Full error details: $($_.Exception)" -ForegroundColor Red
            
            # No need for a flawed 'alternative' install. The most common fix is user intervention 
            # (e.g., checking firewall, proxy, or permissions).
            Write-Host "[$(Get-Date)] Please check network connection, firewall rules, and execution permissions." -ForegroundColor Red
            
        } finally {
            Write-Host "[$(Get-Date)] Chocolatey installation attempt finished." -ForegroundColor Cyan
        }

        Stop-Transcript
    `;

    fs.writeFileSync(scriptPath, psContent);

    console.log(`📝 PowerShell script created: ${scriptPath}`);
    console.log(`📄 Log file will be created at: ${logPath}`);
    console.log(`🕐 Installation scheduled for: ${startTime}`);
    console.log(`📋 Task name: ${taskName}`);

    // Escape path for use inside schtasks string
    const escapedScriptPath = scriptPath.replace(/\\/g, '\\\\');

    try {
        const taskCmd = `schtasks /Create /TN "${taskName}" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${escapedScriptPath}\\"" /SC ONCE /ST ${startTime} /RL HIGHEST /F`;
        console.log("📅 Creating scheduled task...");
        execSync(taskCmd);
        
        console.log("▶️ Executing Chocolatey installation task...");
        execSync(`schtasks /Run /TN "${taskName}"`);
        
        console.log("✅ Chocolatey installation task launched successfully in background.");
        console.log("📊 Monitor the installation progress in the log file.");
        console.log(`📁 Log location: ${logPath}`);

        // Cleanup after delay
        setTimeout(() => {
            console.log("\n🧹 Running cleanup for Chocolatey installation...");

            try {
                // Check if log file exists and show preview
                if (fs.existsSync(logPath)) {
                    const logContent = fs.readFileSync(logPath, "utf8");
                    console.log(`📋 Log Preview:\n${logContent.slice(-1500)}`);
                    
                    // Check installation status
                    if (isChocolateyInstalled()) {
                        console.log("✅ Chocolatey installation verified successfully!");
                    } else {
                        console.log("⚠️ Chocolatey installation may have failed - check log file for details.");
                    }
                } else {
                    console.log("⚠️ Log file not found - installation may still be in progress.");
                }
            } catch (logError) {
                console.log(`⚠️ Error reading log: ${logError.message}`);
            }

            // Cleanup scheduled task
            try {
                execSync(`schtasks /Delete /TN "${taskName}" /F`);
                console.log(`🗑️ Deleted scheduled task: ${taskName}`);
            } catch (taskError) {
                console.log(`⚠️ Could not delete scheduled task: ${taskError.message}`);
            }

            // Cleanup script file
            try {
                fs.unlinkSync(scriptPath);
                console.log(`🗑️ Deleted script: ${scriptPath}`);
            } catch (scriptError) {
                // Script file might still be in use
            }

        }, 200000); // Cleanup after ~3.5 minutes

        return { 
            success: true, 
            message: "Chocolatey installation task launched successfully", 
            logPath: logPath,
            taskName: taskName
        };

    } catch (error) {
        console.error(`❌ Failed to launch Chocolatey installation task: ${error.message}`);
        
        // Cleanup on error
        try {
            if (fs.existsSync(scriptPath)) {
                fs.unlinkSync(scriptPath);
            }
        } catch {}

        return { 
            success: false, 
            message: `Failed to launch Chocolatey installation: ${error.message}`, 
            logPath: logPath,
            taskName: taskName
        };
    }
}

// Helper function to ensure Chocolatey is available before software installation
async function ensureChocolateyInstalled() {
    if (!isChocolateyInstalled()) {
        console.log("🔧 Chocolatey not found, installing...");
        const result = await installChocolatey();
        if (!result.success) {
            throw new Error("Failed to install Chocolatey: " + result.message);
        }
        return result;
    }
    return { success: true, message: "Chocolatey is already installed.", logPath: null };
}

module.exports = { 
    installChocolatey, 
    isChocolateyInstalled, 
    ensureChocolateyInstalled 
};
