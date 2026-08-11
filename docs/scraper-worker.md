# Worker portátil de servicios

## Objetivo

El scraper de servicios no queda amarrado a un equipo concreto. Un PC Windows
puede abrir los portales localmente; la APK Android funciona como coordinador
en segundo plano y dispara en Render la misma consulta autenticada.

```text
Android APK ── HTTPS: dispara consulta ──┐
PC Windows ── navegador local ───────────┼─ Render: scrapers ── PostgreSQL/Aiven ── Bot
                                         └─ Browserless / portales autenticados
```

El worker nunca recibe `DATABASE_URL`, contraseñas de Aiven ni el token de
WhatsApp. La APK tampoco copia credenciales de portales: Render usa las
credenciales cifradas y Browserless configurados para ejecutar los scrapers.

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

Disparar una consulta desde Android:

```http
POST /worker/v1/run
X-Worker-Token: <SCRAPER_WORKER_TOKEN>
X-Worker-Id: android-laujim-01
Content-Type: application/json

{"deviceId":"android-laujim-01","platform":"android","runtime":"laujim-apk","providers":["air-e","water","gas"]}
```

La respuesta `202` significa que Render aceptó el trabajo; los resultados se
guardan cuando terminan los scrapers. `GET /worker/v1/run-status` permite ver
el último estado del proceso.

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
3. Registrar el dispositivo desde `Worker scraper` usando el token privado.
4. Permiso de notificaciones y exclusión de la app de optimización de batería.
5. Preferiblemente cargador conectado durante las consultas.

La APK mantiene un servicio Android en primer plano y despierta según la
frecuencia guardada en Laujim. El servicio dispara el trabajo remoto; el
navegador y Turnstile se ejecutan en el entorno de Render/Browserless que ya
conoce los portales. Si un portal requiere intervención manual, se conserva el
estado de error para revisarlo desde el panel o el PC worker.

## Cambiar de dispositivo

1. Instalar el mismo worker en el nuevo Android o PC.
2. Configurar la URL de Render y el token del worker.
3. Registrar el nuevo `deviceId` con `replaceExisting: true`.
4. Pulsar `Iniciar worker Android` o ejecutar el runner de Windows.
5. Verificar el último `heartbeat`, estado del worker y fecha `scrapedAt` en Laujim.

No se cambia el bot, el formato de WhatsApp ni la base de datos.

## Estado de los ejecutores

La pantalla `Worker scraper` ya está disponible dentro de la app y la APK
compilada incluye un servicio Android en primer plano. Al activar el worker,
la APK registra el dispositivo, consulta la frecuencia remota y dispara
`/worker/v1/run` ahora y en cada intervalo. Android puede retrasar una alarma
si el fabricante aplica restricciones agresivas; por eso se recomienda quitar
la optimización de batería y mantener el teléfono cargando.

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
