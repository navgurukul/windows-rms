const fsPromises = require('fs').promises;
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const os = require('os');

// Constants for directory paths
const WALLPAPERS_DIR = path.join(os.homedir(), 'Downloads', 'Wallpapers');
const VBS_DIR = path.join(__dirname);
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

// Create VBS script for wallpaper setting
const createVBScript = async (wallpaperPath) => {
    console.log('Creating VBScript...');
    // Convert to Windows path format with single backslashes
    const formattedPath = wallpaperPath.replace(/\//g, '\\');

    const vbsContent = `Dim WallpaperPath
WallpaperPath = "${formattedPath}"

' Create WScript Shell object
Set WshShell = WScript.CreateObject("WScript.Shell")

' Set the wallpaper style (2 = stretched)
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\WallpaperStyle", "2", "REG_SZ"
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\TileWallpaper", "0", "REG_SZ"

' Set the wallpaper path
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\Wallpaper", WallpaperPath, "REG_SZ"

' Force Windows to reload the desktop
WshShell.Run "%windir%\\System32\\RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters", 1, True`;

    // Store VBS in project directory
    const vbsPath = path.join(VBS_DIR, 'wallpaperSet.vbs');
    await fsPromises.writeFile(vbsPath, vbsContent.replace(/\n/g, '\r\n'), 'utf8');

    await delay(500);
    console.log('VBScript created successfully at:', vbsPath);
    console.log('VBS Content for inspection:');
    console.log(vbsContent);
    return vbsPath;
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
            if (stderr) {
                console.log('VBScript stderr:', stderr);
            }
            if (stdout) {
                console.log('VBScript stdout:', stdout);
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
            await delay(RETRY_DELAY);
        } catch (error) {
            console.error(`Error in attempt ${i + 1}:`, error);
        }
    }

    console.log('All wallpaper set attempts completed');
};

// Main function to set wallpaper
const setWallpaper = async (url) => {
    try {
        // Step 1: Download and verify the image
        const wallpaperPath = await downloadImage(url);
        console.log('Downloaded wallpaper to:', wallpaperPath);

        if (!(await verifyFile(wallpaperPath))) {
            throw new Error('Wallpaper file is invalid or missing');
        }

        await delay(1000);

        // Step 2: Create the VBScript
        const vbsPath = await createVBScript(wallpaperPath);

        await delay(500);

        // Step 3: Execute the VBScript automatically multiple times
        await executeVBScript(vbsPath);
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
    setWallpaper 
}
// Example usage
// setWallpaper('https://plus.unsplash.com/premium_photo-1730157453240-4e56cb9d4bb9?q=80&w=3173&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D')
//     .then(({ wallpaperPath, vbsPath }) => {
//         console.log('Process completed');
//         console.log('Wallpaper saved at:', wallpaperPath);
//         console.log('VBS file location:', vbsPath);
//     })
//     .catch(error => console.error('Error:', error));