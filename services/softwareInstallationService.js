const { execSync, spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

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

// const softwareName ="obs-studio"
// installSoftware(softwareName);

module.exports = { installSoftware };