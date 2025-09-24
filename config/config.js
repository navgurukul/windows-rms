module.exports = {
  // Time between metrics updates (in milliseconds)
  METRICS_INTERVAL: 3000, // 1 minute

  // Time between server sync attempts (in milliseconds)
  SYNC_INTERVAL: 30000, // 20 minutes

  // // API endpoints
  // BACKEND_BASE_URL: 'http://192.168.1.14:3000',
  // BACKEND_BULK_URL: 'http://192.168.1.14:3000/api/tracking/bulk-sync',
  // BACKEND_SINGLE_URL: 'http://192.168.1.14:3000/api/tracking/sync',

  // SANDBOX API endpoints --RAILWAY
  BACKEND_BASE_URL: 'https://windows-rms-server-production.up.railway.app',
  BACKEND_BULK_URL: 'https://windows-rms-server-production.up.railway.app/api/tracking/bulk-sync',
  BACKEND_SINGLE_URL: 'https://windows-rms-server-production.up.railway.app/api/tracking/sync',

  // BACKEND_BULK_URL: 'https://windows-socket.thesama.in/api/tracking/bulk-sync',
  // BACKEND_SINGLE_URL: 'https://windows-socket.thesama.in/api/tracking/sync',
  SYSTEM_DATA_FOLDER: 'C:\\System.ServiceData',
  // JSON storage location
  JSON_FOLDER_NAME: 'SystemDataStorage',
  JSON_FILE_NAME: 'sysdata_repository.json'
};