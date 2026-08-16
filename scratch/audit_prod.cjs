const https = require('https');
const http = require('http');
const { performance } = require('perf_hooks');

async function fetchResource(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Encoding': 'gzip, deflate, br',
        ...headers
      }
    }, (res) => {
      let ttfb = performance.now() - start;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const totalDuration = performance.now() - start;
        const body = Buffer.concat(chunks);
        resolve({
          url,
          statusCode: res.statusCode,
          headers: res.headers,
          ttfb: Math.round(ttfb),
          totalDuration: Math.round(totalDuration),
          sizeBytes: body.length,
          contentEncoding: res.headers['content-encoding'] || 'none',
          contentType: res.headers['content-type'] || 'unknown',
          bodyStr: body.toString('utf-8')
        });
      });
    });
    req.on('error', reject);
  });
}

async function runAudit() {
  console.log('=== AUDITING PRODUCTION: https://med-royale.vercel.app ===\n');
  const main = await fetchResource('https://med-royale.vercel.app');
  console.log(`[HTML] Status: ${main.statusCode} | TTFB: ${main.ttfb}ms | Total Time: ${main.totalDuration}ms | Transfer Size: ${(main.sizeBytes / 1024).toFixed(2)} KB | Encoding: ${main.contentEncoding}`);
  
  // Extract script tags
  const scripts = [];
  const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptRegex.exec(main.bodyStr)) !== null) {
    scripts.push(match[1]);
  }
  
  // Extract stylesheet links
  const styles = [];
  const styleRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  while ((match = styleRegex.exec(main.bodyStr)) !== null) {
    styles.push(match[1]);
  }

  // Also check module scripts or preload links
  const preloads = [];
  const preloadRegex = /<link\s+[^>]*rel=["'](?:modulepreload|preload)["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  while ((match = preloadRegex.exec(main.bodyStr)) !== null) {
    preloads.push(match[1]);
  }

  console.log('\n--- Discovered Critical Head & Body Resources ---');
  console.log('Scripts:', scripts);
  console.log('Styles:', styles);
  console.log('Preloads:', preloads);

  const allResources = [...scripts, ...styles, ...preloads];
  let totalTransferBytes = main.sizeBytes;
  
  console.log('\n--- Resource Timings & Weights ---');
  for (const relUrl of allResources) {
    const fullUrl = relUrl.startsWith('http') ? relUrl : `https://med-royale.vercel.app${relUrl}`;
    try {
      const res = await fetchResource(fullUrl);
      totalTransferBytes += res.sizeBytes;
      console.log(`- ${relUrl}`);
      console.log(`  Size: ${(res.sizeBytes / 1024).toFixed(2)} KB | TTFB: ${res.ttfb}ms | Duration: ${res.totalDuration}ms | Content-Type: ${res.contentType} | Encoding: ${res.contentEncoding}`);
      if (res.headers['cache-control']) {
        console.log(`  Cache-Control: ${res.headers['cache-control']}`);
      }
    } catch (e) {
      console.error(`  Failed to fetch ${fullUrl}:`, e.message);
    }
  }

  console.log(`\n=== Total Initial Critical Resources Download Size: ${(totalTransferBytes / 1024).toFixed(2)} KB (${(totalTransferBytes / (1024 * 1024)).toFixed(2)} MB) ===\n`);
}

runAudit();
