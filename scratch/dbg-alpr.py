import os
import sys
import time
import traceback

sys.path.insert(0, '/app')

CAM = sys.argv[1] if len(sys.argv) > 1 else 'l'

try:
    import ezviz_stream_server as E

    print('HLS_DIR=' + str(E.HLS_DIR))
    cam_dir = os.path.join(E.HLS_DIR, CAM)
    print('CAM_DIR=' + cam_dir + ' EXISTS=' + str(os.path.exists(cam_dir)))
    names = os.listdir(cam_dir)
    segs = [f for f in names if f.endswith('.ts') and f.startswith('seg_')]
    print('SEG_COUNT=' + str(len(segs)))
    by_mtime = sorted(segs, key=lambda f: os.path.getmtime(os.path.join(cam_dir, f)))
    for f in by_mtime[-3:]:
        full = os.path.join(cam_dir, f)
        print('CAND ' + f + ' size=' + str(os.path.getsize(full)) + ' age_s=' + str(round(time.time() - os.path.getmtime(full), 1)))
    out = E.capture_snapshot(CAM, max_age_s=300.0, out_name='alpr_frame.jpg')
    print('SNAP=' + str(out))
    import subprocess
    cand = os.path.join(cam_dir, sorted(
        [f for f in names if f.endswith('.ts') and f.startswith('seg_')],
        key=lambda f: os.path.getmtime(os.path.join(cam_dir, f)),
    )[-1])
    tmp = os.path.join(cam_dir, 'alpr_frame.jpg.tmp')
    cmd = ['ffmpeg', '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
           '-fflags', '+genpts', '-i', cand, '-vframes', '1', '-an', '-q:v', '2', tmp]
    try:
        r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30.0)
        print('RC=' + str(r.returncode) + ' EXISTS=' + str(os.path.exists(tmp)))
        if os.path.exists(tmp):
            print('SIZE=' + str(os.path.getsize(tmp)))
    except Exception:
        traceback.print_exc()
    errlog = '/tmp/alpr_err.log'
    try:
        with open(errlog, 'wb') as ef:
            r2 = subprocess.run(cmd[:-1] + ['/tmp/alpr_probe.jpg'], stdout=subprocess.DEVNULL, stderr=ef, timeout=30.0)
        print('RC2=' + str(r2.returncode))
    except Exception:
        traceback.print_exc()
    try:
        with open(errlog, 'rb') as ef:
            print('STDERR_TAIL=' + ef.read()[-600:].decode('utf-8', errors='replace'))
    except Exception:
        traceback.print_exc()
except Exception:
    traceback.print_exc()
