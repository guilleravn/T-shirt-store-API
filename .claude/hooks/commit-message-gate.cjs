#!/usr/bin/env node
'use strict';

// PreToolUse hook on Bash. Turns any `git commit` call into an explicit "ask" so the developer
// sees the exact command — including the full message — before it runs, not a summary
// afterwards. See CLAUDE.md, "commit messages carry no tooling attribution" / "state the
// message and wait for approval".
//
// This does not replace never-allowlisting `git commit` (see .claude/settings.json) — it's a
// second, independent layer that also works if `git commit` is ever matched by a broader
// allowlist pattern.

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

  function isGitCommit(segment) {
    const tokens = segment.split(/\s+/);
    if (tokens[0] !== 'git') return false;
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith('-')) i++;
    return tokens[i] === 'commit';
  }

  const target = segments.find(isGitCommit);
  if (!target) process.exit(0);

  const reason =
    'About to run git commit. Full command below, including the exact message — confirm this ' +
    'is what should be committed before approving:\n\n' +
    command +
    '\n';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
});
