# Backup del WhatsApp Bot — Proyecto Sabanilla

**Fecha**: 26/07/2026
**Versión del bot**: v2.8.0
**Número del bot**: 573247916660
**Commit**: 30131cf

## Contenido

| Ruta | Descripción |
|------|-------------|
| `index.js` | Main del bot (514 líneas con ladder + auto-auth) |
| `src/` | Todos los módulos del bot |
| `data/grupos.json` | Mapeo apto → grupo WhatsApp |
| `data/session-store.json` | Sesiones activas de inquilinos |
| `data/baileys-sessions/` | Credenciales de autenticación multi-device |
| `.env` | Variables de entorno |
| `package.json` | Dependencias |

**Excluido**: carpeta `sessions/` (Playwright Chromium, no pertenece al bot).

## Estructura de archivos

```
whatsapp-bot-backup/
├── index.js                    # Main
├── package.json
├── package-lock.json
├── .env
├── .gitignore
├── qr.png
├── data/
│   ├── grupos.json             # { "101": "120363...@g.us" }
│   ├── session-store.json      # Sesiones activas
│   └── baileys-sessions/       # Auth multi-device
├── src/
│   ├── api-client.js           # Cliente API (login, getApartmentByName, getTenantByPhone)
│   ├── auth-flow.js            # Auto-auth + auth manual
│   ├── message-relay.js        # Relay bidireccional + ladder
│   ├── admin-cmds.js           # /session, /who, /close, /status, /ping
│   ├── session-store.js        # Persistencia de sesiones (timeout 30min)
│   ├── scripts.js              # Templates (adminName configurable)
│   ├── logger.js               # Logs sin límite
│   ├── notify.js               # HTTP server (QR, pairing, logs, ladder)
│   ├── heartbeat.js            # Heartbeat de conexión
│   └── ladder.js               # Trazabilidad de delivery (300 entradas)
└── node_modules/               # Dependencias instaladas
```

## Variables de entorno (`.env`)

| Variable | Valor | Notas |
|----------|-------|-------|
| `BOT_ADMIN_TOKEN` | `inxyu8VE0eHdUjFSz7kapo94DCTmbJOq` | Auth entre servicios |
| `PORT` | `10000` | Puerto del bot |
| `BOT_PROXY` | `http://wdybipfu:xxx@31.59.20.176:6754` | Proxy (ocultar pass) |
| `API_BASE_URL` | `https://laujim-app.onrender.com/api` | API principal |
| `AUTH_TOKEN` | `laujim laujim` | Token API |
| `WHATSAPP_BOT_URL` | `https://laujim-whatsapp-bot.onrender.com` | URL del bot |
| `BOT_IS_EXTERNAL` | `true` | Servicio separado |

## Cómo restaurar

```bash
cd "C:\Users\jimca\OneDrive\Escritorio\Proyecto Laujim APP fix"

# Opción 1: Reemplazar carpeta actual
Remove-Item -Path "whatsapp-bot" -Recurse -Force
Copy-Item -Path "whatsapp-bot-backup" -Destination "whatsapp-bot" -Recurse

# Opción 2: Restaurar solo archivos específicos
Copy-Item -Path "whatsapp-bot-backup\index.js" -Destination "whatsapp-bot\index.js"
Copy-Item -Path "whatsapp-bot-backup\src" -Destination "whatsapp-bot\src" -Recurse

# Instalar dependencias
cd whatsapp-bot
npm install

# Iniciar
node index.js
```

## Datos sensibles

| Dato | Valor |
|------|-------|
| Contraseña admin app | `laujim123` |
| Pregunta secreta | "¿Apellidos de tu esposa?" |
| Respuesta secreta | `Quessep Martelo` |

## Funcionalidades en desarrollo (Proyecto Sabanilla)

- [ ] Relay de fotos, videos y PDFs
- [ ] Auto-creación de grupos WhatsApp
- [ ] Menú interactivo (aptos disponibles)
- [ ] Captura de leads
- [ ] Configuración avanzada protegida
