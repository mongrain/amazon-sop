'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const watchPaths = [];

for (const name of fs.readdirSync(root)) {
  if (name.endsWith('.js')) {
    watchPaths.push(name);
  } else if (name === 'routes' || name === 'orchestration') {
    watchPaths.push(name);
  }
}

for (const name of fs.readdirSync(path.join(root, 'service'))) {
  if (name === 'imagediff') continue;
  watchPaths.push(path.join('service', name));
}

const args = watchPaths.flatMap((p) => ['--watch-path', p]);
args.push('--watch-preserve-output', 'server.js');

const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
