#!/usr/bin/env node
'use strict';

// PostToolUse hook on Edit|Write. Defends R6 (docs/rules/business-invariants.md): money is
// integer cents everywhere; only the frontend and email templates divide by 100.
//
// parseFloat/Decimal/.toFixed(2) are the *intuitively correct* choice for money in most
// frameworks, which is exactly why this project's deliberate deviation is the one most likely
// to be silently undone by an unreflective edit. This hook can't undo the edit (the file is
// already written by the time PostToolUse fires) — it makes the mistake impossible to miss,
// not impossible to write.

const fs = require('node:fs');
const path = require('node:path');

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const filePath =
    (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || '';
  if (!filePath || !filePath.endsWith('.ts')) process.exit(0);

  const normalized = filePath.split(path.sep).join('/');
  if (!normalized.includes('/src/')) process.exit(0);
  if (/node_modules|generated|template|email/i.test(normalized)) process.exit(0);

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    process.exit(0);
  }

  const PATTERNS = [
    {
      re: /\bparseFloat\s*\(/,
      why: 'parseFloat() parses a fraction — money is integer cents (R6)',
    },
    {
      re: /\bDecimal\b/,
      why: '"Decimal" as a money type — money is integer cents, not Prisma.Decimal (R6)',
    },
    {
      re: /\.toFixed\(\s*2\s*\)/,
      why: '.toFixed(2) formats money for display — that belongs to the frontend/email templates only, never the API (R6)',
    },
    {
      re: /(price|total|subtotal|discount|amount|unit_?price)\w*Cents\s*[:=]\s*\d+\.\d+/i,
      why: 'a *Cents field assigned a fractional literal — cents are always a whole number',
    },
  ];

  const hits = [];
  content.split('\n').forEach((line, idx) => {
    for (const { re, why } of PATTERNS) {
      if (re.test(line)) {
        hits.push(`  ${filePath}:${idx + 1}: ${line.trim()}\n    -> ${why}`);
      }
    }
  });

  if (hits.length === 0) process.exit(0);

  process.stderr.write(
    'R6 check (docs/rules/business-invariants.md): possible float/Decimal use on a money value:\n' +
      hits.join('\n') +
      '\nMoney is integer cents end-to-end. Confirm this is intentional or fix it.\n',
  );
  process.exit(2);
});
