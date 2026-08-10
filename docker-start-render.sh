#!/bin/sh
set -eu

display="${DISPLAY:-:99}"
xvfb_log=/tmp/laujim-xvfb.log

echo "[BOOT] Starting Xvfb on ${display}..."
Xvfb "${display}" -screen 0 1366x768x24 -ac -nolisten tcp >"${xvfb_log}" 2>&1 &
xvfb_pid=$!

sleep 1
if ! kill -0 "${xvfb_pid}" 2>/dev/null; then
  echo "[BOOT] Xvfb failed to start:"
  cat "${xvfb_log}" || true
  exit 1
fi

echo "[BOOT] Xvfb ready; starting Laujim..."
exec npm start
