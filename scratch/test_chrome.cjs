const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9222;
const TARGET_URL = "https://med-royale.vercel.app";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Simple minimal WebSocket client using node's built-in or basic TCP if ws not available
// Let's check if ws is installed or create a tiny WebSocket client
class TinyCDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.events = [];
    this.ws = null;
  }

  async connect() {
    // Check if ws module is available, otherwise require('ws')
    let WebSocket;
    try {
      WebSocket = require('ws');
    } catch {
      // If ws is not in node_modules, we can use child_process or standard node
    }
    if (!WebSocket) {
      throw new Error('ws module not available');
    }
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        } else if (msg.method) {
          this.events.push(msg);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runDevToolsAudit() {
  console.log('Starting Google Chrome Headless instance...');
  const userDataDir = path.join(__dirname, 'chrome_profile_' + Date.now());
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-gpu',
    'about:blank'
  ]);

  try {
    // Wait for Chrome CDP port to be ready
    let targets = null;
    for (let i = 0; i < 30; i++) {
      try {
        targets = await httpGetJson(`http://localhost:${PORT}/json`);
        if (targets && targets.length > 0) break;
      } catch (_) {}
      await sleep(200);
    }

    if (!targets || targets.length === 0) {
      throw new Error('Chrome remote debugging did not respond in time');
    }

    console.log('Connected to Chrome DevTools port!');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const wsUrl = pageTarget.webSocketDebuggerUrl;

    let WebSocketModule;
    try {
      WebSocketModule = require('ws');
    } catch {
      console.log('ws package not found in node_modules, checking global or local...');
    }

    if (!WebSocketModule) {
      console.log('Installing lightweight ws temporarily or using node script...');
    }

  } finally {
    chromeProcess.kill('SIGKILL');
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}
