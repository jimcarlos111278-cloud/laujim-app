const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'tools', 'go2rtc', 'go2rtc.yaml');

function updateCodes(codeGate, codeLat, codeIzq) {
  const g = String(codeGate || '').trim().toUpperCase();
  const l = String(codeLat || '').trim().toUpperCase();
  const i = String(codeIzq || '').trim().toUpperCase();

  const yamlContent = # Configuracion go2rtc para Edificio Laujim
api:
  listen:  127.0.0.1:1984

rtsp:
  listen: :8554

webrtc:
  listen: :8555

streams:
  # Porton Principal - Serial BG6994814 (192.168.1.25)
  cam_gate:
    - rtsp://admin:\@192.168.1.25:554/h264/ch1/main/av_stream
    - rtsp://admin:\@192.168.1.25:554/h264/ch1/sub/av_stream

  # Fachada Lateral (L) - Serial BG6994872 (192.168.1.9)
  cam_lat:
    - rtsp://admin:\@192.168.1.9:554/h264/ch1/main/av_stream
    - rtsp://admin:\@192.168.1.9:554/h264/ch1/sub/av_stream

  # Fachada Izquierda (IZQ) - Serial BG6994741 (192.168.1.28)
  cam_izq:
    - rtsp://admin:\@192.168.1.28:554/h264/ch1/main/av_stream
    - rtsp://admin:\@192.168.1.28:554/h264/ch1/sub/av_stream
;

  fs.writeFileSync(configPath, yamlContent, 'utf8');
  console.log('go2rtc.yaml actualizado exitosamente con las IPs y codigos.');
}

const [,, g, l, i] = process.argv;
if (g && l && i) {
  updateCodes(g, l, i);
} else {
  console.log('Uso: node set-camera-codes.cjs <CODIGO_PORTON> <CODIGO_LATERAL> <CODIGO_IZQUIERDA>');
}
