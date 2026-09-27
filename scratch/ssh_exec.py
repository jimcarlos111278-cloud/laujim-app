import sys
import paramiko

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'ls -la'
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('149.130.160.116', username='ubuntu', key_filename=r'C:\Users\jimca\.ssh\id_ed25519_laujim')
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        sys.stdout.buffer.write(out.encode('utf-8'))
    if err:
        sys.stderr.buffer.write(err.encode('utf-8'))
    ssh.close()

if __name__ == '__main__':
    main()
