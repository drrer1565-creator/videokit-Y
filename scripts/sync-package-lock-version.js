const fs = require('fs');

const packagePath = 'package.json';
const lockPath = 'package-lock.json';

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

let changed = false;
if (lock.version !== pkg.version) {
  lock.version = pkg.version;
  changed = true;
}
if (lock.packages && lock.packages[''] && lock.packages[''].version !== pkg.version) {
  lock.packages[''].version = pkg.version;
  changed = true;
}

if (changed) {
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  console.log(`[version-sync] package-lock.json version -> ${pkg.version}`);
} else {
  console.log(`[version-sync] package-lock.json already matches ${pkg.version}`);
}
