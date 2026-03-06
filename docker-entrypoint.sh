#!/bin/sh
set -e

# Ensure stories dir exists and is writable by appuser.
# This runs at container start (after any host bind-mounts are attached), so it can
# fix ownership of mounted volumes created by the host.
mkdir -p /app/stories
chown -R appuser:appgroup /app/stories || true

# If no command provided, run node server.js
if [ "$#" -eq 0 ]; then
  set -- node server.js
fi

# Drop privileges and exec the requested command as appuser
exec su-exec appuser "$@"