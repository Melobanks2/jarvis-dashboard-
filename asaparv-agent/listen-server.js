/**
 * listen-server.js — Node wrapper that starts listen_server.py (Whisper STT on port 3003)
 * PM2 manages this process; Python server does the actual work.
 */
const { spawn } = require("child_process");
const path = require("path");

const python = spawn(
  "python3.11",
  [path.join(__dirname, "listen_server.py")],
  { stdio: "inherit" }
);

python.on("error", (err) => {
  console.error("[listen-server] Failed to start Python server:", err.message);
  process.exit(1);
});

python.on("exit", (code) => {
  console.log(`[listen-server] Python process exited with code ${code}`);
  process.exit(code || 0);
});

process.on("SIGINT",  () => python.kill("SIGINT"));
process.on("SIGTERM", () => python.kill("SIGTERM"));
