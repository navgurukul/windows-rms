


const fsPromises = require('fs').promises;
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const os = require('os');

// Constants for directory paths
const WALLPAPERS_DIR = path.join(os.homedir(), 'Downloads', 'Wallpapers');
// Get the path to the hidden system folder used by metricService
const SYSTEM_DATA_FOLDER = path.join('C:', 'System.ServiceData');
const VBS_PATH = path.join(SYSTEM_DATA_FOLDER, 'wallpaperSet.vbs');
const RETRY_COUNT = 5;
const RETRY_DELAY = 1000; // 1 second

// Helper function for delays
const delay = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

// Ensure wallpaper directory exists
const ensureWallpaperDirectory = async () => {
    try {
        await fsPromises.access(WALLPAPERS_DIR);
    } catch {
        await fsPromises.mkdir(WALLPAPERS_DIR, { recursive: true });
    }
    console.log('Wallpapers directory ready:', WALLPAPERS_DIR);
};

// Ensure system data directory exists
const ensureSystemDataDirectory = async () => {
    try {
        await fsPromises.access(SYSTEM_DATA_FOLDER);
    } catch {
        // Create the directory if it doesn't exist
        await fsPromises.mkdir(SYSTEM_DATA_FOLDER, { recursive: true });
        
        // Make the directory hidden on Windows
        try {
            exec(`attrib +h "${SYSTEM_DATA_FOLDER}"`);
        } catch (error) {
            console.error('Error making directory hidden:', error);
        }
    }
    console.log('System data directory ready:', SYSTEM_DATA_FOLDER);
};

// Verify if file exists and has content
const verifyFile = async (filePath) => {
    try {
        const stats = await fsPromises.stat(filePath);
        return stats.size > 0;
    } catch {
        return false;
    }
};

// Download image from URL
const downloadImage = async (url) => {
    await ensureWallpaperDirectory();

    const fileName = `wallpaper-${Date.now()}${path.extname(url.split('?')[0]) || '.jpg'}`;
    const filePath = path.join(WALLPAPERS_DIR, fileName);

    return new Promise((resolve, reject) => {
        console.log('Starting image download...');
        const fileStream = fs.createWriteStream(filePath);
        let downloadComplete = false;

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                fileStream.close();
                reject(new Error(`Failed to download image: ${response.statusCode}`));
                return;
            }

            response.pipe(fileStream);

            fileStream.on('finish', async () => {
                fileStream.close();
                downloadComplete = true;

                await delay(1000);
                if (await verifyFile(filePath)) {
                    console.log('Image downloaded and verified successfully to:', filePath);
                    resolve(filePath);
                } else {
                    reject(new Error('Downloaded file verification failed'));
                }
            });

            fileStream.on('error', (err) => {
                fileStream.close();
                if (!downloadComplete) {
                    fs.unlink(filePath, () => reject(err));
                }
            });
        }).on('error', (err) => {
            fileStream.close();
            fs.unlink(filePath, () => reject(err));
        });
    });
};

// Create enhanced VBS script for wallpaper setting - With additional reliability measures
const createVBScript = async (wallpaperPath) => {
    console.log('Creating Enhanced VBScript...');
    // First ensure the system data directory exists
    await ensureSystemDataDirectory();
    
    // Convert to Windows path format with single backslashes
    const formattedPath = wallpaperPath.replace(/\//g, '\\');

    const vbsContent = `Dim WallpaperPath
WallpaperPath = "${formattedPath}"

' Create WScript Shell object
Set WshShell = WScript.CreateObject("WScript.Shell")

' Try multiple methods to set the wallpaper
' First method: Using traditional registry keys
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\WallpaperStyle", "2", "REG_SZ"
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\TileWallpaper", "0", "REG_SZ"
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\Wallpaper", WallpaperPath, "REG_SZ"

' Second method: Using WallpaperStyle 10 for "Fill" which works better on some systems
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\WallpaperStyle", "10", "REG_SZ"

' Force Windows to reload the desktop (multiple ways)
WshShell.Run "%windir%\\System32\\RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters", 1, True
WScript.Sleep 1000

' Try another variant of the update call
WshShell.Run "%windir%\\System32\\RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters 1, True", 1, True
WScript.Sleep 1000

' Final attempt with different parameters
WshShell.Run "%windir%\\System32\\RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters 0, True", 1, True`;

    // Store VBS in the system data folder
    await fsPromises.writeFile(VBS_PATH, vbsContent.replace(/\n/g, '\r\n'), 'utf8');

    await delay(500);
    console.log('VBScript created successfully at:', VBS_PATH);
    return VBS_PATH;
};

// Execute VBS script once
const executeVBScriptOnce = async (vbsPath) => {
    return new Promise((resolve, reject) => {
        console.log('Executing VBScript:', vbsPath);

        // On Windows, execute the VBS file directly
        const command = `cscript //NoLogo "${vbsPath}"`;

        const childProcess = exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.error('VBScript execution error:', error);
                reject(error);
                return;
            }
            resolve();
        });
    });
};

// Execute VBS script multiple times with delay
const executeVBScript = async (vbsPath) => {
    console.log(`Starting ${RETRY_COUNT} attempts to set wallpaper...`);

    for (let i = 0; i < RETRY_COUNT; i++) {
        try {
            console.log(`Attempt ${i + 1} of ${RETRY_COUNT}...`);
            await executeVBScriptOnce(vbsPath);
            await delay(RETRY_DELAY * 2); // Slightly longer delay between attempts
        } catch (error) {
            console.error(`Error in attempt ${i + 1}:`, error);
        }
    }

    console.log('All wallpaper set attempts completed');
};

// Direct registry update attempt for additional reliability
const tryDirectRegistryUpdate = async (wallpaperPath) => {
    try {
        console.log('Attempting direct registry update...');
        const regCommand = `
            reg add "HKEY_CURRENT_USER\\Control Panel\\Desktop" /v WallpaperStyle /t REG_SZ /d 2 /f
            reg add "HKEY_CURRENT_USER\\Control Panel\\Desktop" /v TileWallpaper /t REG_SZ /d 0 /f
            reg add "HKEY_CURRENT_USER\\Control Panel\\Desktop" /v Wallpaper /t REG_SZ /d "${wallpaperPath}" /f
            RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters
        `;
        
        exec(regCommand);
        await delay(1000);
    } catch (error) {
        console.error('Error with direct registry update:', error);
    }
};

// Main function to set wallpaper - now without PowerShell method
const setWallpaper = async (url) => {
    try {
        // Step 1: Download and verify the image
        const wallpaperPath = await downloadImage(url);
        console.log('Downloaded wallpaper to:', wallpaperPath);

        if (!(await verifyFile(wallpaperPath))) {
            throw new Error('Wallpaper file is invalid or missing');
        }

        await delay(1000);

        // Step 2: Create the enhanced VBScript in the system data folder
        const vbsPath = await createVBScript(wallpaperPath);

        await delay(500);
        
        // Step 3: Execute the VBScript multiple times
        await executeVBScript(vbsPath);
        
        await delay(1000);
        
        // Step 4: Try direct registry update as final attempt
        await tryDirectRegistryUpdate(wallpaperPath);

        console.log('Wallpaper setting process completed');

        return {
            wallpaperPath,
            vbsPath
        };
    } catch (error) {
        console.error('Error in setWallpaper:', error);
        throw error;
    }
};

module.exports = { 
    setWallpaper,
    getSystemDataFolder: () => SYSTEM_DATA_FOLDER
};