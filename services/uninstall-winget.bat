@echo off
setlocal

:: Check for admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo This script requires administrator privileges.
    pause
    exit /b
)

:: Use PowerShell to remove App Installer (which includes WinGet)
echo Attempting to uninstall App Installer...

powershell -Command "Get-AppxPackage Microsoft.DesktopAppInstaller | Remove-AppxPackage"

if %errorlevel%==0 (
    echo App Installer removed successfully.
) else (
    echo Failed to remove App Installer.
)

pause
