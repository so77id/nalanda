#!/bin/bash
# Notification hook: macOS notification when Claude needs input.
osascript -e 'display notification "Claude Code needs your input" with title "Nalanda" sound name "Ping"' 2>/dev/null
exit 0
