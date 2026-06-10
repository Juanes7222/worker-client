const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'ui', 'index.html');
const dest = path.join(__dirname, '..', 'dist-electron', 'ui', 'index.html');

// Ensure dist-electron/ui directory exists
const destDir = path.dirname(dest);
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Copy the file
fs.copyFileSync(src, dest);
console.log(`Copied ${src} -> ${dest}`);
