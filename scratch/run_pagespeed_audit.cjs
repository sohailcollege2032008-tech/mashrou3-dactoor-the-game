const https = require('https');
const fs = require('fs');
const path = require('path');

async function fetchPageSpeed(strategy = 'mobile') {
  const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://med-royale.vercel.app&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo`;
  console.log(`Running Chrome DevTools Lighthouse Audit via Google PageSpeed Insights (${strategy.toUpperCase()})...`);
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`API returned status ${res.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function summarizeAudit(data, strategy) {
  const lighthouse = data.lighthouseResult;
  const categories = lighthouse.categories;
  const audits = lighthouse.audits;

  console.log(`\n================================================================`);
  console.log(`📊 LIGHTHOUSE AUDIT RESULTS — ${strategy.toUpperCase()} (${lighthouse.configSettings.formFactor})`);
  console.log(`================================================================`);
  console.log(`Performance Score:     ${Math.round((categories.performance?.score || 0) * 100)} / 100`);
  console.log(`Accessibility Score:   ${Math.round((categories.accessibility?.score || 0) * 100)} / 100`);
  console.log(`Best Practices Score:  ${Math.round((categories['best-practices']?.score || 0) * 100)} / 100`);
  console.log(`SEO Score:             ${Math.round((categories.seo?.score || 0) * 100)} / 100`);

  console.log(`\n⏱️ CORE WEB VITALS & METRICS:`);
  console.log(`- First Contentful Paint (FCP):  ${audits['first-contentful-paint']?.displayValue} (${audits['first-contentful-paint']?.score})`);
  console.log(`- Largest Contentful Paint (LCP): ${audits['largest-contentful-paint']?.displayValue} (${audits['largest-contentful-paint']?.score})`);
  console.log(`- Total Blocking Time (TBT):     ${audits['total-blocking-time']?.displayValue} (${audits['total-blocking-time']?.score})`);
  console.log(`- Cumulative Layout Shift (CLS): ${audits['cumulative-layout-shift']?.displayValue} (${audits['cumulative-layout-shift']?.score})`);
  console.log(`- Speed Index:                   ${audits['speed-index']?.displayValue} (${audits['speed-index']?.score})`);
  console.log(`- Server Response Time (TTFB):   ${audits['server-response-time']?.displayValue} (${audits['server-response-time']?.score})`);

  console.log(`\n⚠️ TOP PERFORMANCE BOTTLENECKS & OPPORTUNITIES:`);
  const opportunityAudits = [
    'render-blocking-resources',
    'unused-javascript',
    'unminified-javascript',
    'total-byte-weight',
    'uses-long-cache-ttl',
    'efficient-animated-content',
    'modern-image-formats',
    'uses-responsive-images',
    'font-display',
    'duplicated-javascript',
    'mainthread-work-breakdown',
    'bootup-time',
    'network-rtt',
    'network-server-latency'
  ];

  for (const key of opportunityAudits) {
    const a = audits[key];
    if (!a) continue;
    if (a.score !== null && a.score < 1) {
      console.log(`\n[!] ${a.title} (Score: ${a.score})`);
      if (a.displayValue) console.log(`    Impact: ${a.displayValue}`);
      if (a.explanation) console.log(`    Explanation: ${a.explanation}`);
      if (a.details?.items?.length) {
        console.log(`    Details:`);
        a.details.items.slice(0, 5).forEach((item, idx) => {
          const url = item.url ? item.url.split('/').pop() : '';
          const wasted = item.wastedBytes ? `${(item.wastedBytes / 1024).toFixed(1)} KB wasted` : '';
          const wastedMs = item.wastedMs ? `${item.wastedMs} ms wasted` : '';
          const size = item.totalBytes ? `${(item.totalBytes / 1024).toFixed(1)} KB total` : '';
          console.log(`      ${idx + 1}. ${item.url || item.groupLabel || item.source || JSON.stringify(item)} | ${[size, wasted, wastedMs].filter(Boolean).join(' | ')}`);
        });
      }
    }
  }

  return {
    strategy,
    performanceScore: Math.round((categories.performance?.score || 0) * 100),
    fcp: audits['first-contentful-paint']?.displayValue,
    lcp: audits['largest-contentful-paint']?.displayValue,
    tbt: audits['total-blocking-time']?.displayValue,
    cls: audits['cumulative-layout-shift']?.displayValue,
    speedIndex: audits['speed-index']?.displayValue,
    rawAudits: audits
  };
}

async function main() {
  try {
    const mobileData = await fetchPageSpeed('mobile');
    const mobileSummary = summarizeAudit(mobileData, 'mobile');
    
    const desktopData = await fetchPageSpeed('desktop');
    const desktopSummary = summarizeAudit(desktopData, 'desktop');

    fs.writeFileSync(
      path.join(__dirname, 'audit_results.json'),
      JSON.stringify({ mobile: mobileSummary, desktop: desktopSummary }, null, 2)
    );
    console.log('\nAudit complete! Saved detailed results to scratch/audit_results.json');
  } catch (err) {
    console.error('Audit failed:', err);
  }
}

main();
