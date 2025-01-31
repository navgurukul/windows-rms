const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

// Function to get Downloads folder path
function getDownloadsFolder() {
    return path.join(os.homedir(), 'Downloads');
}

// Function to download image from URL
async function downloadImage(url, filepath) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Function to set wallpaper using PowerShell
function setWallpaperWindows(imagePath) {
    return new Promise((resolve, reject) => {
        const script = `
$code = @'
using System.Runtime.InteropServices;
public class Wallpaper {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
'@
Add-Type -TypeDefinition $code

$SPI_SETDESKWALLPAPER = 0x0014
$SPIF_UPDATEINIFILE = 0x01
$SPIF_SENDCHANGE = 0x02

# Set wallpaper path
$imagePath = '${imagePath.replace(/\\/g, '\\\\')}'

# Set the wallpaper style to stretched
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value 2
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value 0

# Set the wallpaper
[Wallpaper]::SystemParametersInfo($SPI_SETDESKWALLPAPER, 0, $imagePath, ($SPIF_UPDATEINIFILE -bor $SPIF_SENDCHANGE))
`;

        const psScript = path.join(os.tmpdir(), 'setWallpaper.ps1');
        fs.writeFileSync(psScript, script);

        exec(`powershell -ExecutionPolicy Bypass -File "${psScript}"`, (error, stdout, stderr) => {
            fs.unlinkSync(psScript); // Clean up script file
            if (error) {
                console.error('PowerShell Error:', stderr);
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

// Main function to set wallpaper
async function setWallpaperFromURL(url) {
    try {
        // Get Downloads folder path
        const downloadsDir = getDownloadsFolder();
        const wallpaperDir = path.join(downloadsDir, 'Wallpapers');

        // Create Wallpapers directory in Downloads if it doesn't exist
        if (!fs.existsSync(wallpaperDir)) {
            fs.mkdirSync(wallpaperDir);
        }

        // Generate unique filename with proper extension
        const timestamp = Date.now();
        let fileExtension = path.extname(url).toLowerCase();
        // If no extension or invalid extension, default to .jpg
        if (!fileExtension || !['.jpg', '.jpeg', '.png', '.bmp'].includes(fileExtension)) {
            fileExtension = '.jpg';
        }

        const filepath = path.join(wallpaperDir, `wallpaper-${timestamp}${fileExtension}`);

        // Download the image
        console.log('Downloading image...');
        console.log('Download location:', filepath);
        await downloadImage(url, filepath);

        // Verify file exists and has content
        const stats = fs.statSync(filepath);
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
        }

        console.log('Setting wallpaper...');
        await setWallpaperWindows(filepath);

        console.log('Wallpaper set successfully!');
        console.log('Image saved in:', filepath);

    } catch (error) {
        console.error('Error:', error.message);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
    }
}




const imageUrl = "https://images.unsplash.com/photo-1735124283566-5f5707a40808?q=80&w=3264&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

setWallpaperFromURL(imageUrl);

