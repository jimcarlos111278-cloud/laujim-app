import os
import sys
import paramiko

HOST = '149.130.160.116'
USER = 'ubuntu'
KEY = r'C:\Users\jimca\.ssh\id_ed25519_laujim'


def ensure(sftp, path):
    parts = path.strip('/').split('/')
    cur = ''
    for part in parts:
        cur += '/' + part
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def main():
    if len(sys.argv) < 3:
        print('Uso: send-files-vm.py <destino-remoto> <archivo...>')
        sys.exit(2)
    dest = sys.argv[1].replace(os.sep, '/').rstrip('/')
    files = sys.argv[2:]
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, key_filename=KEY)
    sftp = ssh.open_sftp()
    ensure(sftp, dest)
    for local in files:
        name = os.path.basename(local)
        remote = dest + '/' + name
        sftp.put(local, remote)
        print('VM_PATH:' + remote, flush=True)
    sftp.close()
    ssh.close()


main()
