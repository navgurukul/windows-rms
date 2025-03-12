// check-json.js
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const JSON_FOLDER_NAME = 'SystemDataStorage';
const JSON_FILE_NAME = 'sysdata_repository.json';

const homeDir = os.homedir();
const jsonPath = path.join(homeDir, 'Documents', JSON_FOLDER_NAME, JSON_FILE_NAME);

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

async function checkJsonData() {
  try {
    console.log(`Reading JSON data from: ${jsonPath}`);
    
    // Read the file
    const data = await fs.readFile(jsonPath, 'utf8');
    const jsonData = JSON.parse(data);
    
    console.log(`\nTotal records: ${jsonData.records.length}`);
    
    if (jsonData.records.length > 0) {
      // Sort by timestamp (newest first)
      jsonData.records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Display the most recent 5 records
      console.log('\nMost recent records:');
      jsonData.records.slice(0, 5).forEach((record, index) => {
        console.log(`\nRecord #${index + 1}:`);
        console.log(`System ID: ${record.system_id}`);
        console.log(`Serial Number: ${record.serial_number}`);
        console.log(`MAC Address: ${record.mac_address}`);
        console.log(`Username: ${record.username}`);
        console.log(`Total Active Time: ${formatDuration(record.total_active_time)}`);
        console.log(`Location: ${record.location_name}`);
        console.log(`Coordinates: ${record.latitude}, ${record.longitude}`);
        console.log(`Timestamp: ${record.timestamp}`);
      });
    } else {
      console.log('\nNo records found in the JSON file.');
    }
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`JSON file not found at: ${jsonPath}`);
    } else {
      console.error('Error checking JSON data:', error);
    }
  }
}

// Execute the check
checkJsonData()
  .then(() => console.log('\nJSON data check complete'))
  .catch(err => console.error('JSON data check failed:', err));