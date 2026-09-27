# Replica EXACTA de capture_snapshot() con trazas por paso. Sin secretos.
import os
import time
import subprocess

HLS_DIR = '/app/hls'

def cap(cam_id):
    print('=== CAP ' + cam_id + ' ===')
    cam_dir = os.path.join(HLS_DIR, cam_id).replace('\\', '/')
    snapshot_path = os.path.join(cam_dir, 'snapshot.jpg').replace('\\', '/')
    print('cam_dir exists:', os.path.exists(cam_dir))
    if os.path.exists(snapshot_path):
        print('snap age:', round(time.time() - os.path.getmtime(snapshot_path), 1))
    else:
        print('snap: MISSING')
    if os.path.exists(cam_dir):
        ts_files = sorted([f for f in os.listdir(cam_dir) if f.endswith('.ts') and f.startswith('seg_')])
        print('seg_count:', len(ts_files))
        for cand in reversed(ts_files[-3:]):
            latest_ts = os.path.join(cam_dir, cand).replace('\\', '/')
            try:
                age = time.time() - os.path.getmtime(latest_ts)
                sz = os.path.getsize(latest_ts)
                print('cand:', cand, 'age:', round(age, 1), 'size:', sz)
                if age > 10.0:
                    print('SKIP old')
                    continue
                if sz < 50000:
                    print('SKIP small')
                    continue
            except OSError as e:
                print('SKIP oserr', str(e)[:80])
                continue
            tmp_path = snapshot_path + '.tmp'
            snap_cmd = ['ffmpeg', '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
                        '-i', latest_ts, '-vframes', '1', '-q:v', '2', tmp_path]
            try:
                subprocess.run(snap_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8.0)
                if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 1000:
                    os.replace(tmp_path, snapshot_path)
                    print('RETURN PATH')
                    return snapshot_path
                print('tmp missing/small')
            except Exception as e:
                print('ffmpeg EXC:', str(e)[:150])
                try:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                except OSError:
                    pass
                continue
    print('RETURN None')
    return None

for c in ['l', 'r']:
    cap(c)
print('CAP2_DONE')
