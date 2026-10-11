import paramiko
import json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('149.130.160.116', username='ubuntu', key_filename=r'C:\Users\jimca\.ssh\id_ed25519_laujim')

node_script = """
const fs = require('fs');
const http = require('http');
const db = JSON.parse(fs.readFileSync('/app/data/database.json', 'utf8'));

for (const aptName of ['101', '102', '201', '302']) {
  const apt = (db.apartments || []).find(a => a.name === aptName);
  if (!apt) continue;
  const tenant = (db.tenants || []).find(t => Number(t.apartmentId) === Number(apt.id));
  if (!tenant) continue;
  const loginData = JSON.stringify({ username: apt.name, password: tenant.documentId });

  const req = http.request({
    host: 'localhost',
    port: 10000,
    path: '/api/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) }
  }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      try {
        const token = JSON.parse(b).token;
        http.get({
          host: 'localhost',
          port: 10000,
          path: '/api/tenant/overview',
          headers: { 'x-auth-token': token }
        }, tRes => {
          let tb = '';
          tRes.on('data', c => tb += c);
          tRes.on('end', () => {
            try {
              const ov = JSON.parse(tb);
              console.log('=== APTO ' + aptName + ' SERVICES ===');
              for (const [k, v] of Object.entries(ov.services || {})) {
                console.log(k, {
                  fechaSuspension: v.fechaSuspension,
                  vencimiento: v.vencimiento,
                  status: v.status,
                  debt: v.debt,
                  deudaTotal: v.deudaTotal,
                  deudaConveniosCOP: v.deudaConveniosCOP,
                  facturasPendientes: v.facturasPendientes,
                  financiacion: v.financiacion
                });
              }
            } catch (e) {
              console.error(e);
            }
          });
        });
      } catch (e) {
        console.error(e);
      }
    });
  });
  req.write(loginData);
  req.end();
}
"""

sftp = ssh.open_sftp()
with sftp.file('/tmp/check_tenant.js', 'w') as f:
    f.write(node_script)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('cat /tmp/check_tenant.js | docker exec -i laujim-app node')
print("OUT:\n", stdout.read().decode())
print("ERR:\n", stderr.read().decode())
ssh.close()
