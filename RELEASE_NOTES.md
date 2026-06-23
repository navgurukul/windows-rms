# Release Notes - Sama System Admin (v1.2.11 - v1.2.13)

This release introduces critical enhancements to device registration robustness, internet connectivity resilience, storage optimization, and deployment stability.

---

## 🛠️ Key Improvements & New Features

### 1. Robust Device Registration & Identity Synchronization
* **Server-Client Serial Sync**: The client now dynamically updates its local files (`device_info.json`, `daily.json`, and `history.json`) to match the primary serial number registered in the backend database. This eliminates `404 Not Found` sync errors and ensures laptops display correctly on the RMS dashboard.
* **Smart Serial Upgrading**: On registration, if the database has a fallback serial number (e.g. `WIN-...`, `FP-...`, or `NG-...`) for a device but the client successfully retrieves a hardware serial number, the database is automatically upgraded to the true hardware serial number.
* **Resilient Serial Detection Chain**: Employs a multi-layered detection fallback chain (WMI ➡️ CIM ➡️ WMIC CLI ➡️ Registry ➡️ Windows Product ID ➡️ Hardware Fingerprint ➡️ Generated UUID) to ensure a unique, persistent identifier is always generated.

### 2. Network & Startup Resilience
* **Startup Blocking & Retry**: The client now blocks initialization steps on startup until a device registration query successfully connects to the server, preventing initialization failure when DNS resolution is slow.
* **Optimized Connectivity Checks**: Increased socket check timeouts from 2s to 5s using Cloudflare's `1.1.1.1` DNS endpoint to ensure network detection is reliable under weak connections.
* **Geolocation Caching**: Implemented a 6-hour caching TTL for IP geolocation to significantly reduce external API queries and prevent rate-limiting issues.

### 3. Application Process & Log Operations
* **Single Instance Lock**: Added a global lock constraint to prevent multiple duplicate app processes from launching concurrently on logon.
* **Automated Log Cleanup (Backend)**: Added an asynchronous background worker on the server to automatically purge device logs older than 10 days, solving server disk space exhaustion.
* **Aggregated Log Uploading**: Grouped and optimized log uploads, adjusting intervals to 6 hours to reduce network load.

### 4. Software Deployment & Installer Fixes
* **MSStore Hard Fix**: Integrated an automated cleanup and re-registration script for Microsoft Store sources in Winget.
* **Custom Software Sources**: Added support to install software directly from the server's repository with direct fallbacks to Winget.

---

## 📦 Version History

* **v1.2.13**: Minor package upgrades, updated build configurations, and validation check alignment.
* **v1.2.11**: Major stability update introducing single-instance locking, server-serial sync caching, and indefinite registration retries.
