
// Updated metricService.js with C drive database path
const os = require('os');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const execAsync = promisify(exec);

const sessionStartTime = Date.now();
const systemId = os.hostname();
let totalActiveTime = 0; // Track total active time across sessions

// Database setup - storing in C drive now


const DB_FOLDER_NAME = 'SystemDataStorage';
const DB_FILE_NAME = 'sysdata_repository.db';

const homeDir = os.homedir();
const dbPath = path.join(homeDir, 'Documents', DB_FOLDER_NAME, DB_FILE_NAME);



// Initialize database connection
async function getDb() {
  return open({
    filename: dbPath,
    driver: sqlite3.Database
  });
}

// Initialize database schema with a single table
async function initializeDb() {
  // Ensure the directory exists
  const dbDir = path.dirname(dbPath);
  try {
    await fs.mkdir(dbDir, { recursive: true });
    console.log('Ensured database directory exists at:', dbDir);
  } catch (error) {
    console.log('Directory creation error (may already exist):', error.message);
  }

  const db = await getDb();
  
  // Create a single table with all fields
  await db.exec(`
    CREATE TABLE IF NOT EXISTS laptop_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_id TEXT,
      mac_address TEXT,
      serial_number TEXT,
      username TEXT,
      total_active_time INTEGER,
      latitude REAL,
      longitude REAL,
      location_name TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Get the previous total active time if it exists
  try {
    const lastRecord = await db.get(
      'SELECT total_active_time FROM laptop_metrics WHERE system_id = ? ORDER BY id DESC LIMIT 1',
      [systemId]
    );
    
    if (lastRecord && lastRecord.total_active_time) {
      totalActiveTime = lastRecord.total_active_time;
      console.log(`Loaded previous total active time: ${formatDuration(totalActiveTime * 1000)}`);
    }
  } catch (error) {
    console.log('No previous active time found, starting from 0');
  }
  
  await db.close();
  console.log('Database initialized successfully at:', dbPath);
}

// Get MAC address
async function getMacAddress() {
  try {
    const networkInterfaces = os.networkInterfaces();
    // Find the first non-internal MAC address
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

// Improved serial number detection with multiple fallback methods
async function getSerialNumber() {
  try {
    // First attempt: WMIC BIOS
    try {
      const { stdout: biosOutput } = await execAsync('wmic bios get serialnumber', { timeout: 5000 });
      const serialLines = biosOutput.split('\n').map(line => line.trim());
      // Filter out empty lines and the header "SerialNumber"
      const serialNumber = serialLines.find(line => line && line !== 'SerialNumber');
      if (serialNumber && serialNumber !== 'To be filled by O.E.M.' && serialNumber !== 'Default string') {
        console.log('Serial number found via WMIC BIOS');
        return serialNumber;
      }
    } catch (error) {
      console.log('WMIC BIOS method failed:', error.message);
    }

    // Second attempt: WMIC CSPRODUCT
    try {
      const { stdout: csOutput } = await execAsync('wmic csproduct get identifyingnumber', { timeout: 5000 });
      const csLines = csOutput.split('\n').map(line => line.trim());
      const csSerial = csLines.find(line => line && line !== 'IdentifyingNumber');
      if (csSerial && csSerial !== 'To be filled by O.E.M.' && csSerial !== 'Default string') {
        console.log('Serial number found via WMIC CSPRODUCT');
        return csSerial;
      }
    } catch (error) {
      console.log('WMIC CSPRODUCT method failed:', error.message);
    }

    // Third attempt: PowerShell
    try {
      const { stdout: psOutput } = await execAsync('powershell -command "(Get-WmiObject -Class Win32_BIOS).SerialNumber"', { timeout: 5000 });
      const psSerial = psOutput.trim();
      if (psSerial && psSerial !== 'To be filled by O.E.M.' && psSerial !== 'Default string') {
        console.log('Serial number found via PowerShell');
        return psSerial;
      }
    } catch (error) {
      console.log('PowerShell method failed:', error.message);
    }

    // Try registry query as a last resort (Windows only)
    try {
      const { stdout: regOutput } = await execAsync(
        'powershell -command "Get-ItemProperty -Path \\"HKLM:\\HARDWARE\\DESCRIPTION\\System\\BIOS\\" | Select-Object -ExpandProperty SerialNumber"', 
        { timeout: 5000 }
      );
      const regSerial = regOutput.trim();
      if (regSerial && regSerial !== 'To be filled by O.E.M.' && regSerial !== 'Default string') {
        console.log('Serial number found via registry query');
        return regSerial;
      }
    } catch (error) {
      console.log('Registry query method failed:', error.message);
    }

    console.log('All serial number detection methods failed');
    return 'Unknown';
  } catch (error) {
    console.error('Error in serial number detection:', error);
    return 'Unknown';
  }
}

// Get current username
function getUsername() {
  try {
    return process.env.USERNAME || process.env.USER || os.userInfo().username || 'Unknown';
  } catch (error) {
    console.error('Error getting username:', error);
    return 'Unknown';
  }
}

// Improved geolocation with multiple fallback services
async function getGeolocation() {
  // Try multiple geolocation services in sequence
  const geoServices = [
    // Service 1: ipapi.co
    async () => {
      console.log('Trying ipapi.co for geolocation...');
      const response = await axios.get('https://ipapi.co/json/', { timeout: 5000 });
      if (response.data && response.data.latitude) {
        console.log('Successfully retrieved location from ipapi.co');
        return {
          latitude: response.data.latitude,
          longitude: response.data.longitude,
          location_name: `${response.data.city || ''}, ${response.data.region || ''}, ${response.data.country_name || ''}`.trim().replace(/^, |, $/, '')
        };
      }
      throw new Error('ipapi.co data incomplete');
    },
    
    // Service 2: ip-api.com
    async () => {
      console.log('Trying ip-api.com for geolocation...');
      const response = await axios.get('http://ip-api.com/json/', { timeout: 5000 });
      if (response.data && response.data.lat) {
        console.log('Successfully retrieved location from ip-api.com');
        return {
          latitude: response.data.lat,
          longitude: response.data.lon,
          location_name: `${response.data.city || ''}, ${response.data.regionName || ''}, ${response.data.country || ''}`.trim().replace(/^, |, $/, '')
        };
      }
      throw new Error('ip-api.com data incomplete');
    },
    
    // Service 3: ipinfo.io
    async () => {
      console.log('Trying ipinfo.io for geolocation...');
      const response = await axios.get('https://ipinfo.io/json', { timeout: 5000 });
      if (response.data && response.data.loc) {
        console.log('Successfully retrieved location from ipinfo.io');
        const [lat, lon] = response.data.loc.split(',').map(coord => parseFloat(coord));
        return {
          latitude: lat,
          longitude: lon,
          location_name: `${response.data.city || ''}, ${response.data.region || ''}, ${response.data.country || ''}`.trim().replace(/^, |, $/, '')
        };
      }
      throw new Error('ipinfo.io data incomplete');
    }
  ];
  
  // Try each service in sequence
  for (const service of geoServices) {
    try {
      return await service();
    } catch (error) {
      console.log(`Geolocation service error: ${error.message}`);
      // Continue to next service on failure
    }
  }
  
  // Default fallback if all services fail
  console.error('All geolocation services failed');
  return {
    latitude: null,
    longitude: null,
    location_name: 'Location Unknown'
  };
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

async function collectMetrics() {
  const currentTime = Date.now();
  const sessionDuration = currentTime - sessionStartTime;
  const sessionSeconds = Math.floor(sessionDuration / 1000);
  
  // Update total active time
  totalActiveTime += sessionSeconds;
  
  console.log('Collecting system metrics...');
  
  // Collect all metrics in parallel for efficiency
  const [macAddress, serialNumber, geolocation] = await Promise.all([
    getMacAddress(),
    getSerialNumber(),
    getGeolocation()
  ]);
  
  const username = getUsername();
  
  console.log('System metrics collected:');
  console.log(`- MAC Address: ${macAddress}`);
  console.log(`- Serial Number: ${serialNumber}`);
  console.log(`- Username: ${username}`);
  console.log(`- Location: ${geolocation.location_name} (${geolocation.latitude}, ${geolocation.longitude})`);
  console.log(`- Total Active Time: ${formatDuration(totalActiveTime * 1000)} (${totalActiveTime}s)`);
  
  return {
    system_id: systemId,
    mac_address: macAddress,
    serial_number: serialNumber,
    username: username,
    total_active_time: totalActiveTime,
    latitude: geolocation.latitude,
    longitude: geolocation.longitude,
    location_name: geolocation.location_name,
    timestamp: new Date().toISOString()
  };
}

async function sendMetrics(retryCount = 0) {
  try {
    const metrics = await collectMetrics();
    const db = await getDb();
    
    console.log('Saving metrics to database...');
    
    // Insert all metrics in a single table, excluding active_time and total_seconds
    await db.run(
      `INSERT INTO laptop_metrics (
         system_id, mac_address, serial_number, username, 
         total_active_time, latitude, longitude, location_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metrics.system_id,
        metrics.mac_address,
        metrics.serial_number,
        metrics.username,
        metrics.total_active_time,
        metrics.latitude,
        metrics.longitude,
        metrics.location_name
      ]
    );
    
    console.log('Metrics saved to SQLite database successfully');
    
    await db.close();
    return true;
  } catch (error) {
    console.error('Error saving metrics to database:', error.message);
    if (retryCount < 3) {
      const retryDelay = 2000 * Math.pow(2, retryCount);
      console.log(`Retrying in ${retryDelay/1000} seconds...`);
      return new Promise(resolve => {
        setTimeout(() => {
          resolve(sendMetrics(retryCount + 1));
        }, retryDelay);
      });
    }
    return false;
  }
}

// Function to retrieve metrics history
async function getMetricsHistory(limit = 10) {
  try {
    const db = await getDb();
    
    const metrics = await db.all(`
      SELECT *
      FROM laptop_metrics
      ORDER BY timestamp DESC
      LIMIT ?
    `, [limit]);
    
    // Format total_active_time for readability
    metrics.forEach(metric => {
      metric.formatted_total_time = formatDuration(metric.total_active_time * 1000);
    });
    
    await db.close();
    return metrics;
  } catch (error) {
    console.error('Error retrieving metrics history:', error);
    return [];
  }
}

// Function for final metrics when shutting down
async function sendFinalMetrics() {
  console.log('Sending final metrics before shutdown...');
  return sendMetrics();
}

module.exports = {
  sendMetrics,
  sendFinalMetrics,
  getMetricsHistory,
  initializeDb,
  systemId
};