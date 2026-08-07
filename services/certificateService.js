require("../utils/logger");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const config = require("../config/config");

const DEFAULT_CERT_FILE = "AFE_Public.cer";
const DEFAULT_CERT_SUBJECT = "Amazon Future Engineer";
const SYSTEM_DATA_FOLDER = config.SYSTEM_DATA_FOLDER || "C:\\System.ServiceData";
const CERTS_DIR = path.join(SYSTEM_DATA_FOLDER, "certs");

/**
 * Check if the certificate is already installed in the Windows Trusted Root store.
 * @param {string} subjectPattern - String to match in the certificate subject (e.g. 'Amazon Future Engineer')
 * @returns {boolean}
 */
function isCertificateInstalled(subjectPattern = DEFAULT_CERT_SUBJECT) {
    try {
        const psScript = `
            $found = Get-ChildItem Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root -ErrorAction SilentlyContinue | Where-Object { $_.Subject -like "*${subjectPattern}*" }
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
 * @param {string} filename - Certificate file name (e.g. 'AFE_Public.cer')
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

        const psScript = `
            Import-Certificate -FilePath '${certFilePath}' -CertStoreLocation Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue | Out-Null
            Import-Certificate -FilePath '${certFilePath}' -CertStoreLocation Cert:\\CurrentUser\\Root -ErrorAction SilentlyContinue | Out-Null
        `;
        execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], { stdio: "inherit" });

        return true;
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
            console.error(`❌ Failed to verify certificate [${subjectPattern}] in Trusted Root Store after install attempt.`);
            return false;
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
