# Release Notes - Sama System Admin

## Release Notes: v1.3.0 (Controlled Software Store, Redundant Download Prevention, MAC-Based Serial Self-Healing & Mutual AFE Reconciliation) - September 9, 2026

This release introduces critical enhancements to network bandwidth conservation, disk storage optimization, and resilient identity self-healing across remote offline laptop fleets.

### 🛠️ Key Improvements & New Features

#### 1. Authoritative Controlled Software Store (`installed_softwares.json`)
* **Dedicated Status Manifest:** Introduced `C:\System.ServiceData\installed_softwares.json`, an authoritative local database tracking applications deployed through RMS or co-located educational software.
* **Normalized Key Matching (`normalizeAppName`):** Implemented strict normalization converting arbitrary software name formats (e.g., `"Amazon Future Engineer"`, `"amazon_future_engineer"`, `"afe"`) into standardized hyphenated slugs (`"amazon-future-engineer"`), eliminating casing and formatting mismatches.
* **Multi-Alias Registration:** Built-in alias support ensures dual registration for critical apps such as Amazon Future Engineer (`amazon-future-engineer` and `afe`).

#### 2. Redundant 1.3 GB Download Prevention (`demoFunction` & `installFromRmsRepository`)
* **Pre-Download Installation Verification:** Before downloading any software package hosted on `rms-repository`, RMS performs a multi-step check:
  1. Inspects `installed_softwares.json` for verified prior installation records.
  2. Executes `checkPhysicalInstallationFallback()` across standard Windows installation targets (`Program Files`, `%LOCALAPPDATA%\Programs`, and Desktop `.lnk` shortcuts).
* **Immediate Server Confirmation:** If the application is verified as installed, RMS logs the status, immediately notifies the server via `/api/softwares/addHistory` (`{ isSuccessful: true, reason: 'already_installed' }`), and **completely aborts the multi-gigabyte installer download**.
* **Bandwidth & Quota Protection:** Prevents critical school cellular data exhaustion and bandwidth choking across fleets of hundreds of laptops.

#### 3. Automated Orphaned Temp Installer Garbage Collection
* **Temp File Purging (`cleanOrphanedTempInstallers`):** Routine scanner targeting installer artifacts in `os.tmpdir()` (`AppData\Local\Temp`).
* **Stale Installer Detection:** Identifies installer executables matching `RMS_Installer_*` or `Amazon-Future-Engineer-*` older than 30 minutes.
* **Disk Space Reclamation:** Executes automatically prior to download routines and after package installation, preventing laptop hard drives from filling up with gigabytes of orphaned setup binaries.

#### 4. MAC-Based Serial Number Self-Healing (`verifyOrSelfHealDeviceRegistration`)
* **Resilient Registration Verification:** Replaced brittle single-endpoint serial checks with an adaptive verification workflow:
  1. Polls `GET /api/devices/serial/:serial`.
  2. If the server responds with **404 Not Found**, RMS automatically invokes `GET /api/devices/mac/:mac` using the physical network interface address.
  3. If found via MAC, RMS dynamically adopts the server's registered serial number via `updateCachedSerialNumber()`, immediately reconciling `device_info.json`, `daily.json`, and `history.json`.
* **Zero Disconnected Laptops:** Guarantees that laptops never remain in a disconnected 404 state after manual admin adjustments or AFE-driven serial corrections.

#### 5. Mutual AFE Serial Number Cross-Check in `getSerialNumber()`
* **AFE-First Installation Support:** Added Step 1b in the client's serial resolution cascade.
* **Direct Local Config Probe:** RMS safely inspects `%APPDATA%\OfflineLearningApp\config.json` for `customSerialNumber`.
* **Consistent Machine Identity:** Ensures that if school coordinators onboard a laptop through AFE before RMS is deployed, RMS immediately recognizes and adopts the coordinator-verified serial number rather than falling back to generic hardware identifiers.

---

## Release Notes: v1.2.11 - v1.2.13

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

* **v1.3.0**: Major update introducing the authoritative controlled software store, redundant 1.3GB download avoidance, automated temp installer garbage collection, MAC-based serial self-healing, and mutual AFE serial reconciliation.
* **v1.2.13**: Minor package upgrades, updated build configurations, and validation check alignment.
* **v1.2.11**: Major stability update introducing single-instance locking, server-serial sync caching, and indefinite registration retries.
