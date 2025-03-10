

// db-check.js with neutral path name and recovery capability
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

// Generic, technical-sounding name for the database and folder
const DB_FOLDER_NAME = 'SystemDataStorage';
const DB_FILE_NAME = 'sysdata_repository.db';

async function ensureDatabaseExists() {
  try {
    // Get user home directory
    const homeDir = os.homedir();
    
    // Database path with neutral technical name
    const dbDir = path.join(homeDir, 'Documents', DB_FOLDER_NAME);
    const dbPath = path.join(dbDir, DB_FILE_NAME);
    
    // Check if directory exists, if not create it
    try {
      await fs.mkdir(dbDir, { recursive: true });
      console.log(`Ensured data directory exists at: ${dbDir}`);
    } catch (error) {
      console.log('Directory already exists or could not be created');
    }
    
    // Check if database file exists, if not create it
    try {
      await fs.access(dbPath);
      // File exists
    } catch (error) {
      console.log('Database file does not exist, creating basic structure...');
      
      // Create new database with basic structure
      const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });
      
      // Create the table
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
      
      console.log('Created new database file with basic structure');
      await db.close();
    }
    
    return dbPath;
  } catch (error) {
    console.error('Error ensuring database exists:', error);
    throw error;
  }
}

async function checkDatabase() {
  try {
    console.log('Checking database contents...');
    
    // First, ensure database exists
    const dbPath = await ensureDatabaseExists();
    
    console.log(`Looking for database at: ${dbPath}`);
    
    // Open database connection
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    // Get all tables in the database
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('\nTables in database:');
    tables.forEach(table => console.log(`- ${table.name}`));
    
    // Count records in the laptop_metrics table
    const count = await db.get('SELECT COUNT(*) as count FROM laptop_metrics');
    console.log(`\nTotal records in laptop_metrics: ${count.count}`);
    
    // Get the most recent 5 records
    const records = await db.all('SELECT * FROM laptop_metrics ORDER BY timestamp DESC LIMIT 5');
    
    if (records.length > 0) {
      console.log('\nMost recent records:');
      records.forEach((record, index) => {
        console.log(`\nRecord #${index + 1} (ID: ${record.id})`);
        console.log(`System ID: ${record.system_id}`);
        console.log(`Serial Number: ${record.serial_number}`);
        console.log(`MAC Address: ${record.mac_address}`);
        console.log(`Username: ${record.username}`);
        console.log(`Total Active Time: ${formatDuration(record.total_active_time)}`);
        console.log(`Location: ${record.location_name}`);
        console.log(`Coordinates: ${record.latitude}, ${record.longitude}`);
        console.log(`Timestamp: ${record.timestamp}`);
      });
      
      // Get the last total active time
      const lastRecord = records[0];
      console.log(`\nCurrent total active time: ${formatDuration(lastRecord.total_active_time)}`);
    } else {
      console.log('\nNo records found in the database.');
    }
    
    await db.close();
    
  } catch (error) {
    console.error('Error checking database:', error);
  }
}

// Execute the check
checkDatabase()
  .then(() => console.log('\nDatabase check complete'))
  .catch(err => console.error('Database check failed:', err));