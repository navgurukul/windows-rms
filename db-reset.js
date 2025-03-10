// db-reset.js with path in user's Documents folder
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const os = require('os');

async function resetDatabase() {
  try {
    console.log('Starting database reset...');
    
    const DB_FOLDER_NAME = 'SystemDataStorage';
    const DB_FILE_NAME = 'sysdata_repository.db';

    const homeDir = os.homedir();
const dbPath = path.join(homeDir, 'Documents', DB_FOLDER_NAME, DB_FILE_NAME);
    
    // Ensure the directory exists
    const dbDir = path.dirname(dbPath);
    try {
      await fs.mkdir(dbDir, { recursive: true });
      console.log(`Ensured database directory exists at: ${dbDir}`);
    } catch (error) {
      console.log('Directory creation error (may already exist):', error.message);
    }
    
    console.log(`Working with database at: ${dbPath}`);
    
    // First try to open and reset existing database
    try {
      const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });
      
      // Drop existing table if it exists
      console.log('Dropping existing table if it exists...');
      await db.exec('DROP TABLE IF EXISTS laptop_metrics');
      
      // Create the single table with simplified fields
      console.log('Creating new table structure...');
      await db.exec(`
        CREATE TABLE laptop_metrics (
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
      
      console.log('Successfully reset database table structure');
      await db.close();
      
    } catch (error) {
      console.error('Error with existing database, trying to recreate:', error);
      
      // If opening fails, try to delete the file and create new
      try {
        await fs.unlink(dbPath);
        console.log(`Deleted database file: ${dbPath}`);
      } catch (unlinkError) {
        console.log(`Note: Could not delete ${dbPath} (may not exist)`);
      }
      
      // Create fresh database
      const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });
      
      // Create the single table
      await db.exec(`
        CREATE TABLE laptop_metrics (
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
      
      console.log('Successfully created new database with table structure');
      await db.close();
    }
    
  } catch (error) {
    console.error('Error during database reset:', error);
  }
}

// Execute the reset
resetDatabase()
  .then(() => {
    const homeDir = os.homedir();
    const dbDir = path.join(homeDir, 'Documents', 'Windows_Tracking');
    console.log(`Database reset complete! Database is now in ${dbDir}`);
  })
  .catch(err => console.error('Failed to reset database:', err));