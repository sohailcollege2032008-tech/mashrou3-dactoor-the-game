const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9444;
const PREVIEW_PORT = 4173;
const TARGET_URL = `http://localhost:${PREVIEW_PORT}`;
const DIST_DIR = path.join(__dirname, '..', 'dist');

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

function createStaticServer(port) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    
    let filePath = path.join(DIST_DIR, reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    // Add Vercel-like caching headers
    if (reqPath.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }

    res.setHeader('Content-Type', contentType);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

class ChromeDevToolsClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
    this.ws = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new globalThis.WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else cb.resolve(msg.result);
        } else if (msg.method) {
          const listeners = this.eventListeners.get(msg.method) || [];
          listeners.forEach(fn => fn(msg.params));
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  on(method, callback) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method).push(callback);
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

async function runBenchmark(profileName, { throttleNetwork, throttleCpu, viewport }) {
  console.log(`\n================================================================`);
  console.log(`⚡ BENCHMARKING OPTIMIZED BUILD: [${profileName.toUpperCase()}]`);
  console.log(`================================================================`);

  const userDataDir = path.join(__dirname, 'chrome_bench_' + Date.now());
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--disable-gpu',
    'about:blank'
  ]);

  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try {
        targets = await httpGetJson(`http://localhost:${CDP_PORT}/json`);
        if (targets && targets.length > 0) break;
      } catch (_) {}
      await sleep(150);
    }

    if (!targets || targets.length === 0) {
      throw new Error('Chrome did not respond on debug port');
    }

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const client = new ChromeDevToolsClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('Runtime.enable');
    await client.send('Performance.enable');
    await client.send('DOM.enable');

    if (viewport) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
        mobile: viewport.mobile || false
      });
    }

    if (throttleCpu) {
      await client.send('Emulation.setCPUThrottlingRate', { rate: throttleCpu });
      console.log(`⚙️ CPU Throttling applied: ${throttleCpu}x slowdown`);
    }

    if (throttleNetwork) {
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: throttleNetwork.latency || 50,
        downloadThroughput: throttleNetwork.downloadThroughput || (1.5 * 1024 * 1024 / 8),
        uploadThroughput: throttleNetwork.uploadThroughput || (750 * 1024 / 8),
        connectionType: 'cellular4g'
      });
      console.log(`📶 Network Throttling applied: 4G simulation (Latency: ${throttleNetwork.latency}ms)`);
    }

    const networkRequests = new Map();
    const consoleLogs = [];

    client.on('Network.requestWillBeSent', (params) => {
      networkRequests.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        type: params.type,
        startTime: params.timestamp,
        wallTime: params.wallTime
      });
    });

    client.on('Network.responseReceived', (params) => {
      const req = networkRequests.get(params.requestId);
      if (req) {
        req.status = params.response.status;
        req.mimeType = params.response.mimeType;
        req.encodedDataLength = params.response.encodedDataLength;
      }
    });

    client.on('Network.loadingFinished', (params) => {
      const req = networkRequests.get(params.requestId);
      if (req) {
        req.encodedDataLength = params.encodedDataLength;
        req.finishTime = params.timestamp;
      }
    });

    client.on('Runtime.consoleAPICalled', (params) => {
      consoleLogs.push({
        type: params.type,
        text: params.args.map(a => a.value || a.description || '').join(' ')
      });
    });

    console.log(`Navigating to ${TARGET_URL}...`);
    const navStartTime = Date.now();
    await client.send('Page.navigate', { url: TARGET_URL });

    await new Promise((resolve) => {
      client.on('Page.loadEventFired', () => {
        setTimeout(resolve, 2500);
      });
    });

    const totalNavDuration = Date.now() - navStartTime;

    const perfMetricsRes = await client.send('Performance.getMetrics');
    const metricsMap = {};
    perfMetricsRes.metrics.forEach(m => {
      metricsMap[m.name] = m.value;
    });

    const timingEval = await client.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0,
        lcp: performance.getEntriesByType('largest-contentful-paint')[0]?.startTime || 0,
        navTiming: performance.getEntriesByType('navigation')[0] || {},
        domNodes: document.querySelectorAll('*').length,
        title: document.title
      })`,
      returnByValue: true
    });

    const pageTimings = JSON.parse(timingEval.result.value || '{}');

    console.log(`\n📊 PERFORMANCE BENCHMARK RESULT [${profileName.toUpperCase()}]:`);
    console.log(`----------------------------------------------------------------`);
    console.log(`• Document Title:              ${pageTimings.title}`);
    console.log(`• Total Page Load Time:        ${totalNavDuration} ms`);
    console.log(`• First Contentful Paint (FCP): ${pageTimings.fcp ? Math.round(pageTimings.fcp) + ' ms' : 'N/A'}`);
    console.log(`• Largest Contentful Paint (LCP): ${pageTimings.lcp ? Math.round(pageTimings.lcp) + ' ms' : 'N/A'}`);
    console.log(`• DOM Content Loaded:          ${Math.round(pageTimings.navTiming.domContentLoadedEventEnd || 0)} ms`);
    console.log(`• Total DOM Elements:          ${pageTimings.domNodes} nodes`);
    console.log(`• JS Heap Used:                ${((metricsMap['JSHeapUsedSize'] || 0) / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`• JS Script Duration:          ${Math.round((metricsMap['ScriptDuration'] || 0) * 1000)} ms`);
    console.log(`• Style Recalc Duration:       ${Math.round((metricsMap['RecalcStyleDuration'] || 0) * 1000)} ms`);
    console.log(`• Layout Duration:             ${Math.round((metricsMap['LayoutDuration'] || 0) * 1000)} ms`);

    console.log(`\n🌐 INITIAL NETWORK REQUESTS:`);
    console.log(`----------------------------------------------------------------`);
    let totalBytes = 0;
    Array.from(networkRequests.values()).forEach(r => {
      const size = r.encodedDataLength || 0;
      totalBytes += size;
      const urlShort = r.url.length > 75 ? r.url.slice(0, 72) + '...' : r.url;
      const durationMs = r.finishTime && r.startTime ? Math.round((r.finishTime - r.startTime) * 1000) : 'N/A';
      console.log(`[${r.status || '---'}] [${r.type || 'Other'}] ${(size / 1024).toFixed(1).padStart(6)} KB | ${String(durationMs).padStart(5)} ms | ${urlShort}`);
    });
    console.log(`----------------------------------------------------------------`);
    console.log(`TOTAL INITIAL NETWORK: ${(totalBytes / 1024).toFixed(2)} KB (${(totalBytes / (1024 * 1024)).toFixed(2)} MB)`);

    client.close();
    return { profileName, pageTimings, metricsMap, totalBytes };
  } finally {
    chromeProcess.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function main() {
  console.log('🚀 Starting built-in static server for dist/...');
  const server = await createStaticServer(PREVIEW_PORT);
  console.log(`Server listening on http://localhost:${PREVIEW_PORT}`);

  try {
    // 1. Desktop Fast
    await runBenchmark('Optimized Desktop High-Speed', {
      viewport: { width: 1440, height: 900, mobile: false },
      throttleCpu: null,
      throttleNetwork: null
    });

    await sleep(1000);

    // 2. Mobile 4G with 4x CPU Throttling
    await runBenchmark('Optimized Mobile 4G (4x CPU Throttling)', {
      viewport: { width: 393, height: 852, mobile: true, deviceScaleFactor: 3 },
      throttleCpu: 4,
      throttleNetwork: { latency: 50, downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }
    });

  } finally {
    server.close();
    console.log('\n🏁 Benchmark run finished.');
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
