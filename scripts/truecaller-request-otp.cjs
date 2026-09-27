const truecaller = require('truecallerjs');
const fs = require('fs');
const path = require('path');

async function main() {
  const phone = process.argv[2] || '+573107203822';
  console.log(`[Truecaller Login] Solicitando código OTP para: ${phone}...`);

  try {
    const res = await truecaller.login(phone);
    console.log('\nRespuesta de Truecaller:', JSON.stringify(res, null, 2));

    const reqPath = path.join(__dirname, '..', 'data', 'truecaller-request.json');
    const dir = path.dirname(reqPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(reqPath, JSON.stringify({ phone, res }, null, 2));

    console.log(`\n¡Código OTP enviado con éxito! Revisa tu celular ${phone} por SMS.`);
  } catch (error) {
    console.error('\nError al solicitar OTP:', error.message);
    if (error.response?.data) {
      console.error('Detalle de API:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

main();
