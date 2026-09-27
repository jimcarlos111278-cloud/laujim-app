import os
import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REMOTE_BASE = '/home/ubuntu/laujim-app/app'

FILES = [
    'server.cjs',
    'public/app-version.json',
    'public/releases/laujim-v1.0.133.apk',
]

HOST = '149.130.160.116'
USER = 'ubuntu'
KEY = r'C:\Users\jimca\.ssh\id_ed25519_laujim'


def ensure(sftp, path):
    parts = path.strip('/').split('/')
    cur = ''
    for part in parts[:-1]:
        cur += '/' + part
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def put_file(sftp, local, remote):
    ensure(sftp, remote)
    sftp.put(local, remote)
    print('OK ' + remote, flush=True)


def put_dir(sftp, local_dir, remote_dir, count):
    for base, _dirs, files in os.walk(local_dir):
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, local_dir).replace(os.sep, '/')
            put_file(sftp, full, remote_dir + '/' + rel)
            count[0] += 1
            if count[0] % 50 == 0:
                print('... %d archivos' % count[0], flush=True)


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, key_filename=KEY)
    sftp = ssh.open_sftp()
    count = [0]
    for rel in FILES:
        local = os.path.join(ROOT, *rel.split('/'))
        if not os.path.exists(local):
            print('FALTA local: ' + rel, flush=True)
            continue
        put_file(sftp, local, REMOTE_BASE + '/' + rel)
        count[0] += 1
    put_dir(sftp, os.path.join(ROOT, 'dist'), REMOTE_BASE + '/dist', count)
    print('TOTAL %d archivos' % count[0], flush=True)
    sftp.close()
    ssh.close()


main()
