# Automatizaciones Avanzadas, Telemetría y Límites: Cámaras Ezviz H8c 5MP

Este documento recopila la investigación arquitectónica, endpoints descubiertos, switches de hardware y capacidades listas para exprimir en las 3 cámaras del Edificio Laujim (`BG6994814` Portón Principal, `BG6994872` Cámara Izquierda, `BG6994741` Cámara Derecha).

---

## 1. Estado Actual Implementado en Producción

### 1.1 Telemetría WiFi en Tiempo Real
- **Endpoint Servidor:** `GET /api/cameras/telemetry` (también alias `/api/api/cameras/telemetry` y `/api/admin/cameras/telemetry`).
- **Mecanismo:** Consulta directa a la API de Ezviz con filtro dedicado `WIFI` y `CLOUD`, obteniendo la intensidad de señal física (`signalPercent`), decibelios milivatio (`signalDbm`), IP local en la LAN del router (`192.168.1.X`), SSID (`Laujim`), estado de tarjeta SD y latencia RTT de la nube.
- **Caché en Memoria (Render):** 6 segundos de ventana para evitar rate limiting en consultas frecuentes desde el frontend.
- **Vistas Integradas:**
  1. `Dashboard.jsx`: Widget activo con sincronización en vivo cada 12 segundos, barras de color (Verde/Ámbar/Rojo) y recomendación de repetidor.
  2. `SecurityCenter.jsx`: Centro unificado de seguridad con control PTZ, transmisión en vivo de las 3 cámaras y modal de diagnóstico detallado.
  3. `MiApto.jsx`: Acceso para inquilinos con métricas de conectividad y consejos de ancho de banda.

---

## 2. Movimiento por Coordenadas (X, Y) y Patrullaje Programado

### 2.1 Movimiento Absoluto por Coordenadas 3D
- **Endpoint:** `PUT /v3/iot-feature/action/{serial}/Video_1/1/PTZManualCtrl/CtrlPTZ3DPosition`
- **Cuerpo:**
  ```json
  {
    "positionCtrlType": "point",
    "positionPoint": { "x": 0.25, "y": 0.50 },
    "positionRect": { "height": 1.0, "width": 1.0, "x": 0.0, "y": 0.0 }
  }
  ```
- **Rango de Coordenadas:** Valores normalizados entre `0.0` y `1.0`.
  - Permite definir *Presets* fijos (ej. Portón cerrado, Entrada peatonal, Calle vehicular, Fachada lateral) sin depender de giros manuales aproximados.

### 2.2 Escaneo Panorámico 360° Interactivo
- **Endpoint:** `POST /api/panoramic/devices/pics/collect`
- **Resultado:** La cámara realiza un barrido completo horizontal de 360°, une las capturas y genera una imagen panorámica (`/api/panoramic/devices/pics`).
- **Uso:** En la app o dashboard se puede desplegar el mapa panorámico, y al hacer clic sobre cualquier sector, la cámara apunta el lente directamente a ese punto.

### 2.3 Patrullaje Automático y Horarios (Rondas)
- **Switches de Hardware:**
  - `CRUISE = 9`: Activa el modo crucero continuo.
  - `CRUISE_TRACKING = 651`: Mantiene el patrullaje combinado con seguimiento inteligente de objetos.
  - `SupportPtzHorizontal360 = 199`: Barrido completo horizontal de 360°.
- **Programación de Rondas con `node-cron`:**
  - Ejemplo: Cada hora en horario nocturno (ej. 22:00 a 06:00), ejecutar un barrido de izquierda a derecha durante 40 segundos y regresar automáticamente a la posición vigilante base (*Home Position*).

---

## 3. Audios, Sirenas y Alertas de Voz Personalizadas

### 3.1 Control de Sirena y Nivel Sonoro
- **Endpoint:** `PUT /v3/devices/{serial}/alarm/sound`
- **Parámetros (`soundType`):**
  - `0` (`SOFT`): Aviso sonoro suave tipo timbre/chime.
  - `1` (`INTENSE`): Sirena disuasiva de alta potencia (100 dB).
  - `2` (`SILENT`): Alarma silenciosa (solo notificación y luz).
  - `3` (`CUSTOM`): Reproducción de clip de voz grabado con `voiceId`.

### 3.2 Grabación y Subida de Audios de Voz Personalizados
- **Endpoint:** `POST /v3/specialBizs/voices` (Listar con `GET /v3/specialBizs/voices`)
- **Parámetros:**
  ```json
  {
    "deviceSerial": "BG6994814",
    "voiceName": "aviso_porton",
    "voiceUrl": "https://laujim-app.onrender.com/audio/aviso-porton.wav"
  }
  ```
- **Ejemplos de Mensajes Prácticos para el Edificio:**
  - *"Bienvenido al Edificio Laujim. En un momento le atenderemos."*
  - *"Área privada monitoreada. Por favor no obstaculice el portón."*
  - *"Entrega registrada. Gracias por su visita."*

---

## 4. Disuasión Activa por Luz y Detección de Siluetas

- **Focos LED Frontales (`Switch 3 - LIGHT`):** Encendido/apagado de los reflectores LED bajo demanda para iluminar la entrada a todo color.
- **Luz Estroboscópica (`Switch 301 - LIGHT_FLICKER` y `Switch 303 - ALARM_LIGHT`):** Parpadeo disuasivo de advertencia.
- **Detección Humana por IA (`Switch 41 - DEVICE_HUMAN_RELATE_LIGHT` y `Switch 200 - HUMAN_INTELLIGENT_DETECTION`):**
  - La cámara discrimina personas de animales o ramas.
  - Enciende los reflectores solo cuando una persona entra al perímetro en horario nocturno.
- **Auto-Tracking (`Switch 25 - MOBILE_TRACKING` y `Switch 650 - TRACKING`):**
  - La cámara rota automáticamente siguiendo a la persona mientras camina por el andén o entra al edificio, y luego regresa a su punto base.

---

## 5. Costos, Cuotas y Rendimiento de la API

| Concepto | Valor / Límite | Impacto |
| :--- | :--- | :--- |
| **Costo por Llamada API** | **\$0 (Totalmente gratuito)** | Utiliza la sesión Consumer nativa sin licencias de pago. |
| **Comandos PTZ / Audio / Luces** | Ilimitados | Payload JSON de < 1 KB; consumo nulo de ancho de banda. |
| **Frecuencia Recomendada PTZ** | 300 - 500 ms entre pulsos | Permite respuesta suave de los servomotores sin colas. |
| **Streaming de Video** | ~98 KB / fotograma | Mitigado con auto-pausa a 60s y deduplicación automática. |
