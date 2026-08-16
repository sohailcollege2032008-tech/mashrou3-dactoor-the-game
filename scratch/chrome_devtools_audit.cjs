const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
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

async function runSingleAudit(profileName, { throttleNetwork, throttleCpu, viewport }) {
  console.log(`\n================================================================`);
  console.log(`🚀 STARTING CHROME DEVTOOLS AUDIT: [${profileName.toUpperCase()}]`);
  console.log(`================================================================`);

  const userDataDir = path.join(__dirname, 'chrome_session_' + Date.now());
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
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
        targets = await httpGetJson(`http://localhost:${PORT}/json`);
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

    // Enable DevTools Domains
    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('Runtime.enable');
    await client.send('Performance.enable');
    await client.send('DOM.enable');

    // Emulate Viewport
    if (viewport) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
        mobile: viewport.mobile || false
      });
    }

    // CPU Throttling
    if (throttleCpu) {
      await client.send('Emulation.setCPUThrottlingRate', { rate: throttleCpu });
      console.log(`⚙️ CPU Throttling applied: ${throttleCpu}x slowdown`);
    }

    // Network Throttling (e.g. Fast 3G / 4G)
    if (throttleNetwork) {
      // 4G: 4 Mbps download, 3 Mbps upload, 20ms latency
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: throttleNetwork.latency || 40,
        downloadThroughput: throttleNetwork.downloadThroughput || (4 * 1024 * 1024 / 8),
        uploadThroughput: throttleNetwork.uploadThroughput || (3 * 1024 * 1024 / 8),
        connectionType: 'cellular4g'
      });
      console.log(`📶 Network Throttling applied: 4G simulation (Latency: ${throttleNetwork.latency}ms)`);
    }

    // Track network events
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
        req.headers = params.response.headers;
        req.fromDiskCache = params.response.fromDiskCache;
        req.fromServiceWorker = params.response.fromServiceWorker;
        req.timing = params.response.timing;
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

    // Wait for loadEventFired + additional idle time
    await new Promise((resolve) => {
      client.on('Page.loadEventFired', () => {
        setTimeout(resolve, 3000); // give 3s for hydration & post-load renders
      });
    });

    const totalNavDuration = Date.now() - navStartTime;

    // Fetch Performance Metrics
    const perfMetricsRes = await client.send('Performance.getMetrics');
    const metricsMap = {};
    perfMetricsRes.metrics.forEach(m => {
      metricsMap[m.name] = m.value;
    });

    // Evaluate Navigation Timing API inside page
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

    console.log(`\n📊 PERFORMANCE AUDIT SUMMARY [${profileName.toUpperCase()}]:`);
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
    console.log(`• Layout Count:                ${metricsMap['LayoutCount'] || 0}`);
    console.log(`• Style Recalc Count:          ${metricsMap['RecalcStyleCount'] || 0}`);

    console.log(`\n🌐 NETWORK WATERFALL & ASSET BREAKDOWN:`);
    console.log(`----------------------------------------------------------------`);
    let totalBytesTransferred = 0;
    let totalRequests = 0;

    const requestList = Array.from(networkRequests.values());
    requestList.forEach(r => {
      totalRequests++;
      const size = r.encodedDataLength || 0;
      totalBytesTransferred += size;
      const urlShort = r.url.length > 80 ? r.url.slice(0, 77) + '...' : r.url;
      const durationMs = r.finishTime && r.startTime ? Math.round((r.finishTime - r.startTime) * 1000) : 'N/A';
      console.log(`[${r.status || '---'}] [${r.type || 'Other'}] ${(size / 1024).toFixed(1).padStart(6)} KB | ${String(durationMs).padStart(5)} ms | ${urlShort}`);
    });

    console.log(`----------------------------------------------------------------`);
    console.log(`TOTAL NETWORK: ${totalRequests} Requests | ${(totalBytesTransferred / 1024).toFixed(2)} KB Transferred (${(totalBytesTransferred / (1024 * 1024)).toFixed(2)} MB)`);

    if (consoleLogs.length > 0) {
      console.log(`\n⚠️ CONSOLE LOGS / ERRORS:`);
      consoleLogs.forEach(c => console.log(`  [${c.type}] ${c.text}`));
    }

    client.close();
    return {
      profileName,
      pageTimings,
      metricsMap,
      totalBytesTransferred,
      requestList,
      consoleLogs
    };
  } finally {
    chromeProcess.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function main() {
  console.log('🚀 INITIALIZING CHROME DEVTOOLS PROTOCOL AUDIT HARNESS');

  // Test 1: Desktop Fast Connection (Unthrottled baseline)
  await runSingleAudit('Desktop High-Speed', {
    viewport: { width: 1440, height: 900, mobile: false },
    throttleCpu: null,
    throttleNetwork: null
  });

  await sleep(1000);

  // Test 2: Mobile 4G with 4x CPU Throttling (Realistic Medical Student Mobile Environment)
  await runSingleAudit('Mobile 4G (4x CPU Throttling)', {
    viewport: { width: 393, height: 852, mobile: true, deviceScaleFactor: 3 },
    throttleCpu: 4,
    throttleNetwork: { latency: 50, downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }
  });

  console.log('\n✅ ALL CHROME DEVTOOLS AUDITS COMPLETED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
