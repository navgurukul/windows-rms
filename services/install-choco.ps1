mkdir test 

Set-ExecutionPolicy AllSigned
Set-ExecutionPolicy Bypass -Scope Process

IEX (Invoke-Expression((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1')))

SET "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"
