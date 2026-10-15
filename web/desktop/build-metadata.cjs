'use strict';
// Build-time only. Player machines never invoke Git or npm.
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: __dirname }).trim();
const source = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', cwd: __dirname }).trim();
const branch = process.env.FLAGHACK_CHANNEL === 'stable' ? 'main' : process.env.FLAGHACK_CHANNEL === 'iteration' ? 'iteration' : source;
if (!/^[a-f0-9]{40}$/.test(commit) || !['main', 'iteration'].includes(branch)) throw new Error('Build requires a verified main or iteration source identity');
writeFileSync(join(__dirname, 'bundled-game.json'), JSON.stringify({ schema: 1, runtimeApi: 1, branch, commit }, null, 2) + '\n');
