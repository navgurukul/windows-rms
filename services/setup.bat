# get latest download url
$URL = "https://api.github.com/repos/microsoft/winget-cli/releases/latest"
$URL = (Invoke-WebRequest -Uri $URL).Content | ConvertFrom-Json |
        Select-Object -ExpandProperty "assets" |
        Where-Object "browser_download_url" -Match '.msixbundle' |
        Select-Object -ExpandProperty "browser_download_url"
$LicenseFileURL = 'https://github.com/microsoft/winget-cli/releases/download/v1.2.10271/b0a0692da1034339b76dce1c298a1e42_License1.xml'

# download
Invoke-WebRequest -Uri $URL -OutFile "Setup.msix" -UseBasicParsing
Invoke-WebRequest -Uri $LicenseFileURL -OutFile  'license.xml' 

# install
#Add-AppxPackage -Path "Setup.msix" -LicensePath .\license.xml
Add-AppxProvisionedPackage -PackagePath "Setup.msix" -LicensePath 'license.xml' -online 

# delete file
Remove-Item "Setup.msix"