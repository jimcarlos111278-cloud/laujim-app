# Prueba egress del contenedor hacia Plate Recognizer. Sin token, sin secretos.
import socket
import time
import urllib.request

t0 = time.time()
try:
    ip = socket.gethostbyname('api.platerecognizer.com')
    print('DNS_OK:', ip, 'in', round(time.time() - t0, 2), 's')
except Exception as e:
    print('DNS_FAIL:', str(e)[:150])
    raise SystemExit

t1 = time.time()
req = urllib.request.Request('https://api.platerecognizer.com/v1/statistics/')
try:
    urllib.request.urlopen(req, timeout=15)
    print('HTTPS unexpectedly OK')
except Exception as e:
    print('HTTPS_STATUS: got expected auth error in', round(time.time() - t1, 2), 's:', str(e)[:120])
print('EGRESS_DONE')
