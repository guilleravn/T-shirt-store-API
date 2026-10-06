#!/usr/bin/env bash
# Resolves the scope every skill in this directory needs: a bare file list, nothing else. No
# argument means staged changes (the default every skill here uses); one argument is a
# commit/range/branch to diff against instead. `set -e` plus the stderr redirect below means a
# bad ref aborts this script (and, injected into a skill, the whole invocation) rather than
# silently printing nothing and reading as "no files changed."
set -euo pipefail

if [ -n "${1-}" ]; then
  git diff --name-only "$1" 2>/dev/null
else
  git diff --cached --name-only 2>/dev/null
fi
