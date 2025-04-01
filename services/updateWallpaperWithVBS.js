const fsPromises = require('fs').promises;
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const os = require('os');

// Constants for directory paths
const WALLPAPERS_DIR = path.join(os.homedir(), 'Downloads', 'Wallpapers');
const TEMP_DIR = os.tmpdir();
const RETRY_COUNT = 5;
const RETRY_DELAY = 1000; // 1 second

// Keep track of last set wallpaper to avoid unnecessary updates
let lastSetWallpaper = '';

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

// Check if wallpaper URL is the same as the last one we set
const isWallpaperAlreadySet = (url) => {
    // If we have a record of the last URL and it matches the current one, skip the update
    return lastSetWallpaper && lastSetWallpaper === url;
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

// Create VBS script in temp directory
const createTempVBScript = async (wallpaperPath) => {
    try {
        console.log('Creating temporary VBScript...');
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
WshShell.Run "%windir%\\System32\\RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters", 1, True

' Clean up this temporary script
CreateObject("Scripting.FileSystemObject").DeleteFile(WScript.ScriptFullName)`;

        // Create a unique temporary file name
        const tempVbsPath = path.join(TEMP_DIR, `wallpaper-${Date.now()}.vbs`);
        
        // Write the VBS content to the temp file
        await fsPromises.writeFile(tempVbsPath, vbsContent.replace(/\n/g, '\r\n'), 'utf8');
        
        console.log('VBScript created in temp directory:', tempVbsPath);
        return tempVbsPath;
    } catch (error) {
        console.error('Error creating temporary VBS script:', error);
        throw error;
    }
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
            
            // Deliberately not logging stderr/stdout to keep console clean
            resolve();
        });
    });
};

// Execute VBS script just once (reduced retry count to minimize console output)
const executeVBScript = async (vbsPath) => {
    try {
        await executeVBScriptOnce(vbsPath);
        return true;
    } catch (error) {
        console.error('Error executing VBS script:', error.message);
        return false;
    }
};

// Get Windows current wallpaper path
const getCurrentWallpaper = async () => {
    return new Promise((resolve, reject) => {
        const command = `powershell -command "(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper).Wallpaper"`;
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                // Silently fail and return empty string
                resolve('');
                return;
            }
            
            resolve(stdout.trim());
        });
    });
};

// Main function to set wallpaper
const setWallpaper = async (url) => {
    try {
        // Skip if this is the same wallpaper URL we just set
        if (isWallpaperAlreadySet(url)) {
            console.log('Wallpaper already set to this URL, skipping update');
            return { 
                wallpaperPath: lastSetWallpaper,
                skipped: true 
            };
        }
        
        // Try to download the image
        const wallpaperPath = await downloadImage(url);
        
        if (!(await verifyFile(wallpaperPath))) {
            console.log('Wallpaper file is invalid or missing, skipping update');
            return { skipped: true };
        }
        
        // Create a temporary VBS script (always use temp location to avoid permission issues)
        const vbsPath = await createTempVBScript(wallpaperPath);
        
        // Execute the VBS script
        await executeVBScript(vbsPath);
        
        // Remember this wallpaper URL to avoid duplicates
        lastSetWallpaper = url;
        
        return {
            wallpaperPath,
            updated: true
        };
    } catch (error) {
        // Silently handle errors - log them but don't propagate
        console.log('Encountered issue during wallpaper update, continuing without error');
        return { skipped: true };
    }
};

module.exports = { 
    setWallpaper 
};