const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function setWallpaper(imagePath) {
    return new Promise((resolve, reject) => {
        // Verify if file exists
        if (!fs.existsSync(imagePath)) {
            reject(new Error(`File not found: ${imagePath}`));
            return;
        }

        // Get absolute path and ensure proper escaping
        const absolutePath = path.resolve(imagePath).replace(/\\/g, '\\\\');

        // Create VBScript content
        const vbsContent = `
Set WshShell = WScript.CreateObject("WScript.Shell")
Set Shell = WScript.CreateObject("Shell.Application")

' Update wallpaper style in registry
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\WallpaperStyle", "2", "REG_SZ"
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\TileWallpaper", "0", "REG_SZ"

' Set the wallpaper
Shell.RefreshDesktop
WshShell.RegWrite "HKCU\\Control Panel\\Desktop\\Wallpaper", "${absolutePath}", "REG_SZ"

' Force the change to take effect
Set sys = CreateObject("Shell.Application")
sys.MinimizeAll
WScript.Sleep 500
sys.UndoMinimizeAll
`;

        // Create temporary VBS file
        const vbsPath = path.join(process.env.TEMP, 'setWallpaper.vbs');
        fs.writeFileSync(vbsPath, vbsContent);

        console.log('Setting wallpaper...');
        console.log('Image path:', absolutePath);

        // Execute the VBScript
        exec(`cscript //nologo "${vbsPath}"`, (error, stdout, stderr) => {
            // Clean up the temporary file
            fs.unlinkSync(vbsPath);

            if (error) {
                console.error('Error:', error);
                console.error('stderr:', stderr);
                reject(error);
                return;
            }

            console.log('Wallpaper set successfully!');
            resolve(stdout);
        });
    });
}

// Example usage with hardcoded path
const imagePath = "C:\\Users\\mi\\Downloads\\Wallpapers\\wallpaper-1738298378114.jpg";

// Set the wallpaper
setWallpaper(imagePath)
    .then(() => console.log('Process completed'))
    .catch(error => console.error('Failed to set wallpaper:', error));