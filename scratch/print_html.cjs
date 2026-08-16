const https = require('https');

https.get('https://med-royale.vercel.app', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('HTML from https://med-royale.vercel.app:\n', data);
  });
});
