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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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
          bodyBuffer: body,
          bodyStr: body.toString('utf-8')
        });
      });
    });
    req.on('error', reject);
  });
}

async function runDetailedAudit() {
  console.log('================================================================');
  console.log('⚡ PRODUCTION AUDIT REPORT FOR https://med-royale.vercel.app');
  console.log('================================================================\n');

  const main = await fetchResource('https://med-royale.vercel.app');
  console.log(`1. DOCUMENT REQUEST (HTML)`);
  console.log(`   URL: ${main.url}`);
  console.log(`   Status: ${main.statusCode}`);
  console.log(`   TTFB: ${main.ttfb} ms`);
  console.log(`   Total Download: ${main.totalDuration} ms`);
  console.log(`   Transferred: ${(main.sizeBytes / 1024).toFixed(2)} KB (compressed with ${main.contentEncoding})`);
  console.log(`   Cache-Control: ${main.headers['cache-control'] || 'None'}`);
  console.log(`   Server/CDN: ${main.headers['server'] || 'Vercel'} (${main.headers['x-vercel-id'] || ''})`);

  // Extract all assets in HTML
  const assets = [
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter+Tight:ital,wght@0,100..900;1,100..900&family=IBM+Plex+Sans+Arabic:wght@100;200;300;400;500;600;700&family=JetBrains+Mono:wght@100..800&display=swap',
    'https://cdn.jsdelivr.net/npm/mathjax@3/es5/mml-chtml.js',
    '/assets/index-DbXSPUJf.js',
    '/assets/index-BfY6CxSB.css'
  ];

  console.log('\n2. CRITICAL ASSET NETWORK PERFORMANCE');
  console.log('----------------------------------------------------------------');

  let totalTransfer = main.sizeBytes;
  const detailedAssets = [];

  for (const asset of assets) {
    const fullUrl = asset.startsWith('http') ? asset : `https://med-royale.vercel.app${asset}`;
    const res = await fetchResource(fullUrl);
    totalTransfer += res.sizeBytes;
    detailedAssets.push({ name: asset, ...res });
    
    console.log(`\n• Asset: ${asset}`);
    console.log(`  Full URL: ${fullUrl}`);
    console.log(`  Transfer Size: ${(res.sizeBytes / 1024).toFixed(2)} KB`);
    console.log(`  TTFB: ${res.ttfb} ms | Total Time: ${res.totalDuration} ms`);
    console.log(`  Content-Type: ${res.contentType}`);
    console.log(`  Encoding: ${res.contentEncoding}`);
    console.log(`  Cache-Control: ${res.headers['cache-control'] || 'none'}`);

    // If it's a CSS file with @import or url(), or font css, check font files downloaded
    if (res.contentType.includes('text/css') && asset.includes('fonts.googleapis.com')) {
      const fontUrlMatches = [...res.bodyStr.matchAll(/url\((https:\/\/[^)]+)\)/g)];
      console.log(`  -> References ${fontUrlMatches.length} Google Font binary files (.woff2)`);
    }
  }

  console.log('\n================================================================');
  console.log(`TOTAL CRITICAL INITIAL DOWNLOAD: ${(totalTransfer / 1024).toFixed(2)} KB (${(totalTransfer / (1024 * 1024)).toFixed(2)} MB)`);
  console.log('================================================================');
}

runDetailedAudit();
