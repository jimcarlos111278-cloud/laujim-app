# Llama a capture_snapshot() real del motor para l y r. Sin secretos.
import ezviz_stream_server as m

for c in ['l', 'r']:
    try:
        print('CAP', c, '->', m.capture_snapshot(c))
    except Exception as e:
        print('CAP', c, 'EXC:', str(e)[:200])
print('CAP_DONE')
