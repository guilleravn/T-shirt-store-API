#!/usr/bin/env node
'use strict';

// PreToolUse hook on Bash. Denies `git push` (any form) and `gh pr create` (needs a pushed
// branch) unconditionally — no override, no escape hatch. See CLAUDE.md, "Never push".
//
// Segments the command on shell control operators so a command is only flagged when git/gh is
// the actual program being invoked with push/pr-create as its subcommand — not when "push"
// merely appears elsewhere (`git log --grep=push`, a file named push.ts, a commit message that
// mentions push).

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const command = (data.tool_input && data.tool_input.command) || '';
  const segments = command
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);

  function isGitPush(segment) {
    const tokens = segment.split(/\s+/);
    if (tokens[0] !== 'git') return false;
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith('-')) i++;
    return tokens[i] === 'push';
  }

  function isGhPrCreate(segment) {
    const tokens = segment.split(/\s+/);
    return tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'create';
  }

  const blocked = segments.find((s) => isGitPush(s) || isGhPrCreate(s));

  if (blocked) {
    process.stderr.write(
      `Blocked: "${blocked}" pushes, or opens a PR from a pushed branch.\n` +
        'This repo never pushes from an agent session (CLAUDE.md, "Never push").\n' +
        'The commit is ready locally; the developer reviews the diff and pushes it themselves.\n',
    );
    process.exit(2);
  }

  process.exit(0);
});
