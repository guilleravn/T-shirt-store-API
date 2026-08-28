#!/usr/bin/env node
'use strict';

// Runs as the git commit-msg hook (.husky/commit-msg). Not a Claude Code hook — this fires for
// anyone who commits, with or without a model involved. See docs/conventions/git-workflow.md
// for the Conventional Commits convention and CLAUDE.md for the no-attribution rule.

const fs = require('node:fs');

const msgFile = process.argv[2];
if (!msgFile) {
  console.error('validate-commit-msg: no commit message file given.');
  process.exit(1);
}

const message = fs.readFileSync(msgFile, 'utf8');
const subject = message.split('\n')[0];

// type(scope): description — type list matches docs/conventions/git-workflow.md's examples.
const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9.-]+\))?(!)?: .+/;

if (!CONVENTIONAL_COMMIT_RE.test(subject)) {
  console.error(
    'commit-msg: subject line does not follow Conventional Commits.\n' +
      '  Expected: type(scope): description\n' +
      '  type is one of feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert\n' +
      '  Got: ' + JSON.stringify(subject) + '\n' +
      '  See docs/conventions/git-workflow.md.',
  );
  process.exit(1);
}

const ATTRIBUTION_RE = /Co-Authored-By:|Generated with/i;
if (ATTRIBUTION_RE.test(message)) {
  console.error(
    'commit-msg: commit message carries tooling attribution (Co-Authored-By / Generated with).\n' +
      '  This repo never adds tooling attribution to commits. Remove it and retry.\n' +
      '  See CLAUDE.md.',
  );
  process.exit(1);
}

process.exit(0);
