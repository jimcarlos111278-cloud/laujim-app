import os
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('149.130.160.116', username='ubuntu', key_filename=r'C:\Users\jimca\.ssh\id_ed25519_laujim')

sftp = ssh.open_sftp()
test_py = '''import os
import json
import requests

token = 'e4edfc08a7ae867f2087bd803cc85fd198cac290'
url = 'https://api.platerecognizer.com/v1/plate-reader/'

for cam_id in ['l', 'r']:
    snap_path = f'/app/hls/{cam_id}/snapshot.jpg'
    if not os.path.exists(snap_path):
        continue
    with open(snap_path, 'rb') as fp:
        resp = requests.post(
            url,
            headers={'Authorization': 'Token ' + token},
            files={'upload': fp},
            data={'regions': 'co', 'mmc': 'true'}
        )
    print(f'=== Plate Recognizer Cloud Cam {cam_id} === (Status: {resp.status_code})')
    try:
        data = resp.json()
        results = data.get('results', [])
        print(f'Detected plates count: {len(results)}')
        for r in results:
            print('  Plate:', r.get('plate'), 'Score:', r.get('score'), 'Box:', r.get('box'), 'Vehicle:', r.get('vehicle', {}).get('type'))
    except Exception as e:
        print('Error parsing response:', resp.text[:300])
'''

with sftp.open('/home/ubuntu/laujim-app/test_pr_cloud.py', 'w') as f:
    f.write(test_py)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('docker cp /home/ubuntu/laujim-app/test_pr_cloud.py laujim-video:/app/ && docker exec laujim-video python3 /app/test_pr_cloud.py')
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))
ssh.close()
