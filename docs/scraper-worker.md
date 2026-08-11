# Worker portatil de servicios

## Objetivo

El scraper no queda amarrado a un equipo. Un Android puede abrir los portales
localmente con el WebView nativo; un PC o VPS puede hacerlo con Chromium/Chrome
local. Render solo entrega configuracion, recibe resultados sanitizados y
alimenta PostgreSQL y el bot.

```text
Android APK -- WebView local -- HTTPS: resultados --\
PC/VPS ----- Chromium local ---------------------> Render -- PostgreSQL -- Bot
                                                   \-- portales autenticados
```

El worker nunca recibe `DATABASE_URL`, contrasenas de Aiven ni el token de
WhatsApp. En Android la sesion queda en el WebView de Laujim; en PC/VPS queda
en el perfil local de Chromium. Las credenciales no se envian a Render.

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
  "runtime": "laujim-local-webview",
  "appVersion": "1.0.0",
  "providers": ["water", "air-e", "gas"],
  "replaceExisting": true
}
```

`replaceExisting: true` deja inactivos los demas dispositivos. Asi se puede
cambiar de celular a PC/VPS sin editar el bot ni migrar la base de datos.

Configuracion sin secretos:

```http
GET /worker/v1/config
X-Worker-Id: android-laujim-01
```

El resultado incluye horario, modo, portales y apartamentos/codigos asociados,
pero no incluye contrasenas.

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

El servidor normaliza `Deuda Total`, elimina campos no permitidos y actualiza
`utilityRecords`.

`POST /worker/v1/run` solo existe para el modo antiguo `render`. En el modo
recomendado `portable` responde `409`, porque el dispositivo debe abrir el
portal localmente y enviar `/worker/v1/results`.

## Configuracion de Render

```text
SCRAPER_WORKER_ENABLED=true
SCRAPER_WORKER_TOKEN=<token aleatorio largo>
SERVICES_EXECUTION_MODE=portable
PORTABLE_WORKER_INTERVAL_HOURS=12
PORTABLE_WORKER_START_AT=07:00
PORTABLE_WORKER_TIMEZONE=America/Bogota
PORTABLE_WORKER_PROVIDERS=air-e,water,gas
```

`portable` es el modo sin Browserless. Render no inicia el scheduler de
portales y no consume una integracion remota. El modo `render` queda disponible
solo si el administrador lo selecciona expresamente y cuenta con un navegador
local/full-browser en ese entorno.

La frecuencia tambien se puede cambiar desde `Worker scraper` en la app. La
seleccion se guarda como `portable_worker_schedule`; el siguiente
`GET /worker/v1/config` entrega el nuevo intervalo al dispositivo.

## Android

El celular necesita:

1. Android con internet estable y espacio para la APK.
2. Laujim instalada y el worker habilitado.
3. Registrar el dispositivo desde `Worker scraper` usando el token privado.
4. Permiso de notificaciones y exclusion de la app de optimizacion de bateria.
5. Cargador recomendado durante una consulta larga, pero no obligatorio.

La APK mantiene un servicio Android en primer plano y crea un WebView local.
Los botones `Abrir Air-e`, `Abrir Triple A` y `Abrir Gases` permiten iniciar
sesion o completar una verificacion humana. Las cookies quedan en el telefono
y el worker las reutiliza en las siguientes ejecuciones. La app nunca intenta
controlar Chrome, Brave o Internet de Samsung: usa su propio WebView para tener
control de la sesion y del DOM.

Si un portal vuelve a pedir login o Turnstile, la notificacion abre el portal
correspondiente. La app no intenta saltarse el control de seguridad.

## PC o VPS

En Windows/Linux esta disponible el runner local. Copia
`portable-worker.config.example.json` como `portable-worker.config.json`,
completa el token de Render y las credenciales locales, y ejecuta:

```text
npm run portable-worker -- --once
```

Para dejarlo programado, ejecuta `npm run portable-worker`. Usa un perfil local
persistentemente autenticado y abre Chrome/Chromium en el equipo. El runner
borra explicitamente las variables de Browserless para evitar consumo
accidental.

## Cambiar de dispositivo

1. Instalar la misma APK o copiar el runner al nuevo equipo.
2. Configurar URL de Render, token y un `deviceId` diferente.
3. Registrar el nuevo dispositivo con `replaceExisting: true`.
4. Iniciar el worker local.
5. Verificar el ultimo heartbeat, el estado y `scrapedAt` en Laujim.

No se cambia el bot, el formato de WhatsApp ni la base de datos.
