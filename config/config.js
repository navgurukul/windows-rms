module.exports = {
    // Time between metrics updates (in milliseconds)
    METRICS_INTERVAL: 3000, // 1 minute
    
    // Time between server sync attempts (in milliseconds)
    SYNC_INTERVAL: 30000, // 20 minutes
    
    // API endpoints
    BACKEND_BULK_URL: 'https://windows-socket.thesama.in/api/tracking/bulk-sync',
    BACKEND_SINGLE_URL: 'https://windows-socket.thesama.in/api/tracking/sync',
    
    // JSON storage location
    JSON_FOLDER_NAME: 'SystemDataStorage',
    JSON_FILE_NAME: 'sysdata_repository.json'
  };