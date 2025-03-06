const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const url = require('url');

function downloadImage(imageUrl) {
    return new Promise((resolve, reject) => {
        // Parse the URL to get the filename
        const pathname = url.parse(imageUrl).pathname;
        const filename = path.basename(pathname);
        
        // Create downloads folder if it doesn't exist
        const downloadDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir);
        }
        
        const filepath = path.join(downloadDir, filename);
        const file = fs.createWriteStream(filepath);

        https.get(imageUrl, (response) => {
            // Check if the response is successful
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download image. Status Code: ${response.statusCode}`));
                return;
            }

            // Pipe the image data to the file
            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve(filepath);
            });
        }).on('error', (err) => {
            // Clean up: delete the file if download failed
            fs.unlink(filepath, () => {});
            reject(err);
        });
    });
}

function setWallpaper(imagePath) {
    return new Promise((resolve, reject) => {
        // PowerShell command to set wallpaper
        const psCommand = `
            Add-Type -TypeDefinition @"
            using System.Runtime.InteropServices;
            public class Wallpaper {
                [DllImport("user32.dll", CharSet=CharSet.Auto)]
                public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
            }
"@
            $SPI_SETDESKWALLPAPER = 0x0014
            $SPIF_UPDATEINIFILE = 0x01
            $SPIF_SENDCHANGE = 0x02
            [Wallpaper]::SystemParametersInfo($SPI_SETDESKWALLPAPER, 0, "${imagePath}", $SPIF_UPDATEINIFILE -bor $SPIF_SENDCHANGE)
        `;

        // Execute PowerShell command
        exec(`powershell -command "${psCommand}"`, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

async function main(imageUrl) {
    try {
        console.log('Downloading image...');
        const imagePath = await downloadImage(imageUrl);
        
        console.log('Setting wallpaper...');
        await setWallpaper(imagePath);
        
        console.log('Wallpaper set successfully!');
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Example usage
// Replace this URL with your wallpaper URL
const wallpaperUrl = 'https://www.google.com/url?sa=i&url=https%3A%2F%2Funsplash.com%2Fs%2Fphotos%2Fwalpaper&psig=AOvVaw2Vv6ADb0JDt7Hyuej2MbKH&ust=1740478973219000&source=images&cd=vfe&opi=89978449&ved=0CBEQjRxqFwoTCODl-MiL3IsDFQAAAAAdAAAAABAE';
main(wallpaperUrl);