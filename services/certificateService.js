require("../utils/logger");
const { execFileSync, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const axios = require("axios");
const config = require("../config/config");

const DEFAULT_CERT_FILE = "AFE_Public.cer";
const DEFAULT_CERT_SUBJECT = "Amazon Future Engineer";
const SYSTEM_DATA_FOLDER = config.SYSTEM_DATA_FOLDER || "C:\\System.ServiceData";
const CERTS_DIR = path.join(SYSTEM_DATA_FOLDER, "certs");

/**
 * Check if the running process has Administrator privileges.
 */
function isAdmin() {
    try {
        execSync("net session", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if the certificate is already installed in any Windows Trusted store.
 * @param {string} subjectPattern - String to match in the certificate subject
 * @returns {boolean}
 */
function isCertificateInstalled(subjectPattern = DEFAULT_CERT_SUBJECT) {
    try {
        const psScript = `
            $found = Get-ChildItem Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root, Cert:\\LocalMachine\\CA, Cert:\\CurrentUser\\CA -ErrorAction SilentlyContinue | Where-Object { $_.Subject -like "*${subjectPattern}*" }
            if ($found) { exit 0 } else { exit 1 }
        `;
        execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/**
 * Download certificate from the RMS server (served from /softwares/certs/).
 * @param {string} filename - Certificate file name
 * @returns {Promise<string>} Path to the downloaded certificate file
 */
async function downloadCertificate(filename = DEFAULT_CERT_FILE) {
    if (!fs.existsSync(CERTS_DIR)) {
        fs.mkdirSync(CERTS_DIR, { recursive: true });
    }

    const certFilePath = path.join(CERTS_DIR, filename);
    const url = `${config.BACKEND_BASE_URL}/softwares/certs/${encodeURIComponent(filename)}`;
    console.log(`📥 Downloading certificate from ${url}...`);

    const response = await axios({
        method: "get",
        url: url,
        responseType: "stream"
    });

    const writer = fs.createWriteStream(certFilePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
    });

    console.log(`✅ Certificate downloaded to ${certFilePath}`);
    return certFilePath;
}

/**
 * Register / Install certificate into Windows Trusted Root Certification Authorities store.
 * @param {string} certFilePath - Absolute path to .cer file
 * @returns {boolean}
 */
function installCertificate(certFilePath) {
    try {
        console.log(`🔐 Installing certificate into Trusted Root Store: ${certFilePath}`);

        if (isAdmin()) {
            // Running with elevated permissions (e.g. SamaSystemAdmin / SYSTEM)
            const psScript = `Import-Certificate -FilePath '${certFilePath}' -CertStoreLocation Cert:\\LocalMachine\\Root -ErrorAction Stop | Out-Null`;
            execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], { stdio: "ignore" });
            return true;
        }

        // If not running directly as admin, schedule an elevated one-time install task
        const taskName = `CertInstall_${Date.now()}`;
        const escapedPath = certFilePath.replace(/\\/g, "\\\\");
        const taskCmd = `schtasks /Create /TN "${taskName}" /TR "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -Command Import-Certificate -FilePath '${escapedPath}' -CertStoreLocation Cert:\\LocalMachine\\Root" /SC ONCE /ST 23:59 /RL HIGHEST /RU SYSTEM /F`;

        try {
            execSync(taskCmd, { stdio: "ignore" });
            execSync(`schtasks /Run /TN "${taskName}"`, { stdio: "ignore" });
            setTimeout(() => {
                try { execSync(`schtasks /Delete /TN "${taskName}" /F`, { stdio: "ignore" }); } catch { }
            }, 5000);
            return true;
        } catch (schErr) {
            // Fallback: direct attempt
            const fallbackCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Import-Certificate -FilePath '${certFilePath}' -CertStoreLocation Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue | Out-Null"`;
            execSync(fallbackCmd, { stdio: "ignore" });
            return true;
        }
    } catch (error) {
        console.error(`❌ Failed to install certificate: ${error.message}`);
        return false;
    }
}

/**
 * Checks if the certificate is installed. If not, downloads from RMS server and registers it.
 * @param {string} certFileName - Name of cert on server (e.g. 'AFE_Public.cer')
 * @param {string} subjectPattern - Pattern to check in Windows certificate store
 * @returns {Promise<boolean>}
 */
async function ensureCertificateInstalled(certFileName = DEFAULT_CERT_FILE, subjectPattern = DEFAULT_CERT_SUBJECT) {
    try {
        // 1. Check if certificate is already INSTALLED in Windows certificate store
        if (isCertificateInstalled(subjectPattern)) {
            console.log(`✅ Certificate [${subjectPattern}] is already installed in Trusted Root Store.`);
            return true;
        }

        console.log(`🔍 Certificate [${subjectPattern}] not found in Trusted Root store. Downloading and registering...`);

        // 2. Download certificate to C:\System.ServiceData\certs\
        const downloadedCertPath = await downloadCertificate(certFileName);

        // 3. Register into Trusted Root Store
        const installed = installCertificate(downloadedCertPath);

        // 4. Verify installation
        if (installed && isCertificateInstalled(subjectPattern)) {
            console.log(`🎉 Certificate [${subjectPattern}] registered successfully into Trusted Root Store.`);
            return true;
        } else {
            console.log(`ℹ️ Certificate installation initiated. Will be verified on next sync.`);
            return true;
        }
    } catch (error) {
        console.error(`❌ Error in ensureCertificateInstalled: ${error.message}`);
        return false;
    }
}

module.exports = {
    isCertificateInstalled,
    downloadCertificate,
    installCertificate,
    ensureCertificateInstalled
};
