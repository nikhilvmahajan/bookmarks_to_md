#!/usr/bin/env bash
# Runs after each bookmarks-fetch.service run (ExecStopPost=).
# systemd sets SERVICE_RESULT and EXIT_STATUS. Argument 1: the timer unit.
# Exit 2 = the Twitter login is missing or expired. No later run can work,
# so this disables the timer (it stays off after a reboot) and notifies once.
# Any other failure: notify only. The timer stays on.
# Same logic as inoreader-cli/scripts/after-fetch.sh.
set -u
timer=${1:?usage: after-fetch.sh <timer unit>}
result=${SERVICE_RESULT:-unknown}
status=${EXIT_STATUS:-unknown}

if [ "$result" = success ]; then
  exit 0
fi

if [ "$result" = exit-code ] && [ "$status" = 2 ]; then
  restart="To restart, in ~/code/bookmarks_to_md run: node src/cli.js config --auth-token VALUE --ct0 VALUE. Then run: systemctl --user enable --now $timer"
  if systemctl --user disable --now "$timer"; then
    echo "after-fetch: Twitter login missing or expired. Disabled $timer." >&2
    notify-send -u critical "Bookmarks sync turned off: Twitter login missing or expired" "$restart"
  else
    echo "after-fetch: Twitter login missing or expired. Could not disable $timer." >&2
    notify-send -u critical "Twitter login missing or expired: could NOT turn the bookmarks timer off" "$restart"
  fi
else
  notify-send -u critical "Bookmarks fetch failed (exit $status)" "Details: journalctl --user -u bookmarks-fetch -n 30"
fi
