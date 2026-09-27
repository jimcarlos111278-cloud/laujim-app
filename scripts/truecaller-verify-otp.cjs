const truecaller = require('truecallerjs');
const fs = require('fs');
const path = require('path');

async function main() {
  const otp = process.argv[2];
  if (!otp) {
    console.error('Uso: node scripts/truecaller-verify-otp.cjs <CODIGO_OTP>');
    process.exit(1);
  }

  const reqPath = path.join(__dirname, '..', 'data', 'truecaller-request.json');
  if (!fs.existsSync(reqPath)) {
    console.error('Error: No se encontró solicitud previa. Ejecuta primero truecaller-request-otp.cjs');
    process.exit(1);
  }

  const { phone, res } = JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
  console.log(`[Truecaller Verify] Verificando código ${otp} para ${phone}...`);

  try {
    const verifyRes = await truecaller.verifyOtp(phone, res, otp);
    console.log('\nRespuesta de verificación:', JSON.stringify(verifyRes, null, 2));

    const installationId = verifyRes.installationId;
    if (installationId) {
      console.log(`\n¡SESIÓN OBTENIDA CON ÉXITO!`);
      console.log(`InstallationId: ${installationId}`);

      // Guardar en config local de truecallerjs
      const os = require('os');
      const authDir = path.join(os.homedir(), '.config', 'truecallerjs');
      if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(path.join(authDir, 'authkey.json'), JSON.stringify(verifyRes, null, 2));

      // Guardar en /app/.env o data
      const tokenFile = path.join(__dirname, '..', 'data', 'truecaller-token.json');
      fs.writeFileSync(tokenFile, JSON.stringify({ installationId, phone, updatedAt: new Date().toISOString() }, null, 2));

      console.log(`Token guardado en ${tokenFile}`);
    } else {
      console.error('No se recibió installationId en la respuesta.');
    }
  } catch (error) {
    console.error('\nError al verificar OTP:', error.message);
    if (error.response?.data) {
      console.error('Detalle de API:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

main();
