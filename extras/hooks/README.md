# Optional: Stop hook that keeps the run going

Use this only if `/goal` is not available or the run keeps stopping early.

1. Copy `keep-going.mjs` to `.claude/hooks/keep-going.mjs` in the project.
2. Add this block to `.claude/settings.json` at the top level (next to "permissions"):

```json
"hooks": {
  "Stop": [
    {
      "hooks": [
        { "type": "command", "command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/keep-going.mjs"], "timeout": 30 }
      ]
    }
  ]
}
```

3. Restart the Claude Code session so it picks up the hook.

It lets the session stop when a file named `STOP` exists in the project root, when the run token defined in CLAUDE.md is the first line under "## Now" in `docs/PROGRESS.md`, or after 10 stop attempts in a row with no progress at all (same git HEAD, same uncommitted changes, same PROGRESS.md timestamp). Normal debugging without commits does not end the run. To end the run on purpose, create the `STOP` file. If the hook ever fails to start (for example the path variable is not expanded on your setup), Claude Code treats that as a non-blocking error and the session can stop normally, so it fails safe.
