#!/usr/bin/env node
'use strict';

// PostToolUse hook on Edit/Write. Runs Prettier's programmatic API over the single file just
// touched, so formatting noise never reaches a diff. Uses the API (not `npx prettier`) so it
// never has to shell out — a path containing a space breaks unquoted shell invocation on
// Windows, which is exactly what happened during this hook's own dev/test loop.

const fs = require('node:fs');
const path = require('node:path');

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', async () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const filePath =
    (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) ||
    '';
  if (!filePath || !fs.existsSync(filePath)) process.exit(0);

  const ext = path.extname(filePath).toLowerCase();
  const FORMATTABLE = new Set([
    '.ts',
    '.js',
    '.cjs',
    '.mjs',
    '.json',
    '.md',
    '.yml',
    '.yaml',
  ]);
  if (!FORMATTABLE.has(ext)) process.exit(0);

  const EXCLUDED = [
    `${path.sep}node_modules${path.sep}`,
    `${path.sep}dist${path.sep}`,
    `${path.sep}generated${path.sep}`,
  ];
  if (EXCLUDED.some((frag) => filePath.includes(frag))) process.exit(0);

  try {
    const prettier = require('prettier');
    const source = fs.readFileSync(filePath, 'utf8');
    const options = (await prettier.resolveConfig(filePath)) || {};
    const formatted = await prettier.format(source, {
      ...options,
      filepath: filePath,
    });
    if (formatted !== source) fs.writeFileSync(filePath, formatted);
  } catch (err) {
    process.stderr.write(
      `format-file: prettier failed on ${filePath}: ${err.message}\n`,
    );
  }

  process.exit(0);
});
