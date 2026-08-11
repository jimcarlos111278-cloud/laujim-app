# Worker portátil de servicios

## Objetivo

El scraper de servicios no queda amarrado a Render, a Browserless ni a un
equipo concreto. Un Android, un PC Windows o cualquier otro runtime puede
abrir los portales con una sesión local y enviar únicamente resultados
sanitizados a Laujim.

```text
Android / PC / otro navegador
        │  sesión y credenciales locales
        │  HTTPS: resultados de Deuda Total
        ▼
Render: /worker/v1/* ── PostgreSQL/Aiven ── Bot y panel
```

El worker nunca recibe `DATABASE_URL`, contraseñas de Aiven ni el token de
WhatsApp. Las credenciales de los portales se quedan en el dispositivo y la
base central conserva solo los valores obtenidos.

## Contrato HTTP

Todos los endpoints requieren:

```text
X-Worker-Token: <SCRAPER_WORKER_TOKEN>
```

Registro o cambio de equipo:

```http
POST /worker/v1/register
Content-Type: application/json

{
  "deviceId": "android-laujim-01",
  "platform": "android",
  "runtime": "laujim-apk",
  "appVersion": "1.0.0",
  "providers": ["water", "air-e", "gas"],
  "replaceExisting": true
}
```

`replaceExisting: true` deja inactivos los demás dispositivos. Así se puede
cambiar de celular a PC sin editar el bot ni migrar la base de datos.

Configuración sin secretos:

```http
GET /worker/v1/config
X-Worker-Id: android-laujim-01
```

El resultado incluye horarios, portales y apartamentos/códigos asociados,
pero no incluye contraseñas.

Enviar resultados:

```http
POST /worker/v1/results
Content-Type: application/json

{
  "deviceId": "android-laujim-01",
  "runId": "water-2026-08-11T19:00:00-05:00",
  "capturedAt": "2026-08-11T19:02:10-05:00",
  "results": [
    {
      "provider": "Triple A",
      "service": "water",
      "apartment": "403",
      "waterPaymentCode": "66499604",
      "status": "pending",
      "deudaTotalCOP": 5000
    }
  ]
}
```

El servidor acepta también `Air-e` y `Gases del Caribe`, normaliza el formato
`Deuda Total`, elimina campos no permitidos y actualiza `utilityRecords`.

## Configuración de Render

Crear estas variables de entorno:

```text
SCRAPER_WORKER_ENABLED=true
SCRAPER_WORKER_TOKEN=<token aleatorio largo>
PORTABLE_WORKER_INTERVAL_HOURS=12
PORTABLE_WORKER_START_AT=07:00
PORTABLE_WORKER_TIMEZONE=America/Bogota
PORTABLE_WORKER_PROVIDERS=air-e,water,gas
```

El token debe ser diferente de las credenciales de los portales y no debe
entrar en Git ni en la APK publicada.

La frecuencia también se puede cambiar desde `Worker scraper` en la app. La
selección se guarda como `portable_worker_schedule`; el siguiente `GET
/worker/v1/config` entrega el nuevo intervalo al dispositivo sin modificar
variables ni redeployar Render.

## Android

El celular necesita:

1. Android con internet estable y espacio para la APK.
2. Laujim instalada y el worker habilitado.
3. Inicio de sesión manual una vez en Triple A, Air-e y Gases del Caribe.
4. Permiso de notificaciones y exclusión de la app de optimización de batería.
5. Preferiblemente cargador conectado durante las consultas.

El worker Android debe ejecutar el navegador visible o un WebView persistente,
conservar su propia sesión y enviar los resultados al contrato anterior. Si
Turnstile pide interacción, la APK debe notificarlo y dejar la resolución al
administrador; no debe intentar falsificar el token.

## Cambiar de dispositivo

1. Instalar el mismo worker en el nuevo Android o PC.
2. Configurar la URL de Render y el token del worker.
3. Registrar el nuevo `deviceId` con `replaceExisting: true`.
4. Iniciar sesión en los portales en el nuevo dispositivo.
5. Verificar el último `heartbeat` y la fecha `scrapedAt` en Laujim.

No se cambia el bot, el formato de WhatsApp ni la base de datos.

## Estado de los ejecutores

La pantalla `Worker scraper` ya estÃ¡ disponible dentro de la app y la APK
compilada se genera en `dist/app-debug.apk`. Esa pantalla registra el
dispositivo y valida la conexiÃ³n; el ejecutor Android en segundo plano queda
como una capa nativa posterior, porque Android aplica restricciones propias a
la baterÃ­a y a los navegadores en segundo plano.

En Windows ya estÃ¡ disponible el runner local. Copia
`portable-worker.config.example.json` como `portable-worker.config.json`,
completa el token de Render y las credenciales locales, y ejecuta:

```text
npm run portable-worker -- --once
```

Para dejarlo programado, ejecuta `npm run portable-worker`. AbrirÃ¡ Chrome
visible con un perfil persistente; si aparece Turnstile, se puede resolver
manualmente y la sesiÃ³n queda guardada en ese PC.

La APK compilada se copia a `public/app-debug.apk` y el endpoint
`/app-debug.apk` la sirve directamente desde el web service; si una versiÃ³n
antigua no contiene ese archivo, conserva el respaldo del release de GitHub.
