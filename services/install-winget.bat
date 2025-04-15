@echo off
setlocal

:: Check if WinGet is already installed
where winget >nul 2>&1
if %errorlevel%==0 (
    echo WinGet is already installed.
    winget --version
    goto :end
)

:: Download and install App Installer (which includes WinGet)
echo WinGet not found. Attempting to install it...

:: Check for OS version
ver | findstr /i "10.0.1[9-9]" >nul
if not %errorlevel%==0 (
    echo Your Windows version might not support WinGet. Minimum required is Windows 10 1809.
    goto :end
)

:: Attempt to install App Installer via Microsoft Store
echo Opening Microsoft Store page for App Installer...
start ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1

echo Please install 'App Installer' from the Microsoft Store window that opened.
pause

:: After user installs App Installer, check again
where winget >nul 2>&1
if %errorlevel%==0 (
    echo WinGet installation successful!
    winget --version
) else (
    echo WinGet installation failed or not completed yet.
)

:end
echo Done.
pause
