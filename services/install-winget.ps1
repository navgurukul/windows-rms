# Check if WinGet is installed
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "WinGet already installed."
    exit
}

# Open Microsoft Store page for App Installer
Start-Process "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1"
Start-Sleep -Seconds 1
Write-Host "Please install 'App Installer' from the opened Microsoft Store page."


