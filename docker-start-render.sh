#!/bin/sh
# Entrypoint del contenedor laujim-app (nombre histórico; corre en Oracle VM).
# Levanta Xvfb (:99) para el Chrome headful de los scrapers y luego npm start.
set -eu

display="${DISPLAY:-:99}"
dispnum="${display#:}"
xvfb_log=/tmp/laujim-xvfb.log

start_xvfb() {
  Xvfb "${display}" -screen 0 1366x768x24 -ac -nolisten tcp >"${xvfb_log}" 2>&1 &
  xvfb_pid=$!
  sleep 1
  kill -0 "${xvfb_pid}" 2>/dev/null
}

echo "[BOOT] Starting Xvfb on ${display}..."
if ! start_xvfb; then
  if grep -q "Server is already active for display" "${xvfb_log}" 2>/dev/null; then
    # Puede ser un lock vigente (reutilizar) o restos huérfanos de un reinicio
    # (lock/socket sin servidor). La prueba autoritativa es el PROCESO vivo:
    # un socket sin Xvfb no sirve y debe limpiarse.
    alive=0
    if command -v pidof >/dev/null 2>&1 && pidof Xvfb >/dev/null 2>&1; then alive=1; fi
    if command -v pgrep >/dev/null 2>&1 && pgrep -x Xvfb >/dev/null 2>&1; then alive=1; fi
    if [ "${alive}" = "1" ]; then
      echo "[BOOT] Xvfb already active on ${display}; reusing it."
    else
      echo "[BOOT] Stale X lock/socket without live Xvfb; clearing and starting fresh..."
      rm -f "/tmp/.X${dispnum}-lock" "/tmp/.X11-unix/X${dispnum}"
      if ! start_xvfb; then
        echo "[BOOT] Xvfb failed to start:"
        cat "${xvfb_log}" || true
        exit 1
      fi
    fi
  else
    echo "[BOOT] Xvfb failed to start:"
    cat "${xvfb_log}" || true
    exit 1
  fi
fi

echo "[BOOT] Xvfb ready; starting Laujim..."
exec npm start
