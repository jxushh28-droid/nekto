#!/usr/bin/env bash
cd -- "$(dirname -- "$0")" || exit 1
bash ./start-linux.sh
result=$?
if [ "$result" -eq 0 ]; then
  open 'http://127.0.0.1:3100/audio'
else
  read -r -p 'Startup failed. Press Enter to close.'
fi
exit "$result"
