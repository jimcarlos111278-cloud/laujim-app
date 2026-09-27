# Uso: python3 pr-stats.py /ruta/a/ezviz_stream_server.py
# Lee el token del propio archivo desplegado y consulta uso/cuota.
# Solo imprime numeros de uso, nunca el token.
import re
import sys
import json
import urllib.request

def main():
    src = open(sys.argv[1], encoding='utf-8', errors='replace').read()
    m = re.search(r'PLATE_RECOGNIZER_TOKEN\s*=\s*os\.environ\.get\("PLATE_RECOGNIZER_TOKEN",\s*"([^"]+)"', src)
    env_tok = None
    if not m:
        print('NO_TOKEN_FOUND')
        return 1
    token = m.group(1).strip()
    if not token:
        print('EMPTY_TOKEN')
        return 1
    req = urllib.request.Request(
        'https://api.platerecognizer.com/v1/statistics/',
        headers={'Authorization': 'Token ' + token},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            print('HTTP:', r.status)
            print(json.dumps(json.load(r))[:600])
    except Exception as e:
        print('STATS_ERR:', str(e)[:200])
        return 1
    return 0

sys.exit(main())
