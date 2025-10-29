const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Daily rotating file
const LOG_FILE = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

function writeToFile(line) {
    try {
        const stats = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : { size: 0 };
        if (stats.size > MAX_LOG_SIZE) {
            const rotated = LOG_FILE.replace(".log", `-${Date.now()}.log`);
            fs.renameSync(LOG_FILE, rotated);
        }
        fs.appendFileSync(LOG_FILE, line + "\n");
    } catch (err) {
        // fallback if file writing fails
        process.stderr.write("[LOGGER ERROR] " + err.message + "\n");
    }
}

function format(level, args) {
    const timestamp = new Date().toISOString();
    const levelStr = level ? level.toUpperCase() : "INFO";
    const message = args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" ");
    // return JSON.stringify({ timestamp, level, message });
    return `[${timestamp}] [${levelStr}] ${message}`;

}

function centralLogger(level, ...args) {
    const logLine = format(level, args);

    // Always write to console
    if (level === "error") process.stderr.write(logLine + "\n");
    else process.stdout.write(logLine + "\n");

    // Also persist to file
    writeToFile(logLine);
}

// Hook into console methods
console.log = (...args) => centralLogger("info", ...args);
console.info = (...args) => centralLogger("info", ...args);
console.warn = (...args) => centralLogger("warn", ...args);
console.error = (...args) => centralLogger("error", ...args);
console.debug = (...args) => centralLogger("debug", ...args);

module.exports = {
    log: (...args) => centralLogger("info", ...args),
    warn: (...args) => centralLogger("warn", ...args),
    error: (...args) => centralLogger("error", ...args),
    debug: (...args) => centralLogger("debug", ...args),
    getLogFile: () => LOG_FILE
};
