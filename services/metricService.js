require("../utils/logger");
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const crypto = require('crypto');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { BACKEND_BULK_URL: BACKEND_BULK_URL_CONFIG, BACKEND_SINGLE_URL: BACKEND_SINGLE_URL_CONFIG, BACKEND_BASE_URL } = require('../config/config');
const net = require('net');

// New file paths - in C drive hidden folder with cryptic name
const APP_DATA_FOLDER = path.join('C:', 'System.ServiceData');
const DAILY_JSON_FILE = path.join(APP_DATA_FOLDER, 'daily.json');
const HISTORY_JSON_FILE = path.join(APP_DATA_FOLDER, 'history.json');
const DEVICE_INFO_FILE = path.join(APP_DATA_FOLDER, 'device_info.json');

// Backend API endpoints
const BACKEND_BULK_URL = BACKEND_BULK_URL_CONFIG /*|| 'https://windows-socket.thesama.in/api/tracking/bulk-sync';*/
const BACKEND_SINGLE_URL = BACKEND_SINGLE_URL_CONFIG /*|| 'https://windows-socket.thesama.in/api/tracking/sync';*/

// Initialize variables
const sessionStartTime = Date.now();
const systemId = os.hostname() || 'UNKNOWN-SYSTEM';
let totalActiveTime = 0; // Tracks values 1-5 for display in daily.json
let lastSyncTime = 0;
let backendTotalTime = 0; // Internal variable to track increments of 5 for the backend

// Geolocation cache
let cachedGeolocation = null;
let geolocationCacheTime = 0;
const GEOLOCATION_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Make folder hidden in Windows
async function makeDirectoryHidden() {
  try {
    await execAsync(`attrib +h "${APP_DATA_FOLDER}"`);
    console.log('Successfully made data directory hidden');
  } catch (error) {
    console.error('Error making directory hidden:', error);
    // Continue even if we can't make it hidden
  }
}

// Ensure data directory exists
async function ensureDirectoryExists() {
  try {
    await fs.mkdir(APP_DATA_FOLDER, { recursive: true });
    // Try to make the directory hidden
    await makeDirectoryHidden();
  } catch (error) {
    // Directory may already exist, continue
    console.log('Data directory may already exist:', error.message);
  }
}

async function initializeFiles() {
  try {
    await ensureDirectoryExists();

    // Set totalActiveTime to 1 (always start fresh)
    totalActiveTime = 1;

    // Ensure history.json exists
    try {
      await fs.access(HISTORY_JSON_FILE);
    } catch (error) {
      // File doesn't exist, create it
      const emptyHistory = { records: [] };
      await fs.writeFile(HISTORY_JSON_FILE, JSON.stringify(emptyHistory, null, 2));
      console.log('Created new history.json file');
    }

    // Check for date change first
    await checkDateChange();

    // Create daily.json if it doesn't exist, or reset it if it has a large value
    try {
      await fs.access(DAILY_JSON_FILE);
      // File exists, check if it has an abnormally large value
      try {
        const data = await fs.readFile(DAILY_JSON_FILE, 'utf8');
        const dailyData = JSON.parse(data);

        if (dailyData && dailyData.active_time && dailyData.active_time > 5) {
          console.log('Found large active_time value, resetting to 1');
          // Reset the file with new data
          const newData = await collectCurrentMetrics();
          await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(newData, null, 2));
        }
      } catch (error) {
        console.error('Error parsing daily.json:', error);
        // Create new file on error
        const initialData = await collectCurrentMetrics();
        await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(initialData, null, 2));
      }
    } catch (error) {
      // File doesn't exist, create it
      const initialData = await collectCurrentMetrics();
      await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(initialData, null, 2));
    }

    // Try to sync immediately on startup if we have internet
    const isConnected = await checkConnectivity();
    if (isConnected) {
      console.log('Internet connection detected on startup, attempting to sync');
      await syncData();
    }

    console.log('Files initialized successfully');
  } catch (error) {
    console.error('Error initializing files:', error);
    throw error;
  }
}

// Check if date has changed and move previous day's data to history
async function checkDateChange() {
  try {
    const today = new Date().toISOString().split('T')[0];

    try {
      const data = await fs.readFile(DAILY_JSON_FILE, 'utf8');
      const dailyData = JSON.parse(data);

      // If we have data and it's from a previous day
      if (dailyData && dailyData.date) {
        const dataDate = dailyData.date.split('T')[0];
        if (dataDate !== today) {
          console.log(`Date changed from ${dataDate} to ${today}, moving data to history`);

          // Only move to history if there's actual data to move
          if (dailyData.active_time > 0) {
            // Format record for history file
            const historyRecord = {
              date: `${dataDate}T00:00:00.000Z`,
              system_id: dailyData.system_id,
              mac_address: dailyData.mac_address,
              serial_number: dailyData.serial_number,
              username: dailyData.username,
              // Use the actual accumulated time, not just 5
              total_time: dailyData.active_time,
              last_updated: dailyData.last_updated || new Date().toISOString(),
              latitude: dailyData.latitude,
              longitude: dailyData.longitude,
              location_name: dailyData.location_name
            };

            // Read history file
            const historyData = await readHistoryFile();

            // Add record to history
            historyData.records.push(historyRecord);

            // Write updated history
            await fs.writeFile(HISTORY_JSON_FILE, JSON.stringify(historyData, null, 2));

            console.log(`Added record from ${dataDate} to history.json with ${historyRecord.total_time} minutes`);
          }

          // Reset tracking variables for the new day
          totalActiveTime = 1;
          backendTotalTime = 0;
          const newDailyData = await collectCurrentMetrics();
          await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(newDailyData, null, 2));

          console.log(`Created new daily.json for ${today}`);

          // Immediately attempt to sync history data when date changes
          const isConnected = await checkConnectivity();
          if (isConnected) {
            console.log('Internet connection detected, attempting to sync historical data');
            const historyData = await readHistoryFile();
            if (historyData.records && historyData.records.length > 0) {
              const syncSuccess = await syncBulkData(historyData);
              if (syncSuccess) {
                console.log('Successfully synced historical data after date change');
              } else {
                console.log('Failed to sync historical data after date change, will retry later');
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking date change:', error);

      // If we can't read the file, create a new one for today
      totalActiveTime = 1;
      backendTotalTime = 0;
      const newDailyData = await collectCurrentMetrics();
      await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(newDailyData, null, 2));
    }
  } catch (error) {
    console.error('Error in checkDateChange:', error);
  }
}

// Read history file - with existence check
async function readHistoryFile() {
  try {
    // First check if file exists
    try {
      await fs.access(HISTORY_JSON_FILE);
    } catch (error) {
      // File doesn't exist, create an empty one
      await ensureDirectoryExists(); // Make sure the directory exists
      const emptyHistory = { records: [] };
      await fs.writeFile(HISTORY_JSON_FILE, JSON.stringify(emptyHistory, null, 2));
      return emptyHistory;
    }

    // Now read the file (we know it exists)
    const data = await fs.readFile(HISTORY_JSON_FILE, 'utf8');
    const historyData = JSON.parse(data);

    // Ensure structure
    if (!historyData.records) {
      historyData.records = [];
    }

    return historyData;
  } catch (error) {
    console.error('Error reading history file:', error);
    return { records: [] };
  }
}

// Collect system metrics
async function collectCurrentMetrics() {
  try {
    // Collect all metrics in parallel
    const [macAddress, serialNumber, geolocation] = await Promise.all([
      getMacAddress(),
      getSerialNumber(),
      getGeolocation()
    ]);

    const username = getUsername();
    const today = new Date().toISOString().split('T')[0];

    return {
      username: username,
      system_id: systemId,
      mac_address: macAddress,
      serial_number: serialNumber,
      active_time: totalActiveTime, // This shows current active time
      latitude: geolocation.latitude,
      longitude: geolocation.longitude,
      location_name: geolocation.location_name,
      date: `${today}T00:00:00.000Z`,
      last_updated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error collecting metrics:', error);
    throw error;
  }
}

// Update metrics (called every minute) - with sync-dependent reset
async function updateMetrics() {
  try {
    // Check for date change first
    await checkDateChange();

    // Increment active time by 1 minute
    totalActiveTime += 1;

    // Check if we've reached a 5-minute interval
    if (totalActiveTime >= 5) {
      console.log('Reached 5-minute milestone, attempting to sync with backend');

      // Try to sync with backend
      const syncSuccess = await syncData();

      if (syncSuccess) {
        // Only reset if sync was successful
        console.log('Sync successful, resetting counter to 1');
        totalActiveTime = 1;
        // Increment backend total only on successful sync
        backendTotalTime += 5;
      } else {
        console.log('Sync failed, continuing to increment timer');
        // Don't reset the counter, continue accumulating
      }
    }

    // Collect current metrics with the current totalActiveTime
    const metrics = await collectCurrentMetrics();

    // Write to daily file
    await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(metrics, null, 2));

    console.log(`Updated metrics - Current active time: ${totalActiveTime} minutes, Backend total: ${backendTotalTime} minutes`);
    return true;
  } catch (error) {
    console.error('Error updating metrics:', error);
    return false;
  }
}

// Sync data with backend (handles both single and bulk sync)
async function syncData() {
  try {
    const isConnected = await checkConnectivity();
    if (!isConnected) {
      console.log('No internet connection, skipping sync');
      return false;
    }

    let syncSuccessful = false;

    // First check if we have history data to sync
    const historyData = await readHistoryFile();
    if (historyData.records && historyData.records.length > 0) {
      // We have history data, prioritize bulk sync
      const bulkSuccess = await syncBulkData(historyData);
      if (bulkSuccess) {
        console.log('Bulk sync successful, cleared history data');
        syncSuccessful = true;
      } else {
        console.log('Bulk sync failed');
      }
    }

    // Then try to sync today's data
    const singleSuccess = await syncSingleData();
    if (singleSuccess) {
      console.log('Single sync successful');
      lastSyncTime = Date.now();
      syncSuccessful = true;
    } else {
      console.log('Single sync failed or skipped');
    }

    // Return overall success status - must have at least one successful sync
    return syncSuccessful;
  } catch (error) {
    console.error('Error in syncData:', error);
    return false;
  }
}

// Sync single day's data
async function syncSingleData() {
  try {
    // Read daily data
    const data = await fs.readFile(DAILY_JSON_FILE, 'utf8');
    let dailyData = JSON.parse(data);

    // Create a payload that always sends 5 minutes to the backend
    const syncPayload = {
      username: dailyData.username,
      system_id: dailyData.system_id,
      mac_address: dailyData.mac_address,
      serial_number: dailyData.serial_number,
      active_time: 5, // Always send exactly 5 minutes
      latitude: dailyData.latitude,
      longitude: dailyData.longitude,
      location_name: dailyData.location_name,
      date: dailyData.date,
      last_updated: new Date().toISOString()
    };

    // Delay for 2 seconds before sending to single API so that device is registered
    const deviceExists = await axios.get(`${BACKEND_BASE_URL}/api/devices/serial/${dailyData.serial_number}`);
    if (deviceExists.status === 200) {
      console.log('Device is registered, sending data');
    } else {
      console.log('Device is not registered, skipping data');
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    const response = await axios.post(BACKEND_SINGLE_URL, syncPayload);

    // Return true only if we get a 200 status
    return response.status === 200;
  } catch (error) {
    console.error('Error in syncSingleData:', error);
    return false;
  }
}

// Sync bulk historical data
async function syncBulkData(historyData) {
  try {
    // Ensure we have records to sync
    if (!historyData.records || historyData.records.length === 0) {
      console.log('No historical records to sync');
      return true; // Return true for empty records (not a failure)
    }

    // Prepare payload exactly as needed by the API
    const payload = {
      records: historyData.records
    };

    // Delay for 2 seconds before sending to bulk API so that device is registered
    const deviceExists = await axios.get(`${BACKEND_BASE_URL}/api/devices/serial/${await getSerialNumber()}`);
    if (deviceExists.status === 200) {
      console.log('Device is registered, sending data');
    } else {
      console.log('Device is not registered, skipping data');
      return false;
    }
    const response = await axios.post(BACKEND_BULK_URL, payload);

    if (response.status === 200) {
      console.log(`Successfully synced ${historyData.records.length} historical records`);

      // Clear history after successful sync
      await fs.writeFile(HISTORY_JSON_FILE, JSON.stringify({ records: [] }, null, 2));

      return true;
    } else {
      console.error('Server responded with status:', response.status);
      return false;
    }
  } catch (error) {
    console.error('Error in syncBulkData:', error);
    return false;
  }
}

// Helper functions (from your original code)
async function getMacAddress() {
  try {
    const networkInterfaces = os.networkInterfaces();
    for (const iface of Object.values(networkInterfaces)) {
      for (const adapter of iface) {
        if (!adapter.internal && adapter.mac && adapter.mac !== '00:00:00:00:00:00') {
          return adapter.mac;
        }
      }
    }
    return 'Unknown';
  } catch (error) {
    console.error('Error getting MAC address:', error);
    return 'Unknown';
  }
}

async function ensureWmiHealthy() {
  try {
    console.log('[WMI] Checking WMI service health...');

    // ✅ 1. Check service status
    const { stdout: status } = await execAsync(
      'powershell -Command "(Get-Service winmgmt).Status"'
    );

    if (!status.toLowerCase().includes('running')) {
      console.warn('[WMI] Service not running — trying to start...');
      await execAsync('powershell -Command "Start-Service winmgmt"');
    }

    // ✅ 2. Verify repository — DO NOT rely on exit code!
    let verifyOutput = '';
    try {
      const { stdout } = await execAsync(
        'powershell -Command "winmgmt /verifyrepository"'
      );
      verifyOutput = stdout;
    } catch (e) {
      // Even if exit code is non-zero, stdout contains message
      verifyOutput = e.stdout || e.message || '';
    }

    const lower = verifyOutput.toLowerCase();

    if (lower.includes('inconsistent') || lower.includes('corrupt')) {
      console.warn('[WMI] Inconsistent — attempting salvage...');
      try {
        await execAsync('powershell -Command "winmgmt /salvagerepository"');
        console.log('[WMI] Salvage successful.');
      } catch (e) {
        console.warn('[WMI] Salvage failed — trying reset...');
        await execAsync('powershell -Command "winmgmt /resetrepository"');
        console.log('[WMI] Reset successful.');
      }
    }

    console.log('[WMI] Health check complete. Healthy. ✅');
    return true;

  } catch (err) {
    // ✅ Log stderr/stdout so you know the real reason
    console.error('[WMI] Health check failed:', {
      message: err.message,
      stdout: err.stdout,
      stderr: err.stderr
    });
    return false;
  }
}

async function getSerialNumber() {
  const INVALID_SERIALS = new Set([
    'to be filled by o.e.m.', 'default string', 'none', 'n/a',
    'not specified', 'system serial number', '', 'unknown',
    '0', '00000000', 'ffffffff'
  ]);

  function isValidSerial(s) {
    if (!s) return false;
    const lower = s.trim().toLowerCase();
    return !INVALID_SERIALS.has(lower) && lower.length >= 4;
  }

  try {
    // 1. Return cached value if valid
    try {
      const infoData = await fs.readFile(DEVICE_INFO_FILE, 'utf8');
      const info = JSON.parse(infoData);
      if (info && info.serialNumber && info.serialNumber !== 'Unknown') {
        return info.serialNumber;
      }
    } catch (e) {
      // Ignore if file doesn't exist
    }

    let detectedSerial = null;

    // 2. WMI via PowerShell (existing approach + CIM fallback)
    await ensureWmiHealthy();

    const wmiCmds = [
      'Get-WmiObject -Class Win32_BIOS | Select-Object -ExpandProperty SerialNumber',
      'Get-WmiObject -Class Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber',
      'Get-WmiObject -Class Win32_SystemEnclosure | Select-Object -ExpandProperty SerialNumber',
      'Get-CimInstance -ClassName Win32_BIOS | Select-Object -ExpandProperty SerialNumber',
      'Get-CimInstance -ClassName Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber',
    ];

    for (const cmd of wmiCmds) {
      try {
        const { stdout } = await execAsync(`powershell -command "${cmd}"`, { timeout: 6000 });
        if (isValidSerial(stdout.trim())) {
          detectedSerial = stdout.trim();
          console.log(`[Serial] Found via WMI/CIM: ${detectedSerial}`);
          break;
        }
      } catch (error) {
        console.log(`[Serial] WMI cmd failed (${cmd.split('|')[0].trim()}):`, error.message);
      }
    }

    // 3. WMIC CLI (different code path, often works when PS WMI fails)
    if (!detectedSerial) {
      try {
        const { stdout } = await execAsync('wmic bios get serialnumber /value', { timeout: 6000 });
        const match = stdout.match(/SerialNumber=(.+)/i);
        if (match && isValidSerial(match[1].trim())) {
          detectedSerial = match[1].trim();
          console.log(`[Serial] Found via WMIC CLI: ${detectedSerial}`);
        }
      } catch (e) {
        console.log('[Serial] WMIC CLI failed:', e.message);
      }
    }

    // 4. Registry BIOS (kernel-populated, bypasses WMI entirely)
    if (!detectedSerial) {
      const regKeys = [
        'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS /v SystemSerialNumber',
        'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS /v BaseBoardSerialNumber',
      ];
      for (const regKey of regKeys) {
        try {
          const { stdout } = await execAsync(`reg query "${regKey}"`, { timeout: 5000 });
          const match = stdout.match(/REG_SZ\s+(.+)/i);
          if (match && isValidSerial(match[1].trim())) {
            detectedSerial = match[1].trim();
            console.log(`[Serial] Found via Registry: ${detectedSerial}`);
            break;
          }
        } catch (e) {
          console.log('[Serial] Registry query failed:', e.message);
        }
      }
    }

    // 5. Windows Product ID (tied to OS install, stable across reboots)
    if (!detectedSerial) {
      try {
        const { stdout } = await execAsync(
          'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v ProductId',
          { timeout: 5000 }
        );
        const match = stdout.match(/ProductId\s+REG_SZ\s+(.+)/i);
        if (match && isValidSerial(match[1].trim())) {
          detectedSerial = `WIN-${match[1].trim()}`;
          console.log(`[Serial] Found via Windows ProductId: ${detectedSerial}`);
        }
      } catch (e) {
        console.log('[Serial] ProductId query failed:', e.message);
      }
    }

    // 6. Hardware fingerprint: short hash of MAC + CPU + Disk IDs
    if (!detectedSerial) {
      try {
        const parts = [];

        const mac = await getMacAddress();
        if (mac && mac !== 'Unknown') parts.push(mac);

        try {
          const { stdout } = await execAsync(
            'powershell -command "Get-WmiObject -Class Win32_Processor | Select-Object -First 1 -ExpandProperty ProcessorId"',
            { timeout: 5000 }
          );
          if (stdout.trim().length > 4) parts.push(stdout.trim());
        } catch (e) {}

        try {
          const { stdout } = await execAsync('wmic diskdrive get serialnumber /value', { timeout: 5000 });
          const diskMatch = stdout.match(/SerialNumber=(.+)/i);
          if (diskMatch && diskMatch[1].trim().length > 4) parts.push(diskMatch[1].trim());
        } catch (e) {}

        if (parts.length >= 2) {
          const hash = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8).toUpperCase();
          detectedSerial = `FP-${hash}`;
          console.log(`[Serial] Generated fingerprint (${parts.length} sources): ${detectedSerial}`);
        }
      } catch (e) {
        console.log('[Serial] Hardware fingerprint failed:', e.message);
      }
    }

    // 7. FINAL FALLBACK: Generate and persist a short UUID — NEVER return 'Unknown'
    if (!detectedSerial) {
      const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      detectedSerial = `NG-${uuid}`;
      console.warn(`[Serial] All hardware methods failed. Generated ID: ${detectedSerial}`);
    }

    // Cache the result (always — so it persists across reboots)
    try {
      await ensureDirectoryExists();
      await fs.writeFile(DEVICE_INFO_FILE, JSON.stringify({
        serialNumber: detectedSerial,
        firstDetected: new Date().toISOString(),
        method: detectedSerial.startsWith('FP-') ? 'fingerprint'
              : detectedSerial.startsWith('WIN-') ? 'windows-product-id'
              : detectedSerial.startsWith('NG-') ? 'generated-uuid'
              : 'hardware'
      }, null, 2));
      console.log(`[Serial] Cached: ${detectedSerial}`);
    } catch (e) {
      console.error('[Serial] Failed to cache:', e);
    }

    return detectedSerial;
  } catch (error) {
    console.error('[Serial] Critical error:', error);
    // Even in catastrophic failure, return something unique
    const fallback = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    return `NG-${fallback}`;
  }
}

// async function getSerialNumber() {
//   try {
//     // Third attempt: PowerShell (more reliable on newer Windows systems)
//     try {
//       const { stdout: psOutput } = await execAsync('powershell -command "Get-WmiObject -Class Win32_BIOS | Select-Object -ExpandProperty SerialNumber"', { timeout: 5000 });
//       const psSerial = psOutput.trim();
//       if (psSerial && psSerial !== 'To be filled by O.E.M.' && psSerial !== 'Default string') {
//         return psSerial;
//       }
//     } catch (error) {
//       console.log('PowerShell BIOS method failed:', error.message);
//     }

//     // Fourth attempt: Another PowerShell approach
//     try {
//       const { stdout: psBaseboard } = await execAsync('powershell -command "Get-WmiObject -Class Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber"', { timeout: 5000 });
//       const psBoardSerial = psBaseboard.trim();
//       if (psBoardSerial && psBoardSerial !== 'To be filled by O.E.M.' && psBoardSerial !== 'Default string') {
//         return psBoardSerial;
//       }
//     } catch (error) {
//       console.log('PowerShell BaseBoard method failed:', error.message);
//     }

//     // Additional fallback for Windows: try the system enclosure
//     try {
//       const { stdout: enclosureOutput } = await execAsync('powershell -command "Get-WmiObject -Class Win32_SystemEnclosure | Select-Object -ExpandProperty SerialNumber"', { timeout: 5000 });
//       const enclosureSerial = enclosureOutput.trim();
//       if (enclosureSerial && enclosureSerial !== 'To be filled by O.E.M.' && enclosureSerial !== 'Default string') {
//         return enclosureSerial;
//       }
//     } catch (error) {
//       console.log('System Enclosure method failed:', error.message);
//     }

//     return 'Unknown';
//   } catch (error) {
//     console.error('Critical error in serial number detection:', error);
//     return 'Unknown';
//   }
// }

async function getUsername() {
  try {
    return process.env.USERNAME || process.env.USER || os.userInfo().username || 'Unknown';
  } catch (error) {
    console.error('Error getting username:', error);
    return 'Unknown';
  }
}

// async function checkConnectivity() {
//   try {
//     await axios.get('https://www.google.com', { timeout: 5000 });
//     return true;
//   } catch (error) {
//     console.error('Internet connectivity check failed:', error.message);
//     return false;
//   }
// }

async function checkConnectivity() {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(5000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      resolve(false);
    });

    // Connect to Cloudflare DNS (very reliable)
    socket.connect(53, '1.1.1.1');
  });
}

async function getGeolocation() {
  try {
    // Return cached value if valid
    const now = Date.now();
    if (cachedGeolocation && (now - geolocationCacheTime < GEOLOCATION_CACHE_TTL)) {
      return cachedGeolocation;
    }

    // Check internet connectivity
    const isConnected = await checkConnectivity();
    if (!isConnected) {
      return {
        latitude: null,
        longitude: null,
        location_name: 'No Internet Connection'
      };
    }

    // Try to get location from IP address using ipinfo.io
    try {
      const response = await axios.get('https://ipinfo.io/json');

      if (response.data && response.data.loc) {
        // Split the coordinates string
        const [latitude, longitude] = response.data.loc.split(',').map(coord => parseFloat(coord));
        const locationName = `${response.data.city}, ${response.data.region}, ${response.data.country}`;

        cachedGeolocation = {
          latitude,
          longitude,
          location_name: locationName
        };
        geolocationCacheTime = Date.now();

        return cachedGeolocation;
      }
    } catch (ipinfoError) {
      console.error('IP geolocation failed:', ipinfoError.message);

      // Try fallback service
      try {
        const fallbackResponse = await axios.get('https://ipapi.co/json/');

        if (fallbackResponse.data && fallbackResponse.data.latitude) {
          cachedGeolocation = {
            latitude: fallbackResponse.data.latitude,
            longitude: fallbackResponse.data.longitude,
            location_name: `${fallbackResponse.data.city}, ${fallbackResponse.data.state}, ${fallbackResponse.data.country_name}`
          };
          geolocationCacheTime = Date.now();

          return cachedGeolocation;
        }
      } catch (fallbackError) {
        console.error('Fallback geolocation failed:', fallbackError.message);
      }
    }

    // If both services fail but we have internet, use a default location
    return {
      latitude: 18.521100,
      longitude: 73.850200,
      location_name: 'Pune, Maharashtra, India'
    };

  } catch (error) {
    console.error('Critical error in geolocation function:', error.message);
    return {
      latitude: null,
      longitude: null,
      location_name: 'Error: ' + error.message
    };
  }
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`;
}

// Function to check if the data directory exists and recreate if not
async function checkAndRecreateDataFolder() {
  try {
    await fs.access(APP_DATA_FOLDER);

    // Check if files exist, if not, recreate them
    try {
      await fs.access(DAILY_JSON_FILE);
    } catch (error) {
      // Daily.json doesn't exist, create it
      const initialData = await collectCurrentMetrics();
      await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(initialData, null, 2));
      console.log('Recreated missing daily.json file');
    }

    try {
      await fs.access(HISTORY_JSON_FILE);
    } catch (error) {
      // History.json doesn't exist, create it
      const emptyHistory = { records: [] };
      await fs.writeFile(HISTORY_JSON_FILE, JSON.stringify(emptyHistory, null, 2));
      console.log('Recreated missing history.json file');
    }
  } catch (error) {
    // Directory doesn't exist, recreate everything
    console.log('Data directory missing, recreating it');
    await ensureDirectoryExists();

    // Create files
    const initialData = await collectCurrentMetrics();
    await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(initialData, null, 2));

    const emptyHistory = { records: [] };
    await fs.writeFile(HISTORY_JSON_FILE, JSON.stringify(emptyHistory, null, 2));

    console.log('Data directory and files recreated');
  }
}

// Final metrics when shutting down
async function sendFinalMetrics() {
  try {
    // Check if our data folder exists, recreate if not
    await checkAndRecreateDataFolder();

    // If we're about to shut down, include the current active time in the backend total
    // so we don't lose any tracked time
    if (totalActiveTime > 1) {
      // Try to sync one last time with whatever time we have accumulated
      const isConnected = await checkConnectivity();
      if (isConnected && totalActiveTime >= 5) {
        // We have enough time accumulated to warrant a sync
        await syncData();
      } else if (totalActiveTime > 1) {
        // Not enough time for a sync or no connection, save to daily.json for next startup
        const metrics = await collectCurrentMetrics();
        await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(metrics, null, 2));
        console.log(`Saved final metrics with active_time: ${totalActiveTime}`);
      }
    }

    return true;
  } catch (error) {
    console.error('Error in sendFinalMetrics:', error);
    return false;
  }
}

async function updateCachedSerialNumber(newSerial) {
  try {
    const currentSerial = await getSerialNumber();
    if (currentSerial !== newSerial) {
      console.log(`[Serial] Updating cached serial number from ${currentSerial} to ${newSerial}`);
      await ensureDirectoryExists();
      let info = {};
      try {
        const infoData = await fs.readFile(DEVICE_INFO_FILE, 'utf8');
        info = JSON.parse(infoData);
      } catch (e) {}
      
      info.serialNumber = newSerial;
      info.lastUpdated = new Date().toISOString();
      info.updateMethod = 'server-sync';
      
      await fs.writeFile(DEVICE_INFO_FILE, JSON.stringify(info, null, 2));

      // Also update daily.json if it exists to ensure the sync uses the correct serial number
      try {
        await fs.access(DAILY_JSON_FILE);
        const dailyDataStr = await fs.readFile(DAILY_JSON_FILE, 'utf8');
        const dailyData = JSON.parse(dailyDataStr);
        if (dailyData.serial_number !== newSerial) {
          dailyData.serial_number = newSerial;
          dailyData.last_updated = new Date().toISOString();
          await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(dailyData, null, 2));
          console.log('[Serial] Updated serial number in daily.json');
        }
      } catch (err) {
        // daily.json might not exist yet, which is fine
      }

      // Also update history.json if it exists and contains records
      try {
        await fs.access(HISTORY_JSON_FILE);
        const historyDataStr = await fs.readFile(HISTORY_JSON_FILE, 'utf8');
        const historyData = JSON.parse(historyDataStr);
        if (historyData.records && Array.isArray(historyData.records)) {
          let updated = false;
          for (const record of historyData.records) {
            if (record.serial_number !== newSerial) {
              record.serial_number = newSerial;
              updated = true;
            }
          }
          if (updated) {
            await fs.writeFile(HISTORY_JSON_FILE, JSON.stringify(historyData, null, 2));
            console.log('[Serial] Updated serial numbers in history.json');
          }
        }
      } catch (err) {
        // history.json might not exist yet, which is fine
      }
    }
  } catch (error) {
    console.error('[Serial] Failed to update cached serial number:', error);
  }
}

module.exports = {
  initializeFiles,
  updateMetrics,
  syncData,
  sendFinalMetrics,
  updateCachedSerialNumber,
  systemId,
  getSerialNumber,
  getMacAddress,
  getGeolocation,
  getUsername,
  getDataFilePath: () => APP_DATA_FOLDER // Export the path for external use
};