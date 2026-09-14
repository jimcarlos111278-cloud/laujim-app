#!/bin/sh
set -eu

display="${DISPLAY:-:99}"
display_num="${display#:}"
xvfb_log=/tmp/laujim-xvfb.log

# Clean up stale locks if Xvfb is not actively running
if ! pgrep -x "Xvfb" >/dev/null 2>&1; then
  rm -f "/tmp/.X${display_num}-lock" "/tmp/.X11-unix/X${display_num}" || true
fi

echo "[BOOT] Starting Xvfb on ${display}..."
Xvfb "${display}" -screen 0 1366x768x24 -ac -nolisten tcp >"${xvfb_log}" 2>&1 &
xvfb_pid=$!

sleep 1
if ! kill -0 "${xvfb_pid}" 2>/dev/null; then
  if pgrep -x "Xvfb" >/dev/null 2>&1; then
    echo "[BOOT] Xvfb already running on ${display}; reusing it."
  else
    echo "[BOOT] Xvfb failed to start:"
    cat "${xvfb_log}" || true
    exit 1
  fi
fi

echo "[BOOT] Xvfb ready; starting Laujim..."
exec npm start
