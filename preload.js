const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  let logContainer = document.getElementById('electron-log-container');
  if (!logContainer) {
    logContainer = document.createElement('div');
    logContainer.id = 'electron-log-container';
    logContainer.style.position = 'fixed';
    logContainer.style.bottom = '0';
    logContainer.style.left = '0';
    logContainer.style.right = '0';
    logContainer.style.maxHeight = '150px';
    logContainer.style.overflow = 'auto';
    logContainer.style.backgroundColor = 'rgba(0,0,0,0.8)';
    logContainer.style.color = 'white';
    logContainer.style.fontFamily = 'monospace';
    logContainer.style.fontSize = '12px';
    logContainer.style.padding = '5px';
    logContainer.style.zIndex = '9999';
    logContainer.style.borderTop = '1px solid #444';
    document.body.appendChild(logContainer);

    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Hide Logs';
    toggleButton.style.position = 'fixed';
    toggleButton.style.right = '5px';
    toggleButton.style.bottom = '155px';
    toggleButton.style.zIndex = '10000';
    toggleButton.style.padding = '2px 5px';
    toggleButton.style.fontSize = '10px';
    toggleButton.onclick = () => {
      if (logContainer.style.display === 'none') {
        logContainer.style.display = 'block';
        toggleButton.textContent = 'Hide Logs';
      } else {
        logContainer.style.display = 'none';
        toggleButton.textContent = 'Show Logs';
      }
    };
    document.body.appendChild(toggleButton);
  }

  // Listen for messages from main process
  ipcRenderer.on('log-message', (_, { level, message }) => {
    const logEntry = document.createElement('div');
    logEntry.textContent = message;

    if (level === 'error') logEntry.style.color = '#ff6b6b';
    else if (level === 'warn') logEntry.style.color = '#feca57';
    else logEntry.style.color = '#ffffff';

    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
  });
});

// Expose nothing unsafe, just a helper if you want later
contextBridge.exposeInMainWorld('electronLogs', {
  ping: () => console.log('Preload loaded ✅')
});
