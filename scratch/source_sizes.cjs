const fs = require('fs');
const path = require('path');

// Measure size of all source files in src
function getFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getFiles(fullPath, files);
    } else {
      files.push({
        path: fullPath.replace(__dirname + path.sep + '..' + path.sep, ''),
        size: fs.statSync(fullPath).size
      });
    }
  }
  return files;
}

const srcFiles = getFiles(path.join(__dirname, '..', 'src'));
srcFiles.sort((a, b) => b.size - a.size);

console.log('--- Top 20 Largest Source Code Files ---');
srcFiles.slice(0, 20).forEach(f => {
  console.log(`${(f.size / 1024).toFixed(1)} KB - ${f.path}`);
});
