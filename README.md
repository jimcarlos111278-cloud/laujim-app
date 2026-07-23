# Gestión de Apartamentos — Laujim APP

> **⚠️ REGLAS DEL REPOSITORIO**
> 1. **Cada cambio que se haga en el código debe actualizar este README** — si agregas, modificas o eliminas funcionalidad, configuración, dependencias, rutas, endpoints, schemas o scripts, debes reflejarlo aquí.
> 2. **Cada cambio debe registrarse en la sección [Historial de Cambios](#historial-de-cambios)** al final del README, con fecha, versión, y descripción técnica.
> 3. Este README es la fuente de verdad del proyecto. Si algo no está documentado aquí, no existe oficialmente.

---

## Tabla de Contenidos

1. [Arquitectura del Sistema](#arquitectura-del-sistema)
2. [Stack Tecnológico Detallado](#stack-tecnológico-detallado)
3. [Estructura del Proyecto](#estructura-del-proyecto)
4. [Configuración Específica por Archivo](#configuración-específica-por-archivo)
5. [Sistema de Temas (6 Temas Visuales)](#sistema-de-temas-6-temas-visuales)
6. [Force Desktop Layout (APK + Mobile Web)](#force-desktop-layout-apk--mobile-web)
7. [API REST Completa](#api-rest-completa)
8. [Rutas del Frontend](#rutas-del-frontend)
9. [Base de Datos en Memoria](#base-de-datos-en-memoria)
10. [Persistencia PostgreSQL](#persistencia-postgresql)
11. [Datos Iniciales (Seed)](#datos-iniciales-seed)
12. [Sistema de Autenticación](#sistema-de-autenticación)
13. [Sistema de Chat](#sistema-de-chat)
14. [Servicios Públicos y QR de Pago](#servicios-públicos-y-qr-de-pago)
15. [Consulta de Antecedentes (Policía)](#consulta-de-antecedentes-policía)
16. [Impuesto Predial](#impuesto-predial)
17. [Notificaciones](#notificaciones)
18. [Funciones Principales](#funciones-principales)
19. [Requerimientos del Sistema](#requerimientos-del-sistema)
20. [Instalación y Uso](#instalación-y-uso)
21. [Scripts Disponibles](#scripts-disponibles)
22. [APK Android — Problemas Conocidos](#apk-android--problemas-conocidos)
23. [Notas Regionales](#notas-regionales)
24. [Historial de Cambios](#historial-de-cambios)

---

## Arquitectura del Sistema

Aplicación web progresiva (PWA) + APK Android nativa para administración de apartamentos/residencias. Arquitectura **cloud-first**: los datos se cargan desde el servidor Express al iniciar y se mantienen sincronizados mediante polling bidireccional. No hay IndexedDB ni almacenamiento offline — la base de datos local es **en memoria** con API compatible con Dexie.

### Flujo de Datos

```
[Navegador / WebView Capacitor]
        │
        ├─► Carga inicial: GET /api/:collection (11 colecciones)
        │       │
        │       └─► db/database.js (en memoria) ← setCollectionData()
        │
        ├─► Polling cada 15s: refreshAllFromServer()
        │       │
        │       └─► Actualiza datos en memoria
        │
        ├─► Data version polling cada 3s: GET /api/data-version
        │       │
        │       └─► Recarga página si detecta cambios remotos
        │
        └─► CRUD: POST/PUT/DELETE directo al servidor
                │
                ├─► Actualiza memoria local inmediatamente
                │
                ├─► JSON: data/database.json
                │
                └─► PostgreSQL (opcional, via DATABASE_URL)
```

**Estrategia de Persistencia:**
- El servidor Express persiste en `data/database.json` (siempre activo)
- Si `DATABASE_URL` está configurada, también escribe en PostgreSQL (tabla `store`, clave-valor JSONB)
- Al arrancar, carga primero desde PostgreSQL; si falla o no está configurado, usa el JSON
- Respaldo automático en `backups/auto-latest.json` en cada escritura
- Cada 3s el cliente consulta `GET /api/data-version` y recarga la página si detecta cambios (con gracia de 12s para evitar doble recarga en inicio)
- El polling completo de datos cada 15s mantiene las colecciones sincronizadas entre dispositivos

### Viewport y Layout Adaptativo

- **Viewport**: En Capacitor o cuando `window.innerWidth < 900`, el meta tag viewport se fuerza a `width=1100` con escala calculada (`Math.max(0.3, w/1100)`). Script inline en `index.html` lo ejecuta antes del render.
- **Force Desktop**: En los mismos casos se agrega la clase `force-desktop` al `<html>`, que sobreescribe paddings, gaps, font-sizes y border-radius para que el layout se vea como desktop en pantallas pequeñas.
- **Sidebar siempre visible** a 176px (`w-44`) en modo force-desktop, sin hamburger toggle.

---

## Stack Tecnológico Detallado

| Capa | Tecnología | Versión | Propósito |
|------|-----------|---------|-----------|
| UI | React | ^19.2.7 | Renderizado de componentes |
| Router | React Router DOM | ^7.18.1 | Enrutamiento SPA cliente |
| Build | Vite | ^8.1.1 | Bundler + dev server |
| Plugin Vite | @vitejs/plugin-react | ^6.0.3 | Fast Refresh JSX |
| Estilos | Tailwind CSS | ^4.3.3 | Utility-first CSS + @custom-variant dark |
| Plugin Tailwind | @tailwindcss/vite | ^4.3.3 | Integración Vite + Tailwind v4 |
| DB en Memoria | Custom (API Dexie-compat) | — | Wrapper de arrays, 13 colecciones, 87 registros seed embebidos |
| Backend | Express | ^5.2.1 | API REST + static server + editor embebido |
| Mobile | Capacitor | ^8.4.2 | WebView Android nativo |
| QR Scanner | jsQR | ^1.4.0 | Decodificador QR puro JS |
| QR Generator | qrcode | ^1.5.4 | Generación de QR en canvas |
| Barcode Scanning (ML Kit) | @capacitor-mlkit/barcode-scanning | ^8.1.0 | Escaneo nativo en APK |
| Plugin Capacitor | @capacitor/share | ^8.0.1 | Share nativo (fotos / APK) |
| Plugin Capacitor | @capacitor/local-notifications | ^8.2.1 | Notificaciones locales en APK |
| Gráficos | Recharts | ^3.9.2 | Charting React (barras, circular) |
| PDF | jsPDF | ^4.2.1 | Exportar fichas PDF + contratos (18 cláusulas) |
| Íconos | Lucide React | ^1.25.0 | SVG icons |
| Subida archivos | Multer | ^2.2.0 | Multipart uploads (fotos + contratos PDF) |
| CORS | cors | ^2.8.6 | Cross-origin Express |
| PostgreSQL | pg | ^8.22.0 | Cliente PostgreSQL (opcional, via DATABASE_URL) |
| Linter | Oxlint | ^1.71.0 | Linting estático (Rust-based) |

---

## Estructura del Proyecto

```
Proyecto Laujim APP/
├── index.html                    # Entry point HTML (viewport script, SW condicional, overlay diagnóstico 8s)
├── vite.config.js                # Vite + React + Tailwind + proxy /api → :1011
├── server.cjs                    # Servidor Express (~704 líneas): API REST + PostgreSQL + editor embebido + police proxy
├── package.json                  # Dependencias (21 prod, 5 dev) y scripts
├── capacitor.config.json         # appId: com.laujim.aptmanager, scheme: http, allowNavigation
├── capacitor.json                # Duplicado legacy (appName con espacio)
├── db.cjs                        # Seed data inicial: 12 aptos, 11 inquilinos, 11 contratos, 7 pagos, 2 usuarios, 12 passwords
├── .oxlintrc.json                # Config linter (react/oxc plugins)
├── .build-state.json             # { "patch": 19, "version": "1.0.19" }
├── .gitignore
│
├── public/
│   ├── manifest.json             # PWA: display standalone, theme_color #2563eb, icons SVG
│   ├── sw.js                     # Service Worker: network-first, notificationclick, cache v1
│   ├── icons.svg                 # Ícono SVG 512×512 (casa blanca, fondo azul #2563eb, rx=80)
│   ├── favicon.svg               # Favicon 48×48
│   └── app-debug.apk             # APK para descarga directa
│
├── src/
│   ├── main.jsx                  # Entry React: StrictMode, ErrorBoundary, boot con DOMContentLoaded
│   ├── App.jsx                   # Router + init: cloud-first (3 reintentos), polling cada 15s, version polling cada 3s, themes
│   ├── index.css                 # Tailwind v4 + @custom-variant dark + 6 temas CSS variables + force-desktop
│   ├── api.js                    # Capa cloud: CRUD directo al servidor, refreshAllFromServer(), version polling
│   ├── db/
│   │   └── database.js           # 13 colecciones en memoria, API Dexie-compatible, seed data embebido
│   ├── components/
│   │   ├── Layout.jsx            # Sidebar 13 items, conexión indicador, ThemeSelector dropdown en footer
│   │   ├── Modal.jsx             # Modal/dialog reutilizable con overlay
│   │   ├── StatsCard.jsx         # Tarjeta de estadística con ícono y color
│   │   ├── PaymentHistoryChart.jsx # Gráfico de barras Recharts (12 meses, verde/rojo/gris)
│   │   ├── ErrorBoundary.jsx     # Class component, captura errores render, pantalla con botón recargar
│   │   ├── ThemeSelector.jsx     # Dropdown (sidebar/Dashboard) o swatches (Settings), 6 temas
│   │   └── VersionBanner.jsx     # Banner actualización: PWA auto-reload 3s, APK descarga nueva versión
│   ├── pages/
│   │   ├── Dashboard.jsx         # Stats, ocupación, pagos (overdue/this-month/next-month sortable), imprevistos
│   │   ├── Apartments.jsx        # Lista con búsqueda, filtros, CRUD
│   │   ├── ApartmentDetail.jsx   # Fotos (subida data URI), familia, contratos, finanzas, QR pago servicios
│   │   ├── Tenants.jsx           # Inquilinos con teléfono trabajo, dirección trabajo, documentoId, WhatsApp
│   │   ├── BackgroundCheck.jsx   # Antecedentes policiales: auto-check vía server, captcha proxy/iframe, manual
│   │   ├── Contracts.jsx        # Contratos con subida PDF
│   │   ├── Payments.jsx         # Pagos renta + gastos con filtros y búsqueda
│   │   ├── Utilities.jsx        # Servicios públicos: cards por apto, QR/Pagar/Escanear por servicio
│   │   ├── Reports.jsx          # Gráficos Recharts: ingresos vs gastos, circular categorías
│   │   ├── Predial.jsx          # Impuesto predial: ref catastral + link consulta Orion
│   │   ├── ShareApartments.jsx  # HTML público, PDF, WhatsApp, Gmail de vacantes
│   │   ├── ContractGenerator.jsx # 18 cláusulas legales, jsPDF, auto-guardado en BD
│   │   ├── Chat.jsx             # Chat admin ↔ inquilinos, presencia, polling 3s
│   │   ├── PublicApartments.jsx # Página pública de vacantes (sin auth)
│   │   ├── Settings.jsx         # Temas (6 visuales), notificaciones, passwords inquilinos, reset DB, logout
│   │   ├── Login.jsx            # Login admin + inquilino
│   │   └── MiApto.jsx           # Vista inquilino: pago, servicios, contrato, dot presencia admin
│   └── utils/
│       ├── config.js            # DEFAULT_SERVER, getBase() con detección Capacitor/PWA/browser, photoUrl()
│       ├── helpers.js           # formatCurrency(COP), formatDate, daysUntil, periods, etc.
│       ├── auth.js              # loginAdmin, loginTenant, getAuth, setAuth, clearAuth, isAdmin, isTenant
│       ├── chat.js              # sendMessage, sendHeartbeat, pollNewMessages, startChatPoll, getStatusLabel
│       ├── theme.js             # 6 temas: getTheme, setTheme, initTheme, loadThemeFromServer, syncThemeToServer
│       ├── sync.js              # isServerAvailable() con timeout 10s
│       ├── notifications.js     # requestNotificationPermission, notifyPaymentReminder (browser)
│       ├── localNotifications.js # schedulePaymentReminders, cancelAllNotifications (Capacitor)
│       ├── calendar.js          # ICS generation (OBSOLETO)
│       ├── clipboard.js         # copyToClipboard con fallback, openUrl
│       ├── contractGenerator.js # PDF contrato 18 cláusulas, números a letras español
│       ├── pdf.js               # Ficha apto PDF + HTML público
│       ├── generate-apartments-html.js # HTML standalone vacantes con fotos base64
│       └── darkMode.js          # (OBSOLETO, reemplazado por theme.js)
│
├── android/                      # Proyecto Android (Capacitor 8)
│   ├── app/src/main/AndroidManifest.xml  # usesCleartextTraffic=true, INTERNET, POST_NOTIFICATIONS
│   ├── app/build.gradle          # compileSdk 36, minSdk 23, targetSdk 36, namespace com.laujim.aptmanager
│   └── gradle/
│
├── dist/                         # Build producción Vite
│   ├── version.json              # { version, build, patch, date, time }
│   ├── app-debug.apk             # APK copiado
│   └── assets/                   # app.[hash].js, [name].[hash].js, [name].[hash][extname]
│
├── editor/                       # Editor de código embebido (auth Basic: admin/admin123)
│   └── index.html
│
├── data/
│   └── database.json             # Persistencia servidor (JSON)
│
├── backups/
│   ├── auto-latest.json          # Backup automático en cada saveData()
│   └── database-*.json           # Backups históricos con timestamp
│
├── uploads/
│   ├── photos/                   # Fotos de apartamentos (subidas como archivos)
│   └── contracts/                # Contratos PDF subidos
│
├── extension/                     # Chrome Extension: auto-fill Facebook Marketplace
│   ├── manifest.json              # MV3, permissions: storage+tabs, host: Render+FB
│   ├── content-laujim.js          # Captura datos de Marketplace desde Laujim
│   ├── content-facebook.js        # Detecta FB Marketplace y rellena campos + fotos
│   ├── background.js              # Service worker: almacena datos, URLs guardadas
│   ├── popup.html / popup.js      # Popup: estado, auto-llenar, anuncios guardados
│   └── icons/icon128.png          # Icono de la extensión
│
├── scripts/
│   ├── generate-version.js       # Genera dist/version.json al build
│   ├── copy-apk.js               # Copia APK de android/ a dist/ y public/
│   ├── fix-html.js               # Fix HTML post-build
│   ├── add-passwords.js          # Genera passwords aleatorios y actualiza seeds
│   ├── seed-data.js              # Seed data helper
│   ├── sync-seed.js              # Descarga datos del servidor, actualiza db.cjs + seeds
│   ├── backup.js                 # Backup de datos
│   └── deploy-snapshot.cjs       # Pre-deploy backup commit
│
├── build-apk.ps1                 # Script PowerShell: build → cap copy → assembleDebug
├── setup-java.ps1                # Configurar JAVA_HOME (Eclipse Adoptium JDK 21)
├── setup-android-sdk.ps1         # Configurar ANDROID_HOME
├── find-jdk21.ps1                # Buscar JDK 21 en sistema
├── crear-acceso-directo.ps1      # Acceso directo escritorio
├── backup.bat / backup.ps1       # Scripts backup
├── exportar-backup.bat / .ps1    # Exportar backup
├── iniciar-servidor.bat          # Menú interactivo modos
├── iniciar-servidor-sync.bat     # Build + servidor Express
├── iniciar-auto.bat              # Auto-start
├── iniciar-tunel.bat             # Tunnel (serveo/playit)
└── start-forever.bat             # Keep-alive loop
```

---

## Configuración Específica por Archivo

### `vite.config.js` — Build & Dev Server

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:1011', changeOrigin: true },
    },
  },
  build: {
    cssMinify: true,
    rollupOptions: {
      external: ['@capacitor/filesystem', '@capacitor/share', '@capacitor/core'],
      output: {
        entryFileNames: 'assets/app.[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
})
```

### `index.html` — Entry Point

- **Viewport dinámico**: script inline antes del render que calcula `width=1100` con escala cuando `window.innerWidth < 900` o Capacitor está presente. Esto asegura que el layout desktop se vea correctamente en pantallas de celular sin zoom.
- **Service Worker condicional**: si detecta Capacitor o cordova, desregistra cualquier SW y limpia caches; caso contrario registra `sw.js`.
- **Overlay de diagnóstico**: si React no monta en 8 segundos, muestra pantalla con UA, errores JS capturados (onerror + unhandledrejection), y botón recargar.
- **Meta tags**: PWA (`theme-color=#2563eb`, `apple-mobile-web-app-capable=yes`, `apple-touch-icon`, `apple-touch-startup-image`).
- **Loading state**: emoji 🏠 + "Cargando Gestión de Apartamentos..." mientras React bootea.

### `capacitor.config.json` — Capacitor 8

```json
{
  "appId": "com.laujim.aptmanager",
  "appName": "GestionApartamentos",
  "webDir": "dist",
  "server": {
    "hostname": "localhost",
    "androidScheme": "http",
    "allowNavigation": [
      "192.168.1.*", "192.168.0.*", "10.0.2.*", "localhost", "127.0.0.1"
    ]
  }
}
```

- `capacitor.json` existe como duplicado con `"appName": "Gestion Apartamentos"` (con espacio) para compatibilidad legacy.

### `server.cjs` — Servidor Express

**Variables de entorno:**

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `1011` | Puerto del servidor |
| `DATABASE_URL` | — | Conexión PostgreSQL opcional (`postgres://user:pass@host:5432/db`) |
| `PERSISTENT_DIR` | `__dirname` | Directorio para datos persistentes (útil en Render) |

**Auth API:** Header `x-auth-token: laujim laujim` en todas las rutas `/api/*` excepto:
- `POST /api/login`
- `GET /api/version`
- `GET /api/data-version`
- `GET /api/public/*`
- `GET/POST /api/antecedentes/police*`

**Middlewares en orden:**
1. `cors()` — expone `x-auth-token`, permite `Content-Type` y `x-auth-token`
2. `express.json({ limit: '50mb' })` — para fotos como data URI
3. Auth middleware — valida token en rutas protegidas
4. Static `uploads/` — sirve fotos y contratos
5. Static `dist/` — sirve build producción
6. Catch-all SPA — envía `dist/index.html` para routing React

**Colecciones manejadas automáticamente via rutas genéricas:**

`apartments`, `tenants`, `contracts`, `payments`, `expenses`, `utilityPayments`, `vacancies`, `familyMembers`, `users`, `settings`, `photos`, `passwords`, `messages`, `presence`

### `src/utils/config.js` — Conexión al Servidor

```js
export const AUTH_TOKEN = 'laujim laujim';
const DEFAULT_SERVER = 'https://laujim-app.onrender.com';
```

**Reglas de resolución de base URL (`getBase()`):**
1. **OBSOLETO**: `localStorage.apt_server_url` (ya no configurable)
2. **Capacitor APK** → `DEFAULT_SERVER + '/api'`
3. **PWA standalone** → `DEFAULT_SERVER + '/api'`
4. **Navegador normal** → `window.location.origin + '/api'`

**`photoUrl(photo)`**: soporta data URIs (`photo.data`), URLs relativas, URLs absolutas.

### `src/main.jsx` — Bootstrap React

```jsx
function boot() {
  createRoot(document.getElementById('root')).render(
    <StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>
  );
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
```

### `src/App.jsx` — Router e Inicialización

**Secuencia de inicio (`useEffect`):**
1. `initDB()` — carga seed data embebido como respaldo local
2. `requestNotificationPermission()` — solicita permiso notificaciones navegador
3. `refreshAllFromServer()` — fetch de TODAS las colecciones del servidor (hasta 3 intentos con 5s entre fallos)
4. `startCloudPolling(15000)` — polling completo cada 15s para detectar cambios
5. `startDataVersionPolling(3000)` — polling de versión cada 3s para auto-reload
6. `loadThemeFromServer()` + `initTheme()` — carga tema del servidor o localStorage
7. `force-desktop` class si Capacitor o `window.innerWidth < 900`

**Spinner de carga:** mientras `loading=true`, muestra spinner + "Cargando datos del servidor..."

**Rutas protegidas:**
- `ProtectedRoute` → redirige a `/login` si no hay auth
- `AdminRoute` → redirige a `/mi-apto` si rol !== admin

---

## Sistema de Temas (6 Temas Visuales)

Gestionado por `src/utils/theme.js`. Reemplaza completamente el anterior `darkMode.js`.

### Temas disponibles

| ID | Label | Color primario | BG page | Texto | Icono |
|----|-------|---------------|---------|-------|-------|
| `claro` | Claro | white/gray | `#f3f4f6` | `#111827` | Sun |
| `oscuro` | Oscuro | dark gray | `#111827` | white | Moon |
| `rosa` | Rosa | `#be123c` | `#fdf2f8` | `#831843` | Palette |
| `verde` | Verde | `#15803d` | `#ecfdf5` | `#064e3b` | Palette |
| `azul` | Azul | `#0369a1` | `#f0f9ff` | `#0c4a6e` | Palette |
| `amarillo` | Amarillo | `#b45309` | `#fffbeb` | `#78350f` | Palette |

### Regla 60-30-10

- **60%**: Fondo de página teñido (`.bg-gray-100`, `.bg-gray-50` override por tema)
- **30%**: Cards blancas ligeramente teñidas (`.bg-white` override)
- **10%**: Color acento en botones, links, bordes, nav activo

### Implementación CSS (`src/index.css`)

Variables CSS por tema:
```css
:root, .theme-claro { --c-50: #eff6ff; --c-100: #dbeafe; --c-500: #3b82f6; --c-600: #2563eb; --c-700: #1d4ed8; }
.theme-rosa    { --c-50: #fff1f2; --c-500: #e11d48; --c-600: #be123c; --c-700: #9f1239; }
.theme-verde   { --c-50: #f0fdf4; --c-500: #16a34a; --c-600: #15803d; --c-700: #166534; }
.theme-azul    { --c-50: #f0f9ff; --c-500: #0284c7; --c-600: #0369a1; --c-700: #075985; }
.theme-amarillo { --c-50: #fffbeb; --c-500: #d97706; --c-600: #b45309; --c-700: #92400e; }
```

Temas pastel sobreescriben clases utilitarias:
```css
.theme-rosa .bg-gray-100 { background-color: #fce4ec; }
.theme-rosa .bg-white { background-color: #fff5f7; }
.theme-rosa .border-gray-200 { border-color: #f8d0db; }
```

### Utility classes

```css
.bg-c-50, .bg-c-100, .bg-c-500, .bg-c-600  /* backgrounds */
.text-c-500, .text-c-600, .text-c-700         /* text colors */
.border-c-500                                 /* border */
.hover\:bg-c-100:hover                        /* hover */
.btn-primary { background-color: var(--c-500); color: white; }
.nav-active { background-color: var(--c-50); color: var(--c-700); }
```

### Persistencia y Sincronización

- `localStorage.laujim-theme` guarda el ID del tema actual
- `setTheme(id, syncToServer=true)` aplica el tema y opcionalmente lo sincroniza al servidor (user admin, campo `theme`)
- `loadThemeFromServer()` carga preferencia desde el servidor al inicio
- El tema oscuro además aplica la clase `dark` en `<html>` para compatibilidad con Tailwind dark variant

### Componentes

- `ThemeSelector.jsx` — dos variantes:
  - `dropdown` (default): botón compacto con indicador de color, menú desplegable con los 6 temas
  - `swatches`: grilla de 6 botones circulares con check, usado en Settings
- Integrado en `Layout.jsx` (footer del sidebar) y `Settings.jsx`

---

## Force Desktop Layout (APK + Mobile Web)

Cuando `window.innerWidth < 900` o se detecta Capacitor, el layout se fuerza a modo desktop:

1. **Viewport**: `width=1100` con escala calculada (`Math.max(0.3, w/1100)`)
2. **Sidebar siempre visible** a 176px (`w-44`), sin botón hamburguesa
3. **Clase CSS**: `.force-desktop` en `<html>` aplica:
   - `font-size: 15px`
   - `padding: 0.6rem` (reduce `p-3`)
   - `gap: 0.6rem` (reduce `gap-3`)
   - `font-size: 1.25rem` (reduce `text-2xl`)
   - `border-radius: 0.6rem` (reduce `rounded-xl`)
4. **Layout mode**: `app-layout` class en el contenedor flex que ajusta tamaños de iconos, paddings, y texto en sidebar

---

## API REST Completa

Endpoint base: `https://laujim-app.onrender.com/api` (o `http://host:1011/api` local)
Auth header: `x-auth-token: laujim laujim`

### Endpoints Generales

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/api/version` | Versión del build (`version.json`) | No |
| GET | `/api/data-version` | Timestamp de última modificación de datos (para auto-reload) | No |
| GET | `/api/data/all` | Obtener TODAS las colecciones completas | Sí |
| POST | `/api/save` | Guardar todas las colecciones (bulk overwrite) | Sí |
| POST | `/api/reset-db` | Resetear DB a valores iniciales (borra database.json + uploads) | Sí |
| POST | `/api/login` | Login admin o inquilino | No |
| GET | `/api/public/vacants` | Apartamentos vacantes + fotos (público) | No |
| POST | `/api/presence/heartbeat` | Heartbeat de presencia (chat) | Sí |
| GET | `/api/messages/updates/:since` | Mensajes nuevos desde ISO timestamp | Sí |
| POST | `/api/bulk-add/:collection` | Crear múltiples registros | Sí |

### Endpoints de Antecedentes (Policía)

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/api/antecedentes/check` | Auto-check: scrapea página policía, extrae ViewState, postea cédula | Sí |
| GET | `/api/antecedentes/police-page?doc=ID` | Proxy: sirve página policial con base tag + auto-fill script | No |
| POST | `/api/antecedentes/police-submit?session=ID` | Proxy: reenvía form a policía, parsea resultado, postMessage | No |

### Endpoints de Archivos

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/api/upload/photo` | Subir foto (FormData: photo + apartmentId) | Sí |
| DELETE | `/api/photo/:id` | Eliminar foto (archivo + DB) | Sí |
| POST | `/api/upload/contract` | Subir contrato PDF (FormData: contract + contractId) | Sí |
| POST | `/api/generate-contract` | Iniciar generador Python local de contratos | Sí |

### Endpoints Genéricos (CRUD Automático)

Para cualquier colección en `db`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/:collection` | Listar todos |
| GET | `/:collection/count` | Contar |
| GET | `/:collection/:id` | Obtener por ID |
| GET | `/:collection/where/:field/:value` | Filtrar por campo exacto |
| GET | `/:collection/first/:field/:value` | Primer match |
| GET | `/:collection/filter/:field/:value` | Filtrar (alias) |
| POST | `/:collection` | Crear (autogenera id) |
| PUT | `/:collection/:id` | Actualizar |
| DELETE | `/:collection/:id` | Eliminar |

### Editor API (auth Basic: admin/admin123)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/editor/api/list?dir=...` | Listar archivos del proyecto |
| GET | `/editor/api/read?file=...` | Leer archivo |
| POST | `/editor/api/write` | Escribir archivo |
| POST | `/editor/api/exec` | Ejecutar comando (max 500 chars, timeout 30s) |
| GET | `/editor/*` | Static files del editor |

---

## Rutas del Frontend

| Ruta | Componente | Descripción | Auth |
|------|-----------|-------------|------|
| `/login` | `Login.jsx` | Login admin (admin/laujim123) o inquilino (apto/código 4 dígitos) | No |
| `/mi-apto` | `MiApto.jsx` | Vista inquilino: info pago, servicios, contrato, dot presencia admin | No |
| `/publico` | `PublicApartments.jsx` | Lista pública vacantes (sin auth, enlace compartible) | No |
| `/dashboard` | `Dashboard.jsx` | Stats generales, ocupación, pagos sortables, imprevistos | Admin |
| `/apartments` | `Apartments.jsx` | CRUD apartamentos con búsqueda | Admin |
| `/apartments/:id` | `ApartmentDetail.jsx` | Detalle: fotos, familia, contratos, finanzas, QR pago servicios, ref catastral | Admin |
| `/tenants` | `Tenants.jsx` | CRUD inquilinos con documentoId, trabajo, WhatsApp | Admin |
| `/background-check` | `BackgroundCheck.jsx` | Auto-check antecedentes, captcha proxy/iframe, marcado manual | Admin |
| `/contracts` | `Contracts.jsx` | Contratos con subida PDF | Admin |
| `/payments` | `Payments.jsx` | Pagos renta + gastos, filtros | Admin |
| `/utilities` | `Utilities.jsx` | Servicios públicos: cards por apto, QR/Pagar/Escanear por servicio | Admin |
| `/predial` | `Predial.jsx` | Impuesto predial: ref catastral + link consulta Orion | Admin |
| `/reports` | `Reports.jsx` | Gráficos Recharts: ingresos vs gastos, circular categorías | Admin |
| `/share` | `ShareApartments.jsx` | Compartir HTML, PDF, WhatsApp, Gmail de vacantes | Admin |
| `/chat` | `Chat.jsx` | Chat admin ↔ inquilinos, presencia, sala general | Admin |
| `/generate-contract` | `ContractGenerator.jsx` | Generar contrato arrendamiento 18 cláusulas | Admin |
| `/generate-contract/:id` | `ContractGenerator.jsx` | Precargado con datos del apto | Admin |
| `/settings` | `Settings.jsx` | 6 temas, notificaciones, passwords inquilinos, reset DB, logout | Admin |
| `*` | → `/dashboard` | Redirección default | Admin |

---

## Base de Datos en Memoria

Archivo: `src/db/database.js`

**Reemplazo completo de Dexie/IndexedDB.** Implementación propia con API compatible con Dexie.

### 13 Colecciones

```js
const collections = [
  'apartments', 'tenants', 'contracts', 'payments', 'expenses',
  'utilityPayments', 'vacancies', 'familyMembers', 'settings',
  'passwords', 'photos', 'messages', 'users'
];
```

### API por colección

```js
db[name].toArray()           // → Promise<array>
db[name].get(id)             // → Promise<item|null>
db[name].add(item)           // → Promise<id> (auto-genera id)
db[name].put(item)           // → Promise<id> (upsert)
db[name].update(id, changes) // → Promise<1|0>
db[name].delete(id)          // → Promise<1|0>
db[name].clear()             // → Promise<void>
db[name].count()             // → Promise<number>
db[name].bulkAdd(items)      // → Promise<void>
db[name].where(field).equals(val).toArray()
  .first()
  .sortBy(field)
  .delete()
db[name].where({ field1: val1, field2: val2 }).toArray()
  .first()
  .delete()
db[name].where(field).above(val).toArray()
db[name].where(field).between(low, high).toArray()
db[name].orderBy(field).toArray()
```

### Funciones de manipulación

```js
setCollectionData(name, items)    // Reemplaza contenido (protege contra arrays vacíos)
pushToCollection(name, item)      // Agrega al final
removeFromCollection(name, id)    // Elimina por ID
replaceInCollection(name, id, item) // Reemplaza o agrega
```

### Seed Data Embebido

87 registros en total:
- 2 usuarios (admin/invitado)
- 12 apartamentos (101-501)
- 11 inquilinos (Luna, Samir, Cisney, Valery, Eukaris, Johovana, Edwin, Adela, Carlos, Yoeli, Dayanna)
- 11 contratos
- 7 pagos de renta (julio 2026)
- 12 passwords (admin + 11 inquilinos)

---

## Persistencia PostgreSQL

Activada cuando la variable de entorno `DATABASE_URL` está configurada en el servidor.

### Esquema

```sql
CREATE TABLE IF NOT EXISTS store (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
```

### Flujo

```
startServer()
  ├─► initPostgres(): crea Pool + tabla store
  ├─► loadFromPostgres(): SELECT value FROM store WHERE key = 'database'
  │     └─► Si hay datos: db = pgData (ignora JSON file)
  │     └─► Si no hay: loadData() desde JSON → saveToPostgres() (inicializa)
  └─► saveData(): escribe JSON file + fire-and-forget saveToPostgres()
```

Cada `saveData()` escribe tanto en `data/database.json` como en PostgreSQL (fire-and-forget, no bloquea). Al arrancar, PostgreSQL tiene prioridad sobre el archivo JSON.

### Configuración SSL

```js
pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
```

---

## Datos Iniciales (Seed)

### Usuarios

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `admin` | `laujim123` | owner |
| `invitado` | `invitado123` | guest |

### Apartamentos (12 unidades)

| ID | Nombre | Piso | Canón | Día Pago | Código Agua | Código Gas | Código Luz |
|----|--------|------|-------|----------|-------------|------------|------------|
| 1 | 101 | 1 | $0 | 5 | 11156 | 1036207 | — |
| 2 | 102 | 1 | $750,000 | 5 | 40135611 | 1036207 | — |
| 3 | 201 | 2 | $1,000,000 | 20 | 975250 | 66499522 | — |
| 4 | 202 | 2 | $1,000,000 | 9 | 975249 | 66499584 | — |
| 5 | 203 | 2 | $1,000,000 | 11 | 975247 | 66499518 | 7809672 |
| 6 | 301 | 3 | $1,100,000 | 24 | 975245 | 66499585 | 7889031 |
| 7 | 302 | 3 | $1,000,000 | 12 | 975244 | 66499526 | 7889033 |
| 8 | 303 | 3 | $1,000,000 | 6 | 974325 | 66499577 | 7889034 |
| 9 | 401 | 4 | $1,300,000 | 15 | 937381 | 66499532 | 7889036 |
| 10 | 402 | 4 | $950,000 | 5 | 800804 | 66499573 | 7889037 |
| 11 | 403 | 3 | $1,000,000 | 20 | 937380 | 66499604 | 7889039 |
| 12 | 501 | 5 | $1,550,000 | 10 | 935937 | 67426719 | — |

Todos con `status: "occupied"`, `waterReadingDay: 7`, `electricityReadingDay: 21`.

### Contraseñas de Inquilinos (4 dígitos)

| Apartamento | Password |
|------------|----------|
| 102 | 2779 |
| 201 | 6364 |
| 202 | 8808 |
| 203 | 2113 |
| 301 | 5082 |
| 302 | 8183 |
| 303 | 6493 |
| 401 | 3213 |
| 402 | 2365 |
| 403 | 5326 |
| 501 | 6494 |

---

## Sistema de Autenticación

Archivo: `src/utils/auth.js`

### Login Admin

```js
loginAdmin('admin', 'laujim123')
// → { ok: true, role: 'admin' }
```

### Login Inquilino

```js
loginTenant('102', '2779')
// Busca apto por name, verifica password en db.passwords, busca contrato vigente + inquilino
// → { ok: true, role: 'tenant', apartmentId: 2 }
```

### Sesión

- Persistencia en `localStorage.apt_auth` como JSON: `{ role, username, name, apartmentId }`
- No hay JWT ni sesiones server-side
- Cada request lleva `x-auth-token: laujim laujim` en el header
- `getAuth()`, `setAuth(data)`, `clearAuth()`, `isAdmin()`, `isTenant()`, `getTenantApartmentId()`

---

## Sistema de Chat

Archivo: `src/utils/chat.js`

Arquitectura **polling-based** (no WebSockets). Mensajes y presencia se sincronizan mediante requests HTTP periódicos.

### Componentes

| Función | Descripción |
|---------|-------------|
| `sendMessage(roomId, from, to, content)` | Envía mensaje al servidor (POST /api/messages) |
| `sendHeartbeat(userId, status)` | Heartbeat de presencia (POST /api/presence/heartbeat) cada 10s |
| `pollNewMessages()` | Polling incremental: GET /api/messages/updates/:since (cada 3s) |
| `startChatPoll(callback, 3000)` | Inicia polling de mensajes |
| `startHeartbeat(userId, 10000)` | Inicia heartbeat |
| `startPresencePoll(callback, 5000)` | Inicia polling de presencia |
| `getStatusLabel(presence, userId)` | Estado legible: "En línea", "Ausente", "Última conexión hace Xs/min/h/d/meses" |
| `getRoomMessages(roomId)` | Mensajes de una sala ordenados por fecha |
| `getAllRooms(auth)` | Salas disponibles según rol (admin ve todas, inquilino ve su apto) |

### Estados de Presencia

- `online` + `lastSeen < 15s` → verde "En línea"
- `away` o `online` + `lastSeen < 60s` → ámbar "Ausente"
- `lastSeen > 60s` → rojo "Última conexión hace X..."
- Sin registro → rojo "Nunca conectado"

### Rooms

- `general`: Sala general (todos los usuarios)
- `admin-{aptId}`: Sala privada entre admin e inquilino del apto

---

## Servicios Públicos y QR de Pago

### Página Utilities (`/utilities`)

Diseño de **cards por apartamento**, cada una con 3 paneles de servicio:

```
┌─────────────────────────────────┐
│  Apartamento 203                │
│  ┌─────────────────────────────┐│
│  │ 💧 Agua (Triple A)          ││
│  │ 975247 · Lectura día 7      ││
│  │ [QR] [Pagar] [Escanear]    ││
│  ├─────────────────────────────┤│
│  │ 🔥 Gas (Gases del Caribe)  ││
│  │ 66499518 · Lectura día 7    ││
│  │ [QR] [Pagar] [Escanear]    ││
│  ├─────────────────────────────┤│
│  │ ⚡ Electricidad (Air-e)     ││
│  │ 7809672 · Lectura día 21    ││
│  │ [QR] [Pagar] [Escanear]    ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

- **QR**: Muestra código QR generado con la librería `qrcode` a partir de la URL de pago guardada
- **Pagar**: Abre la URL de pago (nueva pestaña en web, navegador externo en APK)
- **Escanear**: Abre la cámara (o selector de archivos si no hay cámara), decodifica QR con `jsQR`, guarda la URL en el apartamento
- **Air-e auto-NIC**: Si no hay NIC guardado, solicita el código al usuario; si ya existe, genera la URL de pago automáticamente

### Almacenamiento

Las URLs de pago se guardan por apartamento en campos:
- `waterPaymentUrl`
- `gasPaymentUrl`
- `electricityPaymentUrl`
- `nic` (NIC de Air-e para autogenerar URL)

### Escáner QR

- Flujo: `getUserMedia` → video stream → canvas (640px max) → `BarcodeDetector` API → fallback `jsQR` → resultado
- Ref-based para evitar stale closures
- `createImageBitmap` para escaneo desde archivo
- Modal modal de selección: cámara o archivo
- `@capacitor-mlkit/barcode-scanning` importado dinámicamente para evitar crash en web

---

## Consulta de Antecedentes (Policía)

Página: `BackgroundCheck.jsx` (sub-item "Antecedentes" bajo "Inquilinos" en sidebar, indentado, icono Shield)

### Auto-Check (API Server-Side)

`POST /api/antecedentes/check` con body `{ document: "cedula" }`:

1. `GET https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml`
2. Extrae `javax.faces.ViewState` del HTML
3. Extrae `action` del formulario (para resolver URL relativa)
4. `POST` al actionUrl con: `cedulaInput={document}`, `javax.faces.ViewState=...`, `g-recaptcha-response=''`
5. Sigue redirects 302 (GET), pasa cookies
6. Analiza respuesta:
   - `"NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES"` → `clean`
   - `"REGISTRA ANTECEDENTES"`, `"TIENE ANTECEDENTES"`, `"CON ANTECEDENTES"`, `"SÍ REGISTRA"` → `flagged`
   - `reCAPTCHA`, `g-recaptcha`, `data-sitekey`, `"Términos de uso"`, `"index.xhtml"` → `captcha`
   - Otro → `error` (con preview de 2000 chars en servidor log)

### Captcha Proxy Flow (Iframe)

Cuando el auto-check detecta captcha, la UI muestra un iframe:

1. `GET /api/antecedentes/police-page?doc=ID`:
   - Proxy GET a la página de policía
   - Inyecta `<base href="https://antecedentes.policia.gov.co:7005/WebJudicial/" />`
   - Reescribe form action a `/api/antecedentes/police-submit?session=UUID`
   - Inyecta script para auto-llenar `cedulaInput` con el ID del inquilino
   - Guarda cookies + formAction en `policeCookieStore` keyeado por session UUID

2. `POST /api/antecedentes/police-submit`:
   - Recupera session del query param
   - Proxy POST al form action original con cookies almacenadas
   - Sigue redirects 302
   - Responde con `<script>window.parent.postMessage({status, detail}, "*")</script>`

3. **Resultados posibles del postMessage:**
   - `{ status: "clean" }` → sin antecedentes
   - `{ status: "flagged", detail }` → con antecedentes
   - `{ status: "captcha", detail }` → requiere captcha
   - `{ status: "error", detail }` → error inesperado

### Marcado Manual

Si ambos flujos fallan, el admin puede marcar manualmente el estado del inquilino: "Sin antecedentes" o "Con antecedentes".

---

## Impuesto Predial

Página: `Predial.jsx` (sub-item "Impuesto predial" bajo "Apartamentos" en sidebar)

### Funcionamiento

- Lista todos los apartamentos con su referencia catastral (`refCatastral`)
- Las referencias se almacenan en un mapa estático (`REF_MAP`) dentro del componente
- Cada apartamento tiene un botón "Consulta" que abre:
  ```
  https://orion.barranquilla.gov.co:8787/Predial/BuscarPredioLiq.do?txtDato={REFCAT}&txtTipoBusqueda=PorReferencia
  ```
- El campo `refCatastral` se puede editar en el formulario de ApartmentDetail (sección "Especificaciones")

---

## Notificaciones

### Notificaciones del Navegador (`src/utils/notifications.js`)

```js
requestNotificationPermission()  // Notification.requestPermission()
notifyPaymentReminder(aptName, daysLeft)
  // daysLeft ≤ 0 → "Pago vencido"
  // daysLeft ≤ 1 → "Pago mañana"
  // daysLeft ≤ 3 → "Pago próximo"
```

### Notificaciones Locales APK (`src/utils/localNotifications.js`)

- Usa `@capacitor/local-notifications`
- Configuración persistente en `localStorage.laujim-notif-config`
- `schedulePaymentReminders(apartments)`: agenda notificaciones para recordatorio de pago (X días antes) y día de vencimiento
- `cancelAllNotifications()`: cancela todas las notificaciones programadas
- Config: `{ enabled: boolean, daysBefore: number }`

---

## Funciones Principales

| Módulo | Descripción |
|--------|-------------|
| **Dashboard** | Estadísticas: ocupación, ingresos mensuales esperados, total recaudado histórico, recaudado este mes, pagos pendientes, próximos pagos con cuenta regresiva, alerta vacantes, botón "Imprevistos" para gastos. Secciones de pago sortables por "Núm. Apartamento" y "Próximo a vencer" |
| **Apartamentos** | CRUD: nombre, descripción, canon, depósito, día de pago, habitaciones, baños, área, piso, estado, días de lectura servicios, NIC, ref catastral |
| **Detalle Apartamento** | Múltiples fotos (subida data URI), inquilino actual, historial contratos, familiares, historial pagos/gastos, vacancias, servicios públicos, QR pago servicios, exportar PDF, compartir WhatsApp |
| **Inquilinos** | CRUD: nombre, email, teléfono, teléfono trabajo, dirección trabajo, documentoId, notas, WhatsApp, correo, historial contratos |
| **Contratos** | Creación con selección apto+inquilino, fechas, canon, depósito, subida PDF, cambio automático de apto a "ocupado" |
| **Pagos** | Registro renta (completo/parcial) y gastos (categorías: Mantenimiento, Reparación, Limpieza, Impuesto, Seguro, Adecuación, Otro), filtro tipo y búsqueda |
| **Servicios Públicos** | Cards por apto con 3 paneles (TripleA/Gas/Air-e), QR/Pagar/Escanear, URLs de pago persistidas en el apto, escáner QR con cámara |
| **Antecedentes** | Auto-check contra policía.gov.co, captcha proxy/iframe, marcado manual, historial por inquilino |
| **Impuesto Predial** | Lista de aptos con ref catastral, link consulta Orion, edición en ApartmentDetail |
| **Reportes** | Gráficos anuales: barras ingresos vs gastos vs neto, circular gastos por categoría, rentabilidad, rotación vacancias |
| **Compartir** | HTML público de vacantes, descarga, PDF, WhatsApp, Gmail |
| **Chat** | Mensajería admin ↔ inquilinos, salas por apto, presencia en línea/ausente/visto, polling 3s, heartbeat 10s |
| **Generar Contrato** | 18 cláusulas legales, jsPDF, números a letras, auto-guardado en BD (crea inquilino si no existe, cambia apto a ocupado) |
| **Facebook Marketplace** | Auto-llenado de anuncios con fotos desde la app mediante Chrome Extension. Botón "Auto-llenar" en detalle del apto: envía título, precio, descripción, specs y fotos a la extensión → se rellena solo en FB. Gestión de URLs guardadas con Abrir/Eliminar desde el popup de la extensión |
| **Configuración** | 6 temas visuales, notificaciones (navegador + APK), passwords inquilinos, reset DB, logout |

---

## Requerimientos del Sistema

### Para desarrollo/web local
- **Node.js** 18+ (probado con 22+)
- **npm** 9+

### Para compilar APK (Android)
- **Java JDK 21** (Eclipse Adoptium: `C:\Program Files\Eclipse Adoptium\jdk-21.x.x`)
- **Android SDK** (en `C:\Android`)
- Variables de entorno:
  - `JAVA_HOME` → ruta del JDK 21
  - `ANDROID_HOME` → `C:\Android`
  - `ANDROID_SDK_ROOT` → `C:\Android`

### Dependencias npm (21 production, 5 dev)

**Production:**
`react@^19.2.7`, `react-dom@^19.2.7`, `react-router-dom@^7.18.1`, `lucide-react@^1.25.0`, `recharts@^3.9.2`, `jspdf@^4.2.1`, `express@^5.2.1`, `multer@^2.2.0`, `cors@^2.8.6`, `tailwindcss@^4.3.3`, `@tailwindcss/vite@^4.3.3`, `@capacitor/core@^8.4.2`, `@capacitor/cli@^8.4.2`, `@capacitor/android@^8.4.2`, `@capacitor/share@^8.0.1`, `@capacitor/local-notifications@^8.2.1`, `@capacitor-mlkit/barcode-scanning@^8.1.0`, `dexie@^4.4.4`, `qrcode@^1.5.4`, `jsqr@^1.4.0`, `pg@^8.22.0`

**Dev:**
`vite@^8.1.1`, `@vitejs/plugin-react@^6.0.3`, `oxlint@^1.71.0`, `@types/react@^19.2.17`, `@types/react-dom@^19.2.3`

---

## Instalación y Uso

### 1. Instalar dependencias

```bash
cd "C:\Users\jimca\OneDrive\Escritorio\Proyecto Laujim APP"
npm install
```

### 2. Modos de ejecución

#### Desarrollo (solo este PC)
```bash
npm run dev
# Abre http://localhost:5173
# Proxy /api → http://localhost:1011 (servidor Express debe correr aparte)
```

#### Desarrollo (red local)
```bash
npm run network
# Accesible desde cualquier dispositivo en el mismo WiFi en http://192.168.x.x:5173
```

#### Servidor completo (compartido)
```bash
# Primero build:
npm run build
# Luego servidor:
node server.cjs
# Abre http://localhost:1011 (o http://192.168.x.x:1011 desde otros dispositivos)
# Incluye editor de código en /editor (auth: admin/admin123)
```

#### Servidor completo (un solo comando)
```bash
.\iniciar-servidor-sync.bat
# Build + servidor Express directo
```

#### Build de producción
```bash
npm run build
# Genera dist/ con version.json, fix-html
```

#### Preview del build
```bash
npm run preview
```

### 3. Compilar APK Android

```bash
npm run build-apk
# Equivalente a:
# npm run build
# npx cap copy android
# cd android && gradlew.bat assembleDebug
# cd .. && node scripts/copy-apk.js
```

El APK se genera en `android/app/build/outputs/apk/debug/app-debug.apk` y se copia a `dist/app-debug.apk` y `public/app-debug.apk`.

### 4. Sincronizar Seeds
```bash
npm run sync-seed
# Descarga datos del servidor y actualiza db.cjs + src/db/database.js
```

---

## Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Servidor dev Vite :5173 |
| `npm run build` | Build producción + version.json + fix-html |
| `npm run preview` | Preview del build |
| `npm run network` | Dev mode con `--host` (accesible en red) |
| `npm run lint` | Oxlint (react, oxc plugins) |
| `npm run build-apk` | Build web + compilar APK + copiar |
| `npm run sync-seed` | Descarga datos servidor, actualiza seeds |
| `npm start` | Inicia server Express |
| `node server.cjs` | Servidor Express :1011 + editor |
| `.\build-apk.ps1` | Script PowerShell build APK |
| `.\iniciar-servidor.bat` | Menú interactivo modos |
| `.\iniciar-servidor-sync.bat` | Build + servidor Express |
| `.\setup-java.ps1` | Configurar JAVA_HOME |
| `.\setup-android-sdk.ps1` | Configurar ANDROID_HOME |
| `.\find-jdk21.ps1` | Buscar JDK 21 |
| `.\exportar-backup.ps1` | Exportar backup |

---

## Extensión de Chrome — Llenar Laujim

Extensión que **auto-llena los anuncios de Facebook Marketplace** con los datos del apartamento desde Gestión Laujim. Incluye fotos, precio, descripción, número de habitaciones y baños.

### Arquitectura

La extensión se comunica con la app Laujim a través de un **elemento oculto en el DOM** (más fiable que `postMessage`):

```
[Laujim App] ──crea──► <div id="__LAUJIM_EXT_DATA__" /> ──lee──► [content-laujim.js]
                                                                    │
                                                              chrome.storage.local.set()
                                                                    │
[FB Marketplace] ◄──autoFill()──── [content-facebook.js] ◄──lee── chrome.storage.local.get()
```

### Instalación

1. Abrir `chrome://extensions`
2. Activar **Modo desarrollador** (esquina superior derecha)
3. "Cargar descomprimida" → seleccionar la carpeta `extension/`
4. Recargar la extensión después de cada actualización (🔄)

### Uso

1. En Laujim, ir al detalle de un apartamento **Disponible**
2. Hacer clic en **"Auto-llenar"** (sección Facebook Marketplace)
3. La app envía los datos a la extensión y espera confirmación
4. Se abre `https://www.facebook.com/marketplace/create/housing`
5. La extensión detecta la página, lee los datos y rellena automáticamente:
   - **Campos**: título, precio, descripción, habitaciones, baños, área
   - **Fotos**: las que tengan URL HTTP real (no data URI)
6. Aparece notificación verde "✓ Laujim: Campos: X · Fotos: Y"
7. Guardar la URL publicada desde Laujim (botón "Guardar URL")

### Popup de la extensión

- **Estado**: muestra si hay datos listos para auto-llenar
- **Auto-llenar ahora**: fuerza el llenado en la pestaña activa de FB
- **Anuncios guardados**: lista de URLs de publicaciones guardadas con botones Abrir/Eliminar

### Gestión de anuncios

- Guardar URL: en Laujim, botón "Guardar URL" → notifica a la extensión
- Eliminar URL: botón "Eliminar URL" en Laujim o desde el popup de la extensión
- Las URLs se almacenan en `chrome.storage.local`

---

### Pantalla en blanco
1. **`usesCleartextTraffic`**: Android 9+ bloquea HTTP. Ya agregado en `AndroidManifest.xml`.
2. **URL del servidor**: APK usa `DEFAULT_SERVER` (Render.com). Para servidor local, deben estar en misma red.
3. **Service Worker**: Deshabilitado automáticamente cuando se detecta Capacitor.
4. **`androidScheme: "http"`**: Configurado en `capacitor.config.json`.
5. **`allowNavigation`**: Capacitor 8 requiere whitelist de hosts.

### La app no carga en el navegador
1. Revisar consola (F12)
2. Overlay de diagnóstico aparece a los 8s con errores capturados
3. Verificar `npm install`

---

## Notas Regionales

- **Moneda**: COP (Peso Colombiano, formato `es-CO` con `Intl.NumberFormat`)
- **Idioma**: Español
- **Servicios públicos**: Barranquilla (Triple A, Gases del Caribe, Air-e)
- **Código país WhatsApp**: +57
- **Zona horaria**: America/Bogota
- **Impuesto predial**: Barranquilla (Orion)

---

## Historial de Cambios

### 2026-07-23 — v2.4.0 — Chrome Extension: auto-fill Facebook Marketplace con fotos
- **New**: `extension/` — Chrome Extension Manifest V3 completa:
  - `content-laujim.js`: captura datos desde Laujim via DOM bridge + postMessage
  - `content-facebook.js`: detecta FB Marketplace, rellena campos + sube fotos automáticamente, polling con reintentos hasta 45s, detección de navegación SPA
  - `background.js`: service worker, almacenamiento chrome.storage, gestión de URLs guardadas
  - `popup.html/js`: estado de datos, botón auto-llenar, lista de anuncios guardados con Abrir/Eliminar
- **New**: `src/pages/ApartmentDetail.jsx` — `autoFillMarketplace()` ahora espera confirmación de la extensión vía atributo `data-status` antes de abrir FB. Incluye URLs de fotos (excepto data URI) en los datos enviados. Botón "Eliminar URL" notifica a la extensión
- **New**: `src/utils/marketplaceBookmarklet.js` — `generateMarketplaceJson()` ahora acepta `photoUrls[]`, devuelve objeto (no string). Nueva `generateMarketplaceJsonString()` helper
- **New**: `src/pages/Settings.jsx` — sección de instalación de la extensión (emerald box), bookmarklet legacy colapsado en details
- **Fix**: comunicación app↔extensión ahora usa DOM hidden element + MutationObserver persistente + setInterval 1s (sin timeout) para máxima fiabilidad
- **Fix**: filtro de data URI en photoUrls para evitar exceder límite de chrome.storage
- **Update**: `README.md` — sección completa de la extensión, estructura, instalación y uso

### 2026-07-22 — v2.3.0 — Temas pastel inmersivos, antecedentes policiales, predial, PostgreSQL, QR escáner
- **New**: Sistema de 6 temas visuales (`src/utils/theme.js`): Claro, Oscuro, Rosa, Verde, Azul, Amarillo. Basado en regla 60-30-10 con CSS variables. Reemplaza `darkMode.js`.
- **New**: `src/index.css` — temas pastel inmersivos: sobreescribe `.bg-white`, `.bg-gray-50`, `.bg-gray-100`, `.border-gray-200`, `.hover\:bg-gray-50` por tema con tintes de color.
- **New**: `src/components/ThemeSelector.jsx` — selector dropdown (sidebar/Dashboard) y swatches (Settings) con 6 temas.
- **New**: `src/pages/BackgroundCheck.jsx` — consulta automática de antecedentes a la Policía Nacional (`antecedentes.policia.gov.co:7005`). Auto-check via server (extrae ViewState, postea cédula, parsea resultado). Captcha proxy/iframe flow (police-page + police-submit endpoints). Marcado manual como fallback.
- **New**: `server.cjs` — `POST /api/antecedentes/check`, `GET /api/antecedentes/police-page`, `POST /api/antecedentes/police-submit`. Funciones helper `proxyGet()`, `proxyPost()` con manejo de redirects 302 y cookies.
- **New**: `src/pages/Predial.jsx` — lista de apartamentos con referencia catastral, link a consulta Orion de Barranquilla.
- **New**: Campo `refCatastral` en formulario de edición de `ApartmentDetail.jsx`.
- **New**: `api.tenants.update(id, data)` en `src/api.js` (método faltante causaba `J.tenants.update is not a function`).
- **New**: PostgreSQL persistence via `DATABASE_URL` env var + `pg` package. Tabla `store(key, value JSONB)`. Prioridad sobre JSON al cargar.
- **New**: `POST /api/reset-db` endpoint para resetear DB a valores iniciales.
- **New**: `startDataVersionPolling()` en `src/api.js` — polling cada 3s de `/api/data-version`, recarga página en cambios. Grace period de 12s en startup para evitar doble recarga.
- **New**: `src/components/VersionBanner.jsx` — banner de nueva versión: en PWA auto-reload a los 3s (con cancelar), en APK link de descarga.
- **New**: Force-desktop viewport: script en `index.html` fuerza `width=1100` con escala cuando Capacitor o `innerWidth < 900`. Clase `.force-desktop` en CSS para ajustar paddings, gaps, font-sizes.
- **New**: Escáner QR integrado con `jsQR` + `BarcodeDetector` API + `@capacitor-mlkit/barcode-scanning` (dynamic import). Modal de cámara/archivo. Frames escalados a 640px max.
- **New**: Rediseño de `Utilities.jsx`: cards por apto con 3 paneles de servicio (QR/Pagar/Escanear). URLs de pago persistidas en campos del apto.
- **New**: `scripts/deploy-snapshot.cjs` — pre-deploy backup commit script.
- **Fix**: `src/db/database.js` — `setCollectionData()` muta in-place (`data[name].length = 0; data[name].push(...)`) en lugar de reasignar referencia. Protege contra arrays vacíos del servidor.
- **Fix**: `db.cjs` — `recalcNextId()` llamado en `loadData()`, startup PostgreSQL, y `reset-db`.
- **Fix**: Chat `getRoomStatus` usa formato `apt-{id}` para userId (alineado con heartbeat schema).
- **Fix**: WhatsApp numbers con código país `57` en Tenants.jsx y Dashboard.jsx.
- **Fix**: `dataVersion` movida a nivel de módulo en server.cjs para acceso desde `saveData()`.
- **Removed**: `src/utils/darkMode.js` (reemplazado por `theme.js`).
- **Update**: `index.html` — meta tag viewport dinámico, overlay diagnóstico 8s, SW condicional.
- **Update**: `src/App.jsx` — init sequence: cloud-first (3 reintentos), polling 15s, version polling 3s, theme init, force-desktop class.
- **Update**: `src/components/Layout.jsx` — 13 items nav (agregados Antecedentes, Predial), ThemeSelector en footer, indicador conexión.
- **Update**: `server.cjs` — auth bypass para `/api/antecedentes/police*`, `POST /api/bulk-add/:collection`.

### 2026-07-21 — v2.2.0 — Chat presence fix, Dashboard imprevistos, auto-guardado contratos, campos trabajo inquilinos

### 2026-07-20 — v2.1.0 — Chat, dark mode, cloud-first, editor embebido, refactor mayor

### 2026-07-20 — v2.1.1 — Fix crítico: carga datos cloud-first (setCollectionData mutación in-place, useState faltante, protección arrays vacíos, reset-db)
