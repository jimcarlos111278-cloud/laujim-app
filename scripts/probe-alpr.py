# Replica capture_snapshot() paso a paso con diagnostico. Sin secretos.
import os
import time
import subprocess

HDF = '/app/hls'

def probe(cam_id):
    print('=== CAM ' + cam_id + ' ===')
    cam_dir = os.path.join(HDF, cam_id)
    snapshot_path = os.path.join(cam_dir, 'snapshot.jpg')
    if os.path.exists(snapshot_path):
        print('snapshot mtime_age_s:', round(time.time() - os.path.getmtime(snapshot_path), 1),
              'size:', os.path.getsize(snapshot_path))
    else:
        print('snapshot: MISSING')
    try:
        ts_files = sorted([f for f in os.listdir(cam_dir) if f.endswith('.ts') and f.startswith('seg_')])
    except OSError as e:
        print('readdir FAIL:', str(e)[:100])
        return
    print('seg_count:', len(ts_files))
    if not ts_files:
        return
    for f in ts_files[-3:]:
        p = os.path.join(cam_dir, f)
        print('seg:', f, 'age_s:', round(time.time() - os.path.getmtime(p), 1), 'size:', os.path.getsize(p))
    latest = os.path.join(cam_dir, ts_files[-1])
    tmp_path = '/tmp/probe_snap.jpg'
    cmd = ['ffmpeg', '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
           '-i', latest, '-vframes', '1', '-q:v', '2', tmp_path]
    try:
        r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=8)
        print('ffmpeg rc:', r.returncode, 'stderr:', r.stderr.decode()[:300])
        if os.path.exists(tmp_path):
            print('tmp size:', os.path.getsize(tmp_path))
            os.remove(tmp_path)
        else:
            print('tmp: MISSING')
    except Exception as e:
        print('ffmpeg EXC:', str(e)[:200])

for c in ['l', 'r']:
    probe(c)
print('PROBE_DONE')
