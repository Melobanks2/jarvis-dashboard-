/**
 * voice-server.js — Node wrapper that starts voice_server.py (Chatterbox TTS on port 3002)
 * PM2 manages this process; Python server does the actual work.
 */
const { spawn } = require("child_process");
const path = require("path");

const python = spawn(
  "python3.11",
  [path.join(__dirname, "voice_server.py")],
  { stdio: "inherit" }
);

python.on("error", (err) => {
  console.error("[voice-server] Failed to start Python server:", err.message);
  process.exit(1);
});

python.on("exit", (code) => {
  console.log(`[voice-server] Python process exited with code ${code}`);
  process.exit(code || 0);
});

// Forward signals so PM2 can cleanly stop the Python process
process.on("SIGINT",  () => python.kill("SIGINT"));
process.on("SIGTERM", () => python.kill("SIGTERM"));
