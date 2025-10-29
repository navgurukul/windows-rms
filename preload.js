const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const logContainer = document.getElementById('log-container');

  ipcRenderer.on('log-message', (_, { level, message }) => {
    const logEntry = document.createElement('div');
    logEntry.classList.add('log-entry');

    const time = new Date().toLocaleTimeString();
    const timeSpan = document.createElement('span');
    timeSpan.classList.add('log-time');
    timeSpan.textContent = `[${time}]`;

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;

    if (level === 'error') messageSpan.classList.add('log-error');
    else if (level === 'warn') messageSpan.classList.add('log-warn');
    else messageSpan.classList.add('log-info');

    logEntry.appendChild(timeSpan);
    logEntry.appendChild(messageSpan);
    logContainer.appendChild(logEntry);

    // Auto-scroll to latest log
    logContainer.scrollTop = logContainer.scrollHeight;
  });
});

contextBridge.exposeInMainWorld('electronLogs', {
  ping: () => console.log('Preload loaded ✅'),
});
