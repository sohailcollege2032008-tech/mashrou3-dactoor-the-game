const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, '..', 'dist', 'assets', 'index-DESpwaxe.js');
if (!fs.existsSync(jsPath)) {
  console.log('File not found:', jsPath);
  process.exit(1);
}

const content = fs.readFileSync(jsPath, 'utf-8');
console.log('Total JS file size (uncompressed):', (content.length / 1024).toFixed(2), 'KB');

// Check presence of major libraries
const libs = [
  'firebase/auth',
  'firebase/firestore',
  'firebase/database',
  'firebase/storage',
  'framer-motion',
  'html2canvas',
  'canvas-confetti',
  'lucide-react',
  'react-router',
  'zustand'
];

for (const lib of libs) {
  const count = (content.match(new RegExp(lib.replace('/', '\\/'), 'gi')) || []).length;
  console.log(`- Mentions of "${lib}": ${count}`);
}

// Let's also check html2canvas size contribution
const h2cMarkers = ['html2canvas', 'cloneNode', 'CanvasRenderer', 'ForeignObjectRenderer'];
console.log('html2canvas markers found:', h2cMarkers.filter(m => content.includes(m)));
