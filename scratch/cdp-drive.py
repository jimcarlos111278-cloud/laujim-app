import json
import sys
import urllib.request
import websocket

CDP = 'http://127.0.0.1:9222'


def http(path, data=None, method='GET'):
    req = urllib.request.Request(CDP + path, data=data, method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode('utf-8', errors='replace'))


def tabs():
    return [t for t in http('/json/list') if t.get('type') == 'page']


def find_tab(match):
    for t in tabs():
        if match.lower() in (t.get('url') or '').lower():
            return t
    return None


def evaluate(ws_url, js, await_promise=False):
    ws = websocket.create_connection(ws_url, timeout=150)
    try:
        ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate',
                            'params': {'expression': js, 'awaitPromise': await_promise,
                                       'returnByValue': True}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get('id') == 1:
                break
        res = msg.get('result', {})
        if 'exceptionDetails' in res:
            return 'EVAL_EXCEPTION: ' + json.dumps(res['exceptionDetails'])[:500]
        return json.dumps(res.get('result', {}).get('value'), ensure_ascii=False)[:8000]
    finally:
        ws.close()


def main():
    args = sys.argv[1:]
    if not args or args[0] in ('--help', '-h'):
        print('Uso: cdp-drive.py --tabs | --new <url> | --match <txt> --js <expr> [--await]')
        return
    if args[0] == '--tabs':
        for t in tabs():
            print(t.get('id'), '|', t.get('title'), '|', t.get('url'))
        return
    if args[0] == '--new':
        req = urllib.request.Request(CDP + '/json/new?' + urllib.parse.quote(args[1], safe=''), data=b'', method='PUT')
        with urllib.request.urlopen(req, timeout=20) as res:
            print(res.read().decode('utf-8', errors='replace')[:500])
        return
    match = ''
    js = ''
    await_promise = False
    i = 0
    while i < len(args):
        if args[i] == '--match':
            match = args[i + 1]
            i += 2
        elif args[i] == '--js':
            js = args[i + 1]
            i += 2
        elif args[i] == '--await':
            await_promise = True
            i += 1
        else:
            i += 1
    tab = find_tab(match)
    if not tab:
        print('TAB_NOT_FOUND: ' + match)
        sys.exit(2)
    print(evaluate(tab['webSocketDebuggerUrl'], js, await_promise))


main()
