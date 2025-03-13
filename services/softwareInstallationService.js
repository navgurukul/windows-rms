const { execSync, spawn } = require("child_process");
const os = require("os");
const path = require("path");

function isAdmin() {
    try {
        execSync("net session", { stdio: "ignore" });
        return true;
    } catch (error) {
        return false;
    }
}

function runAsAdmin(command) {
    // Using CMD
    return `powershell -Command "Start-Process cmd -ArgumentList '/c ${command} & pause' -Verb RunAs"`;
}

function getInstallPath(softwareName) {
    try {
        const registryPath = `HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*`;
        const installPathCmd = `powershell -Command "(Get-ItemProperty '${registryPath}' | Where-Object { $_.DisplayName -like '*${softwareName}*' }).InstallLocation"`;
        const installPath = execSync(installPathCmd, { encoding: "utf-8" }).trim();
        
        if (installPath) {
            return installPath;
        } else {
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

    const desktopPath = path.join(os.homedir(), "Desktop");
    const shortcutPath = path.join(desktopPath, `${softwareName}.lnk`);

    const powershellCmd = `
        $WScriptShell = New-Object -ComObject WScript.Shell;
        $Shortcut = $WScriptShell.CreateShortcut('${shortcutPath}');
        $Shortcut.TargetPath = '${installPath}';
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
        let command;

        if (platform === "win32") {
            command = `choco install ${softwareName} -y`;
        } else {
            throw new Error("Unsupported operating system");
        }
        console.log(`Executing: ${command}`);

        if (platform === "win32" && !isAdmin()) {
            console.log("Re-launching with administrator privileges...");
            execSync(runAsAdmin(command));
            return;
        }

        const child = spawn(command, { shell: true, stdio: "inherit" });
        child.on("close", (code) => {
            if (code === 0) {
                console.log(`${softwareName} installed successfully!`);
                
                // Get installation path and create shortcut
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

const softwareName = process.argv[2];
installSoftware(softwareName);