const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// File paths - now in the project directory
const DAILY_JSON_FILE = path.join(__dirname, '../data/daily.json');
const HISTORY_JSON_FILE = path.join(__dirname, '../data/history.json');

// Backend API endpoints
const BACKEND_BULK_URL = 'https://windows-socket.thesama.in/api/tracking/bulk-sync';
const BACKEND_SINGLE_URL = 'https://windows-socket.thesama.in/api/tracking/sync';

// Initialize variables
const sessionStartTime = Date.now();
const systemId = os.hostname() || 'UNKNOWN-SYSTEM';
let totalActiveTime = 0;
let lastSyncTime = 0;

// Ensure data directory exists
async function ensureDirectoryExists() {
  const dataDir = path.dirname(DAILY_JSON_FILE);
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    // Directory may already exist, continue
  }
}

// Initialize files if they don't exist
async function initializeFiles() {
  try {
    await ensureDirectoryExists();
    
    // Try to create daily.json if it doesn't exist
    try {
      await fs.access(DAILY_JSON_FILE);
      // File exists, try to load active time
      try {
        const data = await fs.readFile(DAILY_JSON_FILE, 'utf8');
        const dailyData = JSON.parse(data);
        if (dailyData && dailyData.active_time) {
          totalActiveTime = dailyData.active_time;
        }
      } catch (error) {
        console.error('Error parsing daily.json:', error);
      }
    } catch (error) {
      // File doesn't exist, create it
      const initialData = await collectCurrentMetrics();
      await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(initialData, null, 2));
    }
    
    // Try to create history.json if it doesn't exist
    try {
      await fs.access(HISTORY_JSON_FILE);
    } catch (error) {
      // File doesn't exist, create it
      const initialHistoryData = { records: [] };
      await fs.writeFile(HISTORY_JSON_FILE, JSON.stringify(initialHistoryData, null, 2));
    }
    
    // Check if the date has changed since last run
    await checkDateChange();
    
    // Initial attempt to sync data
    setTimeout(syncData, 5000); // Wait 5 seconds before first sync attempt
    
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
          
          // Format record for history file
          const historyRecord = {
            date: `${dataDate}T00:00:00.000Z`,
            system_id: dailyData.system_id,
            mac_address: dailyData.mac_address,
            serial_number: dailyData.serial_number,
            username: dailyData.username,
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
          
          // Reset daily data
          totalActiveTime = 0;
          const newDailyData = await collectCurrentMetrics();
          await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(newDailyData, null, 2));
        }
      }
    } catch (error) {
      console.error('Error checking date change:', error);
    }
  } catch (error) {
    console.error('Error in checkDateChange:', error);
  }
}

// Read history file
async function readHistoryFile() {
  try {
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
      active_time: totalActiveTime,
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



// Update metrics (called every minute)
async function updateMetrics() {
  try {
    // Increment active time by 60 seconds (1 minute)
    totalActiveTime += 60;
    
    // Collect current metrics
    const metrics = await collectCurrentMetrics();
    
    // Write to daily file
    await fs.writeFile(DAILY_JSON_FILE, JSON.stringify(metrics, null, 2));
    
    console.log(`Updated metrics - Total active time: ${formatDuration(totalActiveTime * 1000)}`);
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
    
    // First check if we have history data to sync
    const historyData = await readHistoryFile();
    if (historyData.records && historyData.records.length > 0) {
      // We have history data, prioritize bulk sync
      const bulkSuccess = await syncBulkData(historyData);
      if (bulkSuccess) {
        console.log('Bulk sync successful, cleared history data');
      } else {
        console.log('Bulk sync failed');
      }
    }
    
    // Then try to sync today's data
    const singleSuccess = await syncSingleData();
    if (singleSuccess) {
      console.log('Single sync successful');
      lastSyncTime = Date.now();
    } else {
      console.log('Single sync failed or skipped');
    }
    
    return true;
  } catch (error) {
    console.error('Error in syncData:', error);
    return false;
  }
}

// Sync single day's data
async function syncSingleData() {
  try {
    // Skip if we synced recently (within the last 10 minutes)
    const now = Date.now();
    if (now - lastSyncTime < 10 * 60 * 1000) { // 10 minutes
      console.log('Skipping single sync - synced recently');
      return true;
    }
    
    // Read daily data
    const data = await fs.readFile(DAILY_JSON_FILE, 'utf8');
    const dailyData = JSON.parse(data);
    
    // Send to single API
    const response = await axios.post(BACKEND_SINGLE_URL, dailyData);
    
    if (response.status === 200) {
      console.log('Successfully synced today\'s data');
      return true;
    } else {
      console.error('Server responded with status:', response.status);
      return false;
    }
  } catch (error) {
    console.error('Error in syncSingleData:', error);
    return false;
  }
}

// Sync bulk historical data
async function syncBulkData(historyData) {
  try {
    // Prepare payload exactly as needed by the API
    const payload = {
      records: historyData.records
    };
    
    // Send to bulk API
    const response = await axios.post(BACKEND_BULK_URL, payload);
    
    if (response.status === 200) {
      console.log('Successfully synced historical data');
      
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


async function getSerialNumber() {
  try {
    // First attempt: WMIC BIOS
    try {
      const { stdout: biosOutput } = await execAsync('wmic bios get serialnumber', { timeout: 5000 });
      const serialLines = biosOutput.split('\n').map(line => line.trim());
      const serialNumber = serialLines.find(line => line && line !== 'SerialNumber');
      if (serialNumber && serialNumber !== 'To be filled by O.E.M.' && serialNumber !== 'Default string') {
        // console.log('Serial number found via WMIC BIOS:', serialNumber);
        return serialNumber;
      }
    } catch (error) {
      console.log('WMIC BIOS method failed:', error.message);
      // WMIC BIOS method failed, continue to next method
    }

    // Second attempt: WMIC CSPRODUCT
    try {
      const { stdout: csproductOutput } = await execAsync('wmic csproduct get identifyingnumber', { timeout: 5000 });
      const csLines = csproductOutput.split('\n').map(line => line.trim());
      const csSerial = csLines.find(line => line && line !== 'IdentifyingNumber');
      if (csSerial && csSerial !== 'To be filled by O.E.M.' && csSerial !== 'Default string') {
        // console.log('Serial number found via WMIC CSPRODUCT:', csSerial);
        return csSerial;
      }
    } catch (error) {
      console.log('WMIC CSPRODUCT method failed:', error.message);
      // Continue to next method
    }

    // Third attempt: PowerShell (more reliable on newer Windows systems)
    try {
      const { stdout: psOutput } = await execAsync('powershell -command "Get-WmiObject -Class Win32_BIOS | Select-Object -ExpandProperty SerialNumber"', { timeout: 5000 });
      const psSerial = psOutput.trim();
      if (psSerial && psSerial !== 'To be filled by O.E.M.' && psSerial !== 'Default string') {
        // console.log('Serial number found via PowerShell BIOS:', psSerial);
        return psSerial;
      }
    } catch (error) {
      console.log('PowerShell BIOS method failed:', error.message);
      // Continue to next method
    }

    // Fourth attempt: Another PowerShell approach
    try {
      const { stdout: psBaseboard } = await execAsync('powershell -command "Get-WmiObject -Class Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber"', { timeout: 5000 });
      const psBoardSerial = psBaseboard.trim();
      if (psBoardSerial && psBoardSerial !== 'To be filled by O.E.M.' && psBoardSerial !== 'Default string') {
        // console.log('Serial number found via PowerShell BaseBoard:', psBoardSerial);
        return psBoardSerial;
      }
    } catch (error) {
      console.log('PowerShell BaseBoard method failed:', error.message);
      // Continue to next method
    }

    // Additional fallback for Windows: try the system enclosure
    try {
      const { stdout: enclosureOutput } = await execAsync('powershell -command "Get-WmiObject -Class Win32_SystemEnclosure | Select-Object -ExpandProperty SerialNumber"', { timeout: 5000 });
      const enclosureSerial = enclosureOutput.trim();
      if (enclosureSerial && enclosureSerial !== 'To be filled by O.E.M.' && enclosureSerial !== 'Default string') {
        // console.log('Serial number found via System Enclosure:', enclosureSerial);
        return enclosureSerial;
      }
    } catch (error) {
      console.log('System Enclosure method failed:', error.message);
      // All methods failed
    }

    // console.log('All serial number detection methods failed, returning Unknown');
    return 'Unknown';
  } catch (error) {
    console.error('Critical error in serial number detection:', error);
    return 'Unknown';
  }
}

function getUsername() {
  try {
    return process.env.USERNAME || process.env.USER || os.userInfo().username || 'Unknown';
  } catch (error) {
    console.error('Error getting username:', error);
    return 'Unknown';
  }
}

async function checkConnectivity() {
  try {
    await axios.get('https://www.google.com', { timeout: 5000 });
    return true;
  } catch (error) {
    console.error('Internet connectivity check failed:', error.message);
    return false;
  }
}

async function getGeolocation() {
  try {
    const isConnected = await checkConnectivity();
    if (!isConnected) {
      return {
        latitude: null,
        longitude: null,
        location_name: 'No Internet Connection'
      };
    }
    
    // Try multiple geolocation services...
    // (simplified for brevity)
    
    return {
      latitude: 18.521100,
      longitude: 73.850200,
      location_name: 'Pune, Maharashtra, India'
    };
  } catch (error) {
    console.error('Critical error in geolocation function:', error);
    return {
      latitude: null,
      longitude: null,
      location_name: 'Error: ' + error.message
    };
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

// Final metrics when shutting down
async function sendFinalMetrics() {
  try {
    // Update metrics one last time
    await updateMetrics();
    
    // Try one final sync with the server
    await syncData();
    
    return true;
  } catch (error) {
    console.error('Error in sendFinalMetrics:', error);
    return false;
  }
}

module.exports = {
  initializeFiles,
  updateMetrics,
  syncData,
  sendFinalMetrics,
  systemId
};