# Uso: <password por stdin> | python3 set-admin-pass.py <database.json>
# Igual que hashAdminPassword() de server.cjs: scrypt N=16384,r=8,p=1,dklen=32.
import sys, json, hashlib, secrets, base64

def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def main():
    if len(sys.argv) < 2:
        print('NO_FILE', file=sys.stderr); return 1
    data = sys.stdin.read()
    pw = data.strip().strip('"').strip("'")
    if not pw:
        print('NO_PASS', file=sys.stderr); return 1
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    value = 'scrypt$' + b64u(salt) + '$' + b64u(dk)
    path = sys.argv[1]
    with open(path, encoding='utf-8') as f:
        j = json.load(f)
    st = j.get('settings')
    if not isinstance(st, list):
        st = []; j['settings'] = st
    ex = next((s for s in st if isinstance(s, dict) and s.get('key') == 'admin_password_hash'), None)
    if ex is not None:
        ex['value'] = value
    else:
        nid = (j.get('nextId') or {}).get('settings') or (len(st) + 1)
        st.append({'id': nid, 'key': 'admin_password_hash', 'value': value})
        if isinstance(j.get('nextId'), dict):
            j['nextId']['settings'] = nid + 1
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(j, f)
    print('ADMIN_PASS_UPDATED')
    return 0

sys.exit(main())
