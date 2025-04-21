const { tmpdir, homedir, platform: _platform } = require("os");
const { execFile, execSync, spawn } = require("child_process");
const { join, dirname } = require("path");
const { writeFileSync, readdirSync } = require("fs");
const { shell } = require("electron");
const path = require("path");
const https = require("https");
const fs = require("fs");
const os = require("os");

function isAdmin() {
  try {
    execSync("net session", { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
}

function runAsAdmin(command) {
  const tempDir = tmpdir();
  const batchFile = join(tempDir, "install_command.bat");

  writeFileSync(batchFile, `@echo off\n${command}\npause`);

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
      const installPath32 = execSync(installPathCmd32, {
        encoding: "utf-8",
      }).trim();

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
    const files = readdirSync(installPath);
    const exeFiles = files.filter((file) => file.endsWith(".exe"));
    if (exeFiles.length > 0) {
      const matchingSoftwareExe = exeFiles.find((file) =>
        file.toLowerCase().includes(softwareName.toLowerCase())
      );
      const exeFile = matchingSoftwareExe || exeFiles[0];
      targetPath = join(installPath, exeFile);
    }
  } catch (error) {
    console.log(`Warning: Could not read directory contents: ${error.message}`);
  }

  const desktopPath = join(homedir(), "Desktop");
  const shortcutPath = join(desktopPath, `${softwareName}.lnk`);

  const powershellCmd = `
        $WScriptShell = New-Object -ComObject WScript.Shell;
        $Shortcut = $WScriptShell.CreateShortcut('${shortcutPath}');
        $Shortcut.TargetPath = '${targetPath}';
        $Shortcut.WorkingDirectory = '${dirname(targetPath)}';
        $Shortcut.Save();
    `;

  try {
    execSync(`powershell -Command "${`powershellCmd`}"`);
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

    const platform = _platform();

    if (platform !== "win32") {
      throw new Error(
        "Unsupported operating system. This script only works on Windows."
      );
    }

    const command = `choco install ${softwareName} -y`;
    console.log(`Preparing to install: ${softwareName}`);

    if (!isAdmin()) {
      console.log("Requesting administrator privileges...");
      try {
        const adminCommand = runAsAdmin(command);
        execSync(adminCommand);
        console.log("Installation process launched with admin privileges.");
        console.log(
          "Please check the opened admin window to monitor installation progress."
        );

        console.log(
          "Once installation is complete, run this script again with admin privileges to create shortcuts."
        );
        return;
      } catch (error) {
        console.error(
          `Failed to launch with admin privileges: ${error.message}`
        );
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

const softwareName = "obs-studio";
// installSoftware(softwareName);

function setup_0() {
  const batchFilePath =
    "c:\\Users\\SAMA\\Documents\\windows-rms\\services\\setup.ps1";

  execFile(batchFilePath, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing batch file: ${error}`);
      return;
    }
    console.log(`Batch file output: ${stdout}`);
  });
}

function setup_1() {
  console.log("starting the win-get installation");
  let output = shell.openExternal(
    "c:/Users/SAMA/Documents/windows-rms/services/install-winget.bat"
  );
  console.log("win-get installation completed output:", output);
}

function setup_2() {
  const batFilePath = path.join(__dirname, "install-winget.bat");

  const child = spawn("cmd.exe", ["/c", batFilePath], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });

  child.unref();
}

function setup_install_with_ps1_winget() {
  const psScriptPath = path.join(__dirname, ".\\services\\install-winget.ps1");

  spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      psScriptPath,
    ],
    {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    }
  ).unref();
}

function setup_install_with_ps1_choco() {
  const psScriptPath = path.join(__dirname, ".\\services\\install-choco.ps1");

  spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      psScriptPath,
    ],
    {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    }
  ).unref();
}

async function wingetInstallPackage(appCode) {
  return new Promise((resolve, reject) => {
    const psCommand = `winget install ${appCode} --silent --accept-source-agreements --accept-package-agreements`;

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psCommand],
      {
        windowsHide: true,
        detached: true,
        stdio: "ignore",
      }
    );

    child.on("error", reject);
    child.unref(); // allow the main process to exit independently of the child

    // Since stdio is ignored and child is detached, assume success
    resolve();
  });
}

function setup_install_with_ps1_scoop() {
  const psScriptPath = path.join(__dirname, ".\\services\\install-scoop.ps1");

  spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      psScriptPath,
    ],
    {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    }
  ).unref();
}

function setup_install_with_execSync_winget() {
  try {
    execSync(
      "powershell -ExecutionPolicy Bypass -File .\\services\\install-scoop.ps1",
      {
        stdio: "inherit",
        encoding: "utf-8",
        detached: true,
        windowsHide: true,
      }
    );
    console.log("Installation script executed successfully.");
  } catch (error) {
    console.error(`Error executing installation script: ${error.message}`);
  }
}

function setup_install_with_msix_winget() {
  const downloadUrl = "https://github.com/microsoft/winget-cli/releases/download/v1.11.210-preview/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle";
  const installerPath = path.join(
    os.tmpdir(),
    // ".//services//installer//Microsoft.DesktopAppInstaller.msixbundle"
    "Microsoft.DesktopAppInstallerX.msixbundle"
  );

  async function downloadInstaller(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https
        .get(url, (response) => {
          if (response.statusCode >= 400) {
            return reject(
              new Error(`Failed to get '${url}' (${response.statusCode})`)
            );
          }

          response.pipe(file);
          file.on("finish", () => file.close(() => resolve(dest)));
        })
        .on("error", (err) => {
          fs.unlink(dest, () => reject(err));
        });
    });
  }

  async function installWinget(installer) {
    return new Promise((resolve, reject) => {
      const psCommand = `Add-AppxPackage -Path "${installer}"`;

      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psCommand],
        {
          windowsHide: true,
          detached: true,
          stdio: "ignore",
        }
      );

      child.on("error", reject);
      child.unref(); // allow the main process to exit independently of the child

      // Since stdio is ignored and child is detached, assume success
      resolve();
    });
  }

  (async () => {
    try {
      console.log("Downloading Winget installer...");
      await downloadInstaller(downloadUrl, installerPath);

      console.log("Installing Winget silently...");
      await installWinget(installerPath);

      console.log("Winget installation started (silent).");
    } catch (err) {
      console.error("Failed to install Winget:", err.message);
    }
  })();
}

function main() {
  // Check for any redundant setups or code blocks
  //   setup_0();
  //   setup_1();
  //   setup_2();
  //   setup_install_with_ps1_winget();
  //   setup_install_with_ps1_choco();
  //   setup_install_with_ps1_scoop();
  //   setup_install_with_execSync_winget();
  setup_install_with_msix_winget();

  // test installing Brave
  wingetInstallPackage("BraveSoftware.BraveBrowser")
    .then(() => {
      console.log("Brave installed successfully.");
    })
    .catch((error) => {
      console.error("Error installing Brave:", error);
    });
}

// main();

module.exports = { main, installSoftware };
