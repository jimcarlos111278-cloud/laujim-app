# Muestra HLS_DIR real y prueba listado + captura paso a paso. Sin secretos.
import os
import time
import ezviz_stream_server as m

print('HLS_DIR=', repr(m.HLS_DIR))
d = os.path.join(m.HLS_DIR, 'l')
print('exists:', os.path.exists(d))
try:
    fs = sorted([f for f in os.listdir(d) if f.endswith('.ts') and f.startswith('seg_')])
    print('seg_count:', len(fs))
    if fs:
        p = os.path.join(d, fs[-1])
        print('newest:', fs[-1], 'age:', round(time.time() - os.path.getmtime(p), 1), 'size:', os.path.getsize(p))
except Exception as e:
    print('LIST_EXC:', str(e)[:150])
print('CAP:', m.capture_snapshot('l'))
print('HDIR_DONE')
