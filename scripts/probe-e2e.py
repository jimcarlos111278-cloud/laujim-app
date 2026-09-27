# Prueba punta a punta con camara sana (entrada): snapshot + API real.
import time
import ezviz_stream_server as m

snap = m.capture_snapshot('entrada')
print('SNAP:', snap)
if snap:
    t0 = time.time()
    try:
        res = m.scan_plates_cloud(snap, 'entrada')
        print('ELAPSED_MS:', round((time.time() - t0) * 1000, 1))
        print('RESULTS:', str(res)[:800])
    except Exception as e:
        print('SCAN_EXC:', str(e)[:200])
else:
    print('NO_SNAPSHOT')
print('E2E_DONE')
