# Gestión de Apartamentos — Laujim APP

> ⚠️ **REGLAS DEL REPOSITORIO**
> 1. **Cada cambio que se haga en el código debe actualizar este README** — si agregas, modificas o eliminas funcionalidad, configuración, dependencias, rutas, endpoints, schemas o scripts, debes reflejarlo aquí.
> 2. **Cada cambio debe registrarse en la sección [Historial de Cambios](#historial-de-cambios)** al final del README, con fecha, versión, y descripción técnica.
> 3. Este README es la fuente de verdad del proyecto. Si algo no está documentado aquí, no existe oficialmente.

---

## Arquitectura del Sistema

Aplicación web progresiva (PWA) + APK Android nativa para administración de apartamentos/residencias. Arquitectura **cloud-first**: los datos se cargan desde el servidor al iniciar y se mantienen sincronizados mediante polling. Todas las operaciones CRUD escriben directamente en el servidor Express, que persiste en `data/database.json`. La base de datos local es **en memoria** (no usa IndexedDB ni Dexie), con una API compatible con Dexie para facilitar la migración.

### Flujo de datos

```
[Navegador / WebView Capacitor]
        │
        ├─► Carga inicial: GET /api/:collection (todas las tablas)
        │       │
        │       └─► db/database.js (en memoria) ← setCollectionData()
        │
        ├─► Polling cada 15s: refreshAllFromServer()
        │       │
        │       └─► Actualiza datos en memoria si hay cambios remotos
        │
        └─► CRUD: POST/PUT/DELETE directo al servidor
                │
                └─► Actualiza memoria local inmediatamente tras respuesta
                           │
                           └─► data/database.json (persistencia)
```
**Estrategia de Persistencia:** No hay offline-first ni cola de sincronización. Cada operación se envía al servidor y, si tiene éxito, se refleja en memoria. El servidor persiste en `data/database.json`. Un proceso de polling cada 15 segundos refresca todos los datos desde el servidor para detectar cambios hechos desde otros dispositivos.

### Stack Tecnológico Detallado

| Capa | Tecnología | Versión | Propósito |
|------|-----------|---------|-----------|
| UI | React | ^19.2.7 | Renderizado de componentes |
| Router | React Router DOM | ^7.18.1 | Enrutamiento SPA cliente |
| Build | Vite | ^8.1.1 | Bundler + dev server |
| Plugin Vite | @vitejs/plugin-react | ^6.0.3 | Fast Refresh JSX |
| Estilos | Tailwind CSS | ^4.3.3 | Utility-first CSS |
| Plugin Tailwind | @tailwindcss/vite | ^4.3.3 | Integración Vite + Tailwind v4 |
| DB en Memoria | Custom (API Dexie-compat) | — | Wrapper de arrays en memoria |
| Backend | Express | ^5.2.1 | API REST + static server + editor embebido |
| Mobile | Capacitor | ^8.4.2 | WebView Android nativo |
| Plugin Capacitor | @capacitor/share | ^8.0.1 | Share nativo (fotos) |
| Plugin Capacitor | @capacitor/local-notifications | ^8.2.1 | Notificaciones locales en APK |
| Gráficos | Recharts | ^3.9.2 | Charting React |
| PDF | jsPDF | ^4.2.1 | Exportar fichas PDF + contratos |
| Íconos | Lucide React | ^1.25.0 | SVG icons |
| Subida archivos | Multer | ^2.2.0 | Multipart uploads |
| CORS | cors | ^2.8.6 | Cross-origin Express |
| Linter | Oxlint | ^1.71.0 | Linting estático |

---

## Configuración Específica por Archivo

### `vite.config.js` — Build & Dev Server

```js
// Archivo: vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',        // Escucha en todas las interfaces de red
    port: 5173,              // Puerto dev
    proxy: {
      '/api': {
        target: 'http://localhost:1011',  // Proxy API a Express
        changeOrigin: true,
      },
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

### `src/utils/config.js` — Conexión al Servidor

```js
// Archivo: src/utils/config.js
export const AUTH_TOKEN = 'laujim laujim';
const DEFAULT_SERVER = 'https://laujim-app.onrender.com'; // Producción en Render.com

// Detección de plataforma
export function isCapacitor() {
  return typeof window !== 'undefined' && (window.Capacitor !== undefined);
}

// Resolución de URL base de la API según el contexto:
//   1. Custom (localStorage.apt_server_url) → (OBSOLETO, no usado)
//   2. Capacitor APK → DEFAULT_SERVER
//   3. PWA standalone → DEFAULT_SERVER
//   4. Navegador normal → window.location.origin
export function getBase() {
  const custom = localStorage.getItem('apt_server_url');
  if (custom) return custom + '/api';
  if (isCapacitor()) return DEFAULT_SERVER + '/api';
  if (window.matchMedia('(display-mode: standalone)').matches) return DEFAULT_SERVER + '/api';
  return window.location.origin + '/api';
}

export function getRawBase() {
  return getBase().replace('/api', '') || DEFAULT_SERVER;
}

// Resuelve URLs de fotos: soporta data URIs (base64) y URLs relativas/absolutas
export function photoUrl(photo) {
  if (!photo) return '';
  if (photo.data) return photo.data;       // data URI (base64)
  if (!photo.url) return '';
  if (photo.url.startsWith('http')) return photo.url;
  return getRawBase() + photo.url;
}
```

**Reglas de resolución de base URL:**
1. **OBSOLETO**: `localStorage.apt_server_url` (ya no configurable en Settings)
2. Si ejecuta dentro de Capacitor (`window.Capacitor`): usa `DEFAULT_SERVER` + `/api`
3. Si ejecuta en modo standalone PWA (`display-mode: standalone`): usa `DEFAULT_SERVER` + `/api`
4. Si es navegador normal (incluyendo Render.com): usa `window.location.origin` + `/api`

### `server.cjs` — Servidor Express

```js
// Archivo: server.cjs
const PORT = process.env.PORT || 1011;
const AUTH_TOKEN = 'laujim laujim';
const PERSISTENT_DIR = process.env.PERSISTENT_DIR || __dirname;
const DATA_FILE = path.join(PERSISTENT_DIR, 'data/database.json');
const UPLOADS_DIR = path.join(PERSISTENT_DIR, 'uploads');
const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos/');
const CONTRACTS_DIR = path.join(UPLOADS_DIR, 'contracts/');
const UPLOAD_LIMIT = 20 * 1024 * 1024;  // 20MB por archivo
```

| Propiedad | Valor | Notas |
|-----------|-------|-------|
| Puerto | `1011` (o `env.PORT`) | Usa `env.PORT` en Render.com |
| Auth | Header `x-auth-token: laujim laujim` | Excluye `/api/login`, `/api/version`, `/api/public/*` |
| JSON body limit | `50mb` | `express.json({ limit: '50mb' })` |
| File upload limit | `20MB` | Multer `limits.fileSize` |
| DB persistencia | `data/database.json` | Se inicializa desde `db.cjs` si no existe |
| Seed data | 12 apartments, 2 usuarios, passwords | Se genera automáticamente (ver `db.cjs`) |
| Static files | Sirve `dist/` + `editor/` | Fallback SPA a `dist/index.html` |
| Uploads | `uploads/photos/`, `uploads/contracts/` | Servidos en `/uploads/` |
| PERSISTENT_DIR | `process.env.PERSISTENT_DIR` | Permite usar directorio persistente en Render.com |

**Middlewares en orden:**
1. `cors({ exposedHeaders: ['x-auth-token'], allowedHeaders: ['Content-Type', 'x-auth-token'] })` — permite CORS
2. `express.json({ limit: '50mb' })` — parsea JSON
3. Auth middleware — valida `x-auth-token` en todas las rutas **excepto** `/api/login`, `/api/version`, y `/api/public/**`
4. Static `uploads/` — sirve archivos subidos
5. Static `dist/` — sirve el build de producción
6. Catch-all — envía `dist/index.html` para SPA routing

**Método de auth:** Login directo `admin/laujim123` o inquilino con `[número_apto]/[código_4_dígitos]`. No hay sesiones ni JWT; el `x-auth-token` se envía en cada request vía header.

### `capacitor.config.json` — Configuración Capacitor 8

```json
{
  "appId": "com.laujim.aptmanager",
  "appName": "GestionApartamentos",
  "webDir": "dist",
  "server": {
    "hostname": "localhost",
    "androidScheme": "http",
    "allowNavigation": [
      "192.168.1.*",
      "192.168.0.*",
      "10.0.2.*",
      "localhost",
      "127.0.0.1"
    ]
  }
}
```

Nota: `capacitor.json` existe como duplicado con `"appName": "Gestion Apartamentos"` (con espacio) pero Capacitor 8 lee `capacitor.config.json`.

### `android/app/src/main/AndroidManifest.xml` — Permisos Android

```xml
<application android:usesCleartextTraffic="true" ...>
    <!-- Permite HTTP plano (necesario para conexión al servidor local) -->
</application>
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" /> <!-- Android 13+ -->
```

### `android/app/build.gradle` — Build Android

```groovy
android {
    namespace = "com.laujim.aptmanager"
    compileSdk = rootProject.ext.compileSdkVersion   // SDK 36
    defaultConfig {
        applicationId "com.laujim.aptmanager"
        minSdkVersion rootProject.ext.minSdkVersion  // 23 (Android 6)
        targetSdkVersion rootProject.ext.targetSdkVersion  // 36 (Android 15)
        versionCode = (int) (System.currentTimeMillis() / 1000)
        versionName = "2.1.0" // Versión manual
    }
}
```

### `index.html` — Entry Point

- Service Worker registrado condicionalmente:
  - Si detecta `window.Capacitor` o `cordova`: **desregistra** cualquier SW y limpia caches
  - Si no: registra `public/sw.js` para caché offline (estrategia network-first)
- **Overlay de diagnóstico**: si React no monta en 8 segundos, muestra pantalla con errores capturados, UA, y botón recargar
- Meta tags PWA: `theme-color=#2563eb`, `apple-mobile-web-app-capable=yes`
- Meta tags Apple: `apple-mobile-web-app-title`, `apple-touch-icon`, `apple-touch-startup-image`

### `public/sw.js` — Service Worker

```js
const CACHE = 'apt-manager-v1';
// Estrategia: network-first con fallback a cache
// NO intercepta rutas /api/ ni version.json
// Soporta notificationclick → clients.openWindow('/')
// Precachea: /, /manifest.json, /icons.svg
```

### `public/manifest.json` — PWA Manifest

```json
{
  "name": "Gestión de Apartamentos",
  "short_name": "Gestión Aptos",
  "description": "Administración de apartamentos - Laujim",
  "display": "standalone",
  "background_color": "#f3f4f6",
  "theme_color": "#2563eb",
  "orientation": "portrait",
  "categories": ["productivity", "utilities"],
  "icons": [
    { "src": "/icons.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "/favicon.svg", "sizes": "48x48", "type": "image/svg+xml", "purpose": "any" }
  ]
}
```

### `public/icons.svg` — Ícono SVG 512×512

Casa blanca sobre fondo azul `#2563eb`, esquinas redondeadas `rx=80`.

### `scripts/generate-version.js` — Versionado Automático

Genera `dist/version.json` con: `{ version, build, patch, date, time }`. La versión de la APK ahora es manual en `build.gradle`.

### `scripts/sync-seed.js` — Sincronización de Seeds

Conecta al servidor (default `http://localhost:1011`), descarga todos los datos de `/api/data/all`, y regenera:
- `data/database.json`
- `db.cjs`
- `src/db/database.js`

Uso: `npm run sync-seed` o `SYNC_URL=http://servidor.com:1011 npm run sync-seed`

### `src/main.jsx` — Bootstrap React

Renderiza `<App />` envuelto en `<StrictMode>` y `<ErrorBoundary>`. Espera `DOMContentLoaded` si el DOM aún carga. Si todo falla, muestra error en pantalla con stack trace.

### `src/App.jsx` — Router e Inicialización

```jsx
// Init sequence en useEffect:
//   1. initDB() — no-op (cloud-backed)
//   2. requestNotificationPermission() — Notifications API
//   3. refreshAllFromServer() — cloud-first: fetch ALL data del servidor
//      (hasta 3 intentos con 5s de espera entre fallos)
//   4. startCloudPolling(15000) — polling cada 15s para detectar cambios remotos
//   5. initDarkMode() — aplicar modo oscuro guardado

// Loading spinner mientras se cargan datos del servidor

// Rutas protegidas:
//   - ProtectedRoute: redirige a /login si no hay auth
//   - AdminRoute: redirige a /mi-apto si el rol no es admin

// Rutas (ver sección Rutas del Frontend)
```

### `src/db/database.js` — Base de Datos en Memoria (API Dexie-compatible)

**Reemplazo completo de Dexie/IndexedDB.** Base de datos en memoria con API compatible con Dexie (`toArray`, `get`, `add`, `put`, `update`, `delete`, `clear`, `bulkAdd`, `where`, `orderBy`).

```js
const collections = [
  'apartments', 'tenants', 'contracts', 'payments', 'expenses',
  'utilityPayments', 'vacancies', 'familyMembers', 'settings',
  'passwords', 'photos', 'messages', 'users'  // 13 colecciones
];

const db = {};
collections.forEach(name => { db[name] = createTable(name); });

export function initDB() { /* cloud-backed - no IndexedDB init needed */ }
export function setCollectionData(name, items) { data[name] = items; }
export function pushToCollection(name, item) { data[name].push(item); }
export function removeFromCollection(name, id) { ... }
export function replaceInCollection(name, id, item) { ... }
```

**Colecciones (13):** `users`, `apartments`, `tenants`, `contracts`, `payments`, `expenses`, `utilityPayments`, `vacancies`, `familyMembers`, `settings`, `photos`, `passwords`, `messages`.

**Seed data de respaldo:** `initDB()` carga seed data embebido (12 apartamentos, 11 inquilinos, 11 contratos, 7 pagos, 2 usuarios, 12 passwords) si el servidor no está disponible. Cuando el servidor responde, `refreshAllFromServer()` sobrescribe con los datos del servidor.

### `src/api.js` — Capa de Datos (Cloud-First)

Cada operación CRUD sigue este patrón:
1. **Envía al servidor** (POST/PUT/DELETE con `x-auth-token`)
2. **Si éxito**: actualiza la base en memoria con el resultado del servidor
3. **Si falla**: lanza error (no hay cola offline)

```js
// refreshAllFromServer() — fetch ALL data de todas las colecciones
// startCloudPolling(15000) — polling cada 15s para detectar cambios
// stopCloudPolling() — detiene el polling

// api.apartments.toArray(), .get(id), .add(data), .update(id, data), .delete(id)
// api.tenants.*, api.contracts.*, api.payments.*, api.expenses.*
// api.utilityPayments.*, api.vacancies.*, api.familyMembers.*, api.photos.*, api.passwords.*, api.users.*
```

Operaciones especiales:
- `uploadPhoto(file, apartmentId)` — lee el archivo como data URI (base64), envía al servidor como JSON
- `deletePhoto(id)` — elimina foto del servidor y de memoria
- `uploadContract(file, contractId)` — sube PDF de contrato vía FormData al servidor

### `src/utils/sync.js` — Estado de Conexión

Ya no hay motor de sincronización push/pull. Solo exporta:
- `isServerAvailable()` — hace `GET /api/apartments/count` con timeout de 10s. Retorna `{ ok: true }` o `{ ok: false, reason }`.

### `src/utils/chat.js` — Sistema de Chat

Chat en tiempo real entre administradores e inquilinos:
- `sendMessage(roomId, from, to, content)` — envía mensaje al servidor
- `sendHeartbeat(userId, status)` — heartbeat de presencia (cada 10s)
- `fetchPresence()` — obtiene estado de usuarios en línea
- `pollNewMessages()` — polling incremental de mensajes nuevos
- `startChatPoll(callback, intervalMs=3000)` — inicia polling de mensajes
- `startHeartbeat(userId, intervalMs=10000)` — inicia heartbeat
- `startPresencePoll(callback, intervalMs=5000)` — inicia polling de presencia
- `getStatusLabel(presence, userId)` — label legible: "En línea", "Ausente", "Visto hace..."
- `getRoomMessages(roomId)` — obtiene mensajes de una sala ordenados por fecha
- `getAllRooms(auth)` — salas disponibles según rol

### `src/utils/helpers.js` — Utilidades

| Función | Descripción |
|---------|-------------|
| `formatCurrency(n)` | `new Intl.NumberFormat('es-CO', { currency: 'COP' })` |
| `formatDate(str)` | `toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })` |
| `formatShortDate(str)` | Igual pero `month: 'short'` |
| `daysBetween(start, end?)` | Días entre dos fechas |
| `monthsBetween(start, end?)` | Meses entre dos fechas |
| `getCurrentPeriod()` | `"YYYY-MM"` del mes actual |
| `getMonthName(n)` | 1=Enero, 12=Diciembre |
| `generateId()` | `Date.now().toString(36) + Math.random().toString(36).substr(2)` |
| `daysUntil(paymentDay)` | Días hasta el próximo día de pago |
| `getPeriodLabel(period)` | Retorna `"Enero 2026"` desde `"2026-01"` |
| `nextPeriod(period)` | Siguiente mes como `"YYYY-MM"` |
| `prevPeriod(period)` | Mes anterior como `"YYYY-MM"` |
| `getAllPeriodsFrom(startPeriod)` | Array de períodos desde `startPeriod` hasta el actual |
| `periodToDate(period)` | Convierte `"2026-01"` a objeto Date |
| `isOverdueByReadingDate(period, readingDay)` | True si pasaron ≥14 días desde la fecha de lectura del período |

### `src/utils/notifications.js` — Notificaciones del Navegador

```js
// requestNotificationPermission() → Notification.requestPermission()
// notifyPaymentReminder(apartmentName, daysLeft):
//   daysLeft ≤ 0  → "Pago vencido"
//   daysLeft ≤ 1  → "Pago mañana"
//   daysLeft ≤ 3  → "Pago próximo"
```

### `src/utils/localNotifications.js` — Notificaciones Locales (APK)

Notificaciones nativas programadas en Android vía `@capacitor/local-notifications`:
- `getNotifConfig()` / `saveNotifConfig(config)` — persistencia en localStorage
- `schedulePaymentReminders(apartments)` — agenda recordatorios de pago (X días antes + día de vencimiento)
- `cancelAllNotifications()` — cancela todas las notificaciones pendientes
- Config: `{ enabled: bool, daysBefore: número }`

### `src/utils/calendar.js` — Recordatorios ICS (OBSOLETO)

```js
// generateAllPaymentReminders(apartments):
//   - Genera VEVENT con RRULE:FREQ=MONTHLY;BYMONTHDAY=N
//   - UIDs fijos: laujim-pago-{slug}@laujim.app
//   - Download como "todos-los-pagos.ics"
```
Actualmente no se invoca desde la UI.

### `src/utils/contractGenerator.js` — Generador de Contratos PDF

Replica la lógica del generador Python `C:\Contratos\generador_gui.pyw` en JavaScript usando jsPDF.
- Convierte números a letras en español (centenas, miles, millones)
- Genera 18 cláusulas legales completas con datos del arrendador, arrendatario e inmueble
- Incluye firmas para ambas partes
- Formato Letter, márgenes 18mm
- Guarda el PDF con nombre `Contrato_apto_{apto}_{nombre}.pdf`

### `src/utils/pdf.js` — Exportación PDF y HTML

```js
// generateApartmentPDF(apartment, tenant, contract):
//   - Usa jsPDF
//   - Incluye: datos del apto, inquilino actual, contrato vigente
//   - Descarga como "ficha-{nombre}.pdf"

// generatePublicHTML(apartmentsData):
//   - Genera HTML standalone con grid responsivo de aptos disponibles
//   - Sin dependencias externas, estilos inline
```

### `src/utils/generate-apartments-html.js` — HTML Público de Vacantes

Genera HTML completo de apartamentos disponibles con fotos incrustadas (base64), galería vertical, features, precios, badge "DISPONIBLE". Usado por `ShareApartments.jsx`.

### `src/utils/auth.js` — Sistema de Autenticación

```js
// getAuth() → { role, username, name, apartmentId } | null
// setAuth(data) → guarda en localStorage 'apt_auth'
// clearAuth() → elimina del localStorage
// isAdmin(), isTenant(), getTenantApartmentId()
// loginAdmin(username, password) → login local (admin/laujim123)
// loginTenant(aptName, password) → busca apto + password en servidor
```

### `src/utils/darkMode.js` — Modo Oscuro

```js
// isDarkMode() → boolean de localStorage 'laujim-dark-mode'
// toggleDarkMode() → cambia y apply la clase .dark en <html>
// initDarkMode() → aplica al inicio
```

Persistencia en `localStorage.laujim-dark-mode`.

### `src/utils/clipboard.js` — Portapapeles

```js
// copyToClipboard(text) → copia texto al portapapeles (navigator.clipboard + fallback)
// openUrl(url) → window.location.href
```

### `src/utils/config.js` — Configuración de Conexión

Ver sección [`src/utils/config.js`](#srcconfigjs--conexión-al-servidor).

### `src/components/Layout.jsx` — Sidebar Responsive

Navegación lateral con **11 entradas**:
- Dashboard (`/dashboard`, icono `LayoutDashboard`)
- Apartamentos (`/apartments`, `Building2`)
- Inquilinos (`/tenants`, `Users`)
- Contratos (`/contracts`, `FileText`)
- Generar Contrato (`/generate-contract`, `ScrollText`)
- Pagos (`/payments`, `DollarSign`)
- Chat (`/chat`, `MessageCircle`)
- Servicios Públicos (`/utilities`, `Zap`)
- Compartir (`/share`, `Share2`)
- Reportes (`/reports`, `BarChart3`)
- Configuración (`/settings`, `Settings`)

**Indicador de conexión** en el pie del sidebar: ícono verde "En línea" / rojo "Sin conexión" / gris "Verificando...", chequea cada 15s y al hacer focus en la ventana.

Responsive: sidebar oculta en mobile, toggle con botón hamburguesa. Soporta modo oscuro (`dark:`).

### `src/components/ErrorBoundary.jsx` — Error Boundary

Captura errores de renderizado en React. Muestra pantalla con mensaje de error y botón "Recargar".

### `src/components/VersionBanner.jsx` — Banner de Actualización

- En **PWA**: muestra banner "Nueva versión disponible — recarga para actualizar".
- Usa `sessionStorage` para no repetir el mismo banner en la misma sesión.

### `src/components/Modal.jsx` — Modal Reutilizable

Modal/dialog reutilizable con overlay.

### `src/components/StatsCard.jsx` — Tarjeta de Estadística

Tarjeta de estadística con ícono y color.

### `src/components/PaymentHistoryChart.jsx` — Gráfico de Pagos

Gráfico de barras (Recharts) que muestra historial de pagos de los últimos 12 meses:
- Barras por período: verde (pagado), rojo (vencido), gris (vacante/impago)
- Tooltip con `formatCurrency()`

---

## Funciones Principales

| Módulo | Descripción |
|--------|-------------|
| **Dashboard** | Estadísticas generales: ocupación, ingresos mensuales esperados, **total recaudado (histórico)**, **recaudado este mes**, pagos pendientes, próximos pagos con cuenta regresiva, alerta de apartamentos vacantes, botón "Imprevistos" para gastos |
| **Apartamentos** | CRUD completo: registro de unidades con nombre, descripción, canon, depósito, día de pago, habitaciones, baños, área, piso, estado (ocupado/vacante), días de lectura de servicios |
| **Detalle de Apartamento** | **Múltiples fotos** (subida como data URI, sin sobrescribir), inquilino actual, historial de contratos, miembros de familia, historial de pagos y gastos, registro de vacancias, servicios públicos por mes, exportar PDF, compartir WhatsApp |
| **Inquilinos** | CRUD con nombre, email, teléfono, **teléfono de trabajo**, **dirección de trabajo**, documento de identidad, notas; enlace a WhatsApp y correo; historial de contratos por inquilino |
| **Contratos** | Creación con selección de apto + inquilino, fechas inicio/fin, canon, depósito, términos; subida de archivo PDF del contrato; al crear cambia el apto a "ocupado" automáticamente |
| **Pagos** | Registro de pagos de arriendo (completo o parcial) y gastos (con categorías: Mantenimiento, Reparación, Limpieza, Impuesto, Seguro, Adecuación, Otro); filtro por tipo y búsqueda |
| **Servicios Públicos** | Control de agua, gas y electricidad por apartamento: código de pago, período, valor, fecha de vencimiento, **fecha de lectura**, estado de pago; enlaces directos a Triple A, Gases del Caribe, Air-e; **modal de pago masivo** con grid 12 aptos × 3 servicios |
| **Reportes** | Gráficos anuales: barras de ingresos vs gastos vs neto por mes, gráfico circular de gastos por categoría, métricas de rentabilidad y rotación de vacancias, **PaymentHistoryChart** |
| **Compartir** | Página `/share` con previsualización de HTML público de aptos disponibles, descarga, PDF, compartir por WhatsApp y Gmail |
| **Generar Contrato** | Formulario completo de contrato de arrendamiento con 18 cláusulas legales, precarga datos del apto e inquilino, genera PDF con jsPDF, **guarda automáticamente el contrato en la BD** (crea inquilino si no existe, cambia apto a ocupado) |
| **Chat** | Página `/chat` con mensajería en tiempo real entre admin e inquilinos, salas por apartamento, indicador de presencia (en línea/ausente/visto), polling cada 3s |
| **Público** | Página `/publico` con lista de apartamentos vacantes (sin auth, para compartir enlace) |
| **Pagar Recibos** | Modal con grid de 12 aptos × 3 servicios con checkboxes, navegación por mes, alertas de vencimiento (2 semanas post-lectura), guardado masivo |
| **Configuración** | **Modo oscuro**, notificaciones (navegador + locales APK), estado de conexión, gestión de **códigos de acceso de inquilinos**, botón **"Cerrar Sesión"**, enlaces a servicios públicos de Barranquilla, enlace a GitHub Releases para APK |

### Funcionalidades transversales
- **Cloud-first**: los datos se cargan del servidor al iniciar (con 3 reintentos)
- **Polling cada 15s**: detecta cambios hechos desde otros dispositivos automáticamente
- **2 modos de login**: admin (`admin/laujim123`) o inquilino (`[apto]/[código]`)
- **Rutas protegidas**: redirect a `/login` si no hay sesión; admin vs inquilino
- **Modo oscuro**: toggle en Settings, persistencia en localStorage
- **Notificaciones del navegador** para recordatorios de pago (3 días, 1 día, vencido)
- **Notificaciones locales en APK** via `@capacitor/local-notifications`
- **Chat** con mensajería, salas, presencia en tiempo real
- **Editor de código embebido** en el servidor (`/editor`) con auth básica
- **Exportar PDF** con ficha completa del apartamento
- **Generar HTML público** de apartamentos disponibles para compartir
- **Compartir fotos WhatsApp** (nativo en APK via `@capacitor/share`, fallback a `navigator.share()` y `wa.me/?text=`)
- **PWA**: Service Worker para caché offline y manifest para instalar en el móvil
- **APK Android**: compilación con Capacitor 8 para instalar como app nativa
- **Login de inquilinos**: Cada inquilino puede acceder a `/mi-apto` con su número de apartamento y código de 4 dígitos

---

## Estructura del Proyecto

```
Proyecto Laujim APP/
├── index.html                  # Entry point HTML (SW condicional, overlay diagnóstico)
├── vite.config.js              # Vite + React + Tailwind + proxy /api → :1011
├── server.cjs                  # Servidor Express (API REST + static + editor embebido)
├── package.json                # Dependencias y scripts
├── capacitor.config.json       # appId: com.laujim.aptmanager, scheme: http
├── capacitor.json              # (duplicado obsoleto, mantiene Capacitor config)
├── db.cjs                      # Seed data inicial (exporta INITIAL_DATA)
│
├── public/
│   ├── manifest.json           # Web App Manifest (PWA)
│   ├── sw.js                   # Service Worker (caché, notificationclick)
│   ├── icons.svg               # Ícono SVG adaptable 512×512
│   ├── favicon.svg             # Favicon 48×48
│   └── app-debug.apk           # APK generado (copia para descarga directa)
│
├── src/
│   ├── main.jsx                # Entry point React (StrictMode, ErrorBoundary)
│   ├── App.jsx                 # Router + init (cloud-first, polling, dark mode, auth)
│   ├── index.css               # @import "tailwindcss" + @custom-variant dark
│   ├── api.js                  # Capa de datos: cloud-first, CRUD directo al servidor
│   ├── db/
│   │   └── database.js         # BBDD en memoria (API Dexie-compatible, 13 colecciones)
│   ├── components/
│   │   ├── Layout.jsx          # Sidebar responsive + indicador de conexión
│   │   ├── Modal.jsx           # Modal/dialog reutilizable
│   │   ├── StatsCard.jsx       # Tarjeta de estadística con ícono y color
│   │   ├── PaymentHistoryChart.jsx # Gráfico de barras de pagos (Recharts)
│   │   ├── ErrorBoundary.jsx   # Captura errores de renderizado
│   │   └── VersionBanner.jsx   # Banner de nueva versión disponible
│   ├── pages/
│   │   ├── Dashboard.jsx       # Resumen stats, ocupación, próximos pagos
│   │   ├── Apartments.jsx      # Lista con búsqueda, filtros, CRUD
│   │   ├── ApartmentDetail.jsx # Detalle completo con fotos, familia, finanzas
│   │   ├── Tenants.jsx         # Gestión de inquilinos (con teléfono/dirección trabajo)
│   │   ├── Contracts.jsx       # Contratos + subida de PDF
│   │   ├── Payments.jsx        # Pagos de renta + gastos
│   │   ├── Utilities.jsx       # Servicios públicos (agua, gas, luz) + grilla pagos masivos
│   │   ├── Reports.jsx         # Reportes con gráficos Recharts
│   │   ├── ShareApartments.jsx # Página compartir: iframe, PDF, WhatsApp, Gmail
│   │   ├── ContractGenerator.jsx # Formulario generador de contratos (18 cláusulas)
│   │   ├── Chat.jsx            # Chat admin ↔ inquilinos con presencia
│   │   ├── PublicApartments.jsx # Página pública de vacantes (sin auth)
│   │   ├── Settings.jsx        # Config: dark mode, notificaciones, passwords, logout
│   │   ├── Login.jsx           # Página de Login para admin e inquilinos
│   │   └── MiApto.jsx          # Vista de inquilino (info de pago, servicios, contrato)
│   └── utils/
│       ├── config.js           # URL base (Render.com) + token de auth + photoUrl
│       ├── helpers.js          # formatCurrency (COP), fechas, cálculos
│       ├── sync.js             # Solo isServerAvailable()
│       ├── auth.js             # Login admin/inquilino, sesión en localStorage
│       ├── chat.js             # Sistema de chat: mensajes, presencia, polling
│       ├── notifications.js    # Notificaciones del navegador
│       ├── localNotifications.js # Notificaciones locales APK (Capacitor)
│       ├── calendar.js         # Generación de archivos ICS (OBSOLETO)
│       ├── pdf.js              # PDF de ficha de apto + HTML público
│       ├── contractGenerator.js # Generación de PDF de contratos (jsPDF, 18 cláusulas)
│       ├── generate-apartments-html.js # HTML standalone de vacantes con fotos
│       ├── darkMode.js         # Modo oscuro (clase .dark en <html>)
│       └── clipboard.js        # Copiar al portapapeles + openUrl
│
├── editor/                     # Editor de código embebido en el servidor
│   └── index.html              # Frontend del editor (auth Basic)
│
├── android/                    # Proyecto Android (Capacitor 8)
│   ├── app/src/main/AndroidManifest.xml
│   │   # cleartext traffic = true, INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS
│   ├── app/build.gradle
│   │   # compileSdk 36, minSdk 23, targetSdk 36, namespace com.laujim.aptmanager
│   └── gradle/
│
├── dist/                       # Build de producción (Vite)
│   ├── version.json            # Generado por scripts/generate-version.js
│   └── app-debug.apk           # APK copiado desde android/
│
├── data/                       # Base de datos del servidor (JSON)
│   └── database.json           # Persistencia del servidor Express
│
├── uploads/                    # Archivos subidos (fotos, contratos)
│   ├── photos/
│   └── contracts/
│
├── scripts/
│   ├── generate-version.js     # Genera version.json al build
│   ├── copy-apk.js             # Copia APK de android/ a dist/ y public/
│   ├── fix-html.js             # Fix HTML post-build
│   ├── add-passwords.js        # Genera passwords aleatorios y actualiza seeds
│   ├── seed-data.js            # (referenciado en build)
│   ├── sync-seed.js            # Descarga datos del servidor y actualiza seeds
│   └── backup.js               # Backup de datos
│
├── build-apk.ps1               # Script PowerShell: build → cap copy → assembleDebug
├── setup-java.ps1              # Configurar JAVA_HOME (Eclipse Adoptium)
├── setup-android-sdk.ps1       # Configurar ANDROID_HOME
├── find-jdk21.ps1              # Buscar JDK 21 en el sistema
├── crear-acceso-directo.ps1    # Crear acceso directo en escritorio
├── backup.ps1 / backup.bat     # Scripts de backup
├── exportar-backup.ps1 / .bat  # Exportar backup
└── iniciar-*.bat / .vbs        # Scripts de inicio (servidor, túneles, etc.)
```

---

## API REST Completa

Endpoint base: `https://laujim-app.onrender.com/api` (o `http://<host>:1011/api` en local)
Auth header: `x-auth-token: laujim laujim`

| Método | Ruta | Descripción | Auth | Cuerpo/Params |
|--------|------|-------------|------|---------------|
| GET | `/api/version` | Versión del build (`version.json`) | No | - |
| POST | `/api/login` | Login con usuario/contraseña o token | No | `{ username, password }` o `{ token }` |
| GET | `/api/data/all` | Obtener todas las colecciones de la BD | Sí | - |
| POST | `/api/save` | Guardar todas las colecciones (bulk) | Sí | `{ collection1: [...], collection2: [...] }` |
| GET | `/api/public/vacants` | Apartamentos vacantes (público) | No | - |
| POST | `/api/presence/heartbeat` | Heartbeat de presencia (chat) | Sí | `{ userId, status }` |
| GET | `/api/messages/updates/:since` | Mensajes nuevos desde ISO timestamp | Sí | - |
| POST | `/api/bulk-add/:collection` | Crear múltiples registros | Sí | `[{ ... }, ...]` |
| POST | `/api/upload/photo` | Subir foto de apto | Sí | FormData: `photo` (file) + `apartmentId` |
| DELETE | `/api/photo/:id` | Eliminar foto (archivo + DB) | Sí | - |
| POST | `/api/upload/contract` | Subir contrato PDF | Sí | FormData: `contract` (file) + `contractId` |
| POST | `/api/generate-contract` | Iniciar generador Python de contratos | Sí | `{ ...datos del contrato }` |
| GET | `/:collection` | Listar todos los registros | Sí | - |
| GET | `/:collection/count` | Contar registros | Sí | - |
| GET | `/:collection/:id` | Obtener uno por ID numérico | Sí | - |
| GET | `/:collection/where/:field/:value` | Filtrar por campo exacto | Sí | - |
| GET | `/:collection/first/:field/:value` | Primer match | Sí | - |
| GET | `/:collection/filter/:field/:value` | Filtrar (alias de where) | Sí | - |
| POST | `/:collection` | Crear registro | Sí | `{ ...fields }` |
| PUT | `/:collection/:id` | Actualizar registro | Sí | `{ ...fields }` |
| DELETE | `/:collection/:id` | Eliminar registro | Sí | - |

**Editor API** (auth Basic: `admin/admin123`):

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/editor/api/list?dir=...` | Listar archivos del proyecto |
| GET | `/editor/api/read?file=...` | Leer archivo |
| POST | `/editor/api/write` | Escribir archivo |
| POST | `/editor/api/exec` | Ejecutar comando (max 500 chars, timeout 30s) |
| GET | `/editor/*` | Static files del editor |

**Colecciones disponibles (13):** `apartments`, `tenants`, `contracts`, `payments`, `expenses`, `utilityPayments`, `vacancies`, `familyMembers`, `users`, `settings`, `photos`, `passwords`, `messages`.

---

## Rutas del Frontend

| Ruta | Componente | Descripción | Auth |
|------|-----------|-------------|------|
| `/login` | `Login.jsx` | Página de login para administradores e inquilinos | No |
| `/mi-apto` | `MiApto.jsx` | Vista del inquilino: info de pago, servicios, contrato | No |
| `/publico` | `PublicApartments.jsx` | Página pública con apartamentos vacantes (para compartir) | No |
| `/dashboard` | `Dashboard.jsx` | Estadísticas generales, ocupación, próximos pagos | Admin |
| `/apartments` | `Apartments.jsx` | Lista con búsqueda, CRUD | Admin |
| `/apartments/:id` | `ApartmentDetail.jsx` | Detalle completo: fotos, familia, contratos, finanzas | Admin |
| `/tenants` | `Tenants.jsx` | Inquilinos con búsqueda y contactos | Admin |
| `/contracts` | `Contracts.jsx` | Contratos con subida de PDF | Admin |
| `/payments` | `Payments.jsx` | Pagos y gastos con filtros | Admin |
| `/utilities` | `Utilities.jsx` | Servicios públicos (agua/gas/luz) | Admin |
| `/reports` | `Reports.jsx` | Reportes con gráficos Recharts | Admin |
| `/share` | `ShareApartments.jsx` | Compartir HTML público, PDF, WhatsApp, Gmail | Admin |
| `/chat` | `Chat.jsx` | Chat admin ↔ inquilinos con presencia en tiempo real | Admin |
| `/generate-contract` | `ContractGenerator.jsx` | Generar contrato de arrendamiento | Admin |
| `/generate-contract/:id` | `ContractGenerator.jsx` | Generar contrato con datos precargados del apto | Admin |
| `/settings` | `Settings.jsx` | Configuración, dark mode, notificaciones, passwords, logout | Admin |
| `*` | → `/dashboard` | Redirección por defecto (tras login) | - |

---

## Datos Iniciales (Seed)

### Usuarios
| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `admin` | `admin123` | owner (nota: en db.cjs, no `laujim123`) |
| `invitado` | `invitado123` | guest |

### Apartamentos (12 unidades)
101 Casa, 102 Aparta Estudio, 201, 202, 203, 301, 302, 303, 401, 402, 403, 501 — 4 pisos, 3 aptos por piso (piso 4 tiene 4). Todos con `paymentDueDay: 5`.

### Contraseñas de Inquilinos
Generadas aleatoriamente (4 dígitos). Se pueden ver y regenerar en **Settings → Acceso de Inquilinos**.

---

## Requerimientos del Sistema

### Para desarrollo/web local
- **Node.js** 18+ (probado con 22+)
- **npm** 9+
- Navegador moderno (Chrome, Firefox, Edge)

### Para compilar APK (Android)
- **Java JDK 21** (Eclipse Adoptium: `C:\Program Files\Eclipse Adoptium\jdk-21.x.x`)
- **Android SDK** (en `C:\Android`)
- Variables de entorno:
  - `JAVA_HOME` → ruta del JDK 21
  - `ANDROID_HOME` → `C:\Android`
  - `ANDROID_SDK_ROOT` → `C:\Android`

### Dependencias npm
| Paquete | Versión | Tipo |
|---------|---------|------|
| react | ^19.2.7 | Dep |
| react-dom | ^19.2.7 | Dep |
| react-router-dom | ^7.18.1 | Dep |
| dexie | ^4.4.4 | Dep |
| lucide-react | ^1.25.0 | Dep |
| recharts | ^3.9.2 | Dep |
| jspdf | ^4.2.1 | Dep |
| express | ^5.2.1 | Dep |
| multer | ^2.2.0 | Dep |
| cors | ^2.8.6 | Dep |
| tailwindcss | ^4.3.3 | Dep |
| @tailwindcss/vite | ^4.3.3 | Dep |
| @capacitor/core | ^8.4.2 | Dep |
| @capacitor/cli | ^8.4.2 | Dep |
| @capacitor/android | ^8.4.2 | Dep |
| @capacitor/share | ^8.0.1 | Dep |
| @capacitor/local-notifications | ^8.2.1 | Dep |
| vite | ^8.1.1 | DevDep |
| @vitejs/plugin-react | ^6.0.3 | DevDep |
| oxlint | ^1.71.0 | DevDep |
| @types/react | ^19.2.17 | DevDep |
| @types/react-dom | ^19.2.3 | DevDep |

---

## Instalación y Uso

### 1. Clonar / Copiar el proyecto
```bash
cd "C:\Users\jimca\OneDrive\Escritorio\Proyecto Laujim APP"
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Modos de ejecución

#### Modo desarrollo (solo este PC)
```bash
npm run dev
# Abre http://localhost:5173
# Proxy /api → http://localhost:1011 (debe correr server aparte)
```

#### Modo desarrollo (red local)
```bash
npm run network
# Accesible desde cualquier dispositivo en el mismo WiFi en http://192.168.x.x:5173
```

#### Modo servidor (compartido con todos los dispositivos)
```bash
node server.cjs
# Build previo necesario: npm run build
# Luego abre http://localhost:1011 (o http://192.168.x.x:1011 desde otros dispositivos)
# Incluye editor de código en /editor (auth: admin/admin123)
```

#### Build de producción
```bash
npm run build
# Genera dist/ con version.json
```

#### Vista previa del build
```bash
npm run preview
```

### 4. Compilar APK Android
```bash
npm run build-apk
# Equivalente a:
npm run build
npx cap copy android
cd android
gradlew.bat assembleDebug
cd ..
node scripts/copy-apk.js
```
El APK se genera en `android/app/build/outputs/apk/debug/app-debug.apk` (~18 MB) y se copia automáticamente a `dist/app-debug.apk` y `public/app-debug.apk`.

### 5. Scripts auxiliares
```bash
.\setup-java.ps1          # Configura JAVA_HOME
.\setup-android-sdk.ps1   # Configura ANDROID_HOME
.\find-jdk21.ps1          # Busca JDK 21 instalado
.\build-apk.ps1           # Compila APK directo
.\iniciar-servidor.bat    # Menú interactivo para elegir modo
.\iniciar-servidor-sync.bat # Build + servidor Express directo
npm run sync-seed         # Descarga datos del servidor y actualiza seeds
```

---

## Flujo de Datos (Cloud-First)

### Inicio
1. App carga, muestra spinner "Cargando datos del servidor..."
2. `refreshAllFromServer()`: hace GET a cada colección (hasta 3 intentos)
3. Cada colección se guarda en memoria via `setCollectionData()`
4. Se inicia `startCloudPolling(15000)`: polling cada 15s
5. Se inicia `initDarkMode()` para aplicar modo oscuro

### Operaciones CRUD
1. Cada mutación (crear, actualizar, eliminar) envía request al servidor
2. Si el servidor responde OK, se actualiza la memoria local con la respuesta
3. No hay cola offline — si el servidor no responde, la operación falla

### Polling (detección de cambios externos)
1. Cada 15s, `refreshAllFromServer()` refresca TODAS las colecciones
2. Si otro dispositivo hizo cambios, se reflejan automáticamente
3. Se puede detener con `stopCloudPolling()`

### Chat
1. `startChatPoll(callback, 3000)`: polling de mensajes nuevos cada 3s
2. `startHeartbeat(userId, 10000)`: heartbeat cada 10s
3. `startPresencePoll(callback, 5000)`: polling de presencia cada 5s

---

## Servidor — Rutas de Editor Embebido

El servidor incluye un editor de código básico accesible en `/editor`:
- Auth Basic: `admin/admin123`
- Listar, leer, escribir archivos del proyecto
- Ejecutar comandos (shell) con límite de 500 chars y timeout 30s
- Path traversal protegido (solo dentro del directorio del proyecto)

---

## Notas Regionales

- **Moneda**: COP (Peso Colombiano, formato `es-CO` con `Intl.NumberFormat`)
- **Idioma**: Español
- **Servicios públicos**: Barranquilla (Triple A, Gases del Caribe, Air-e)
- **Código país WhatsApp**: +57
- **Zona horaria**: America/Bogota

---

## APK — Problemas Conocidos y Soluciones

### La APK compila pero no funciona / pantalla en blanco
1. **`usesCleartextTraffic`**: Android 9+ bloquea HTTP por defecto. Ya agregado en `AndroidManifest.xml`:
   ```xml
   android:usesCleartextTraffic="true"
   ```
2. **URL del servidor**: La APK usa el `DEFAULT_SERVER` de `src/utils/config.js` (Render.com). Para servidor local, debe estar en la misma red.
3. **Service Worker**: Deshabilitado automáticamente cuando se detecta Capacitor (`index.html`).
4. **`androidScheme: "http"`**: Ya configurado en `capacitor.config.json`.
5. **`allowNavigation`**: Capacitor 8 requiere whitelist de hosts. Configurado en `capacitor.config.json`.

### La app no carga en el navegador
1. Revisar la consola del navegador (F12) para errores JS
2. Si React no monta, un overlay de diagnóstico aparece a los 8 segundos con el UA, errores capturados y enlaces
3. Verificar que `npm install` se ejecutó correctamente

---

## Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Servidor dev Vite :5173 |
| `npm run build` | Build producción + version.json + fix-html |
| `npm run preview` | Preview del build de producción |
| `npm run network` | Dev mode con `--host` (accesible en red local) |
| `npm run lint` | Oxlint (react, oxc plugins) |
| `npm run build-apk` | Build web + compilar APK + copiar a dist/ y public/ |
| `npm run sync-seed` | Descarga datos del servidor y actualiza seeds |
| `node server.cjs` | Iniciar servidor Express :1011 (con editor embebido) |
| `.\build-apk.ps1` | Script PowerShell completo de build APK |
| `.\iniciar-servidor.bat` | Menú interactivo para elegir modo |
| `.\iniciar-servidor-sync.bat` | Build + servidor Express directo |

---

## Linter (Oxlint)

Configurado en `.oxlintrc.json`:
```json
{
  "plugins": ["react", "oxc"],
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

---

## Historial de Cambios

### 2026-07-20 — v2.1.1 — Fix: carga de datos cloud-first + seed data de respaldo
- **Fix [CRÍTICO]**: `src/db/database.js` — `createTable(name)` capturaba `const table = data[name]` en una closure. `setCollectionData()` e `initDB()` hacían `data[name] = nuevoArray`, reemplazando la referencia, pero la closure seguía apuntando al array vacío original. Cambiado a mutación in-place: `data[name].length = 0; data[name].push(...items)`. Sin esto, `db.apartments.toArray()` siempre devolvía `[]`.
- **Fix**: `App.jsx` — agregado `useState` faltante en el import de React. Sin esto, la app se caía al iniciar.
- **Fix**: `src/db/database.js` — agregado `SEED_DATA` con seed data de respaldo (12 aptos, 11 inquilinos, contratos, pagos, usuarios, passwords) para que la app funcione sin servidor.
- **Fix**: `package.json` — versión actualizada de `1.0.0` a `2.1.0`.

### 2026-07-20 — v2.1.0 — Chat, dark mode, cloud-first, editor embebido, refactor mayor
- **New**: README completamente reescrito para reflejar la arquitectura real del proyecto.
- **Arquitectura**: Migración de offline-first (Dexie/IndexedDB) a **cloud-first** con base de datos en memoria. Reemplazado `src/db/database.js` con implementación propia (API Dexie-compatible, 13 colecciones).
- **New**: Sistema de autenticación (`src/utils/auth.js`) con login admin/inquilino, rutas protegidas (`ProtectedRoute`, `AdminRoute`), persistencia en localStorage.
- **New**: Página de **Chat** (`/chat`) con mensajería admin ↔ inquilinos, salas por apartamento, presencia en tiempo real (heartbeat cada 10s, polling cada 3s).
- **New**: **Modo oscuro** (`src/utils/darkMode.js`) con toggle en Settings, clase `.dark` en `<html>`, persistencia en localStorage.
- **New**: `src/utils/localNotifications.js` — notificaciones locales nativas en APK via `@capacitor/local-notifications`.
- **New**: `src/utils/chat.js` — sistema completo de chat con mensajes, presencia, salas.
- **New**: `src/utils/clipboard.js` — utilidad de portapapeles con fallback.
- **New**: `src/utils/generate-apartments-html.js` — generación de HTML standalone de vacantes con fotos base64.
- **New**: Página `/publico` (`PublicApartments.jsx`) — lista pública de vacantes sin autenticación.
- **New**: Componente `PaymentHistoryChart.jsx` — gráfico de barras de historial de pagos.
- **New**: **Editor de código embebido** en el servidor (`/editor`) con listar/leer/escribir archivos y ejecutar comandos (auth Basic).
- **New**: Endpoints de presencia (`POST /api/presence/heartbeat`) y mensajes (`GET /api/messages/updates/:since`).
- **New**: Inicio cloud-first con spinner de carga y hasta 3 reintentos (`refreshAllFromServer()`).
- **New**: Polling de datos cada 15s (`startCloudPolling(15000)`) para detectar cambios remotos.
- **New**: Indicador de conexión (en línea/sin conexión) en el sidebar.
- **Update**: `src/api.js` reescrito: CRUD directo al servidor, sin cola offline, fotos como data URI.
- **Update**: `src/utils/sync.js` simplificado a solo `isServerAvailable()`.
- **Update**: `src/utils/config.js` — `DEFAULT_SERVER` ahora apunta a `https://laujim-app.onrender.com`, `photoUrl()` soporta data URIs.
- **Update**: `vite.config.js` — ya no usa `format: 'iife'` ni `inlineDynamicImports`, externaliza Capacitor.
- **Update**: `index.html` — overlay de diagnóstico a los 8s, meta tags Apple, SW condicional mejorado.
- **Update**: `public/manifest.json` — agregado `description`, `favicon.svg`, `screenshots`.
- **Update**: `public/sw.js` — agregado `notificationclick` handler, precacheo de assets.
- **Update**: `server.cjs` — agregados `PERSISTENT_DIR`, rutas de editor, presencia, mensajes, CORS expone `x-auth-token`.
- **Update**: `db.cjs` — password admin es `admin123` (no `laujim123`).
- **Update**: Layout con 11 entradas (agregado Chat), indicador de conexión, soporte dark mode.
- **Removed**: Dependencia de Dexie.js como DB real (aunque sigue en package.json como API compat).
- **Removed**: Sync queue (`localStorage.apt_pending_ops`), auto-sync cada 30s, `triggerAutoSave()`, barra flotante de guardado.
- **Removed**: `scripts/add-passwords.js` fusionado en seed.

### 2026-07-21 — v2.1.0 — Chat presence fix, Dashboard imprevistos, auto-guardado de contratos, campos de trabajo en inquilinos
- **Fix**: Chat presence — corregidos 3 bugs: sintaxis `++` en expresión, import faltante de `stopHeartbeat`, y `callback(fetchPresence)` pasando función en lugar de su resultado. Ahora el estado de conexión se muestra correctamente por sala.
- **New**: Dashboard — iconos WhatsApp y teléfono por inquilino en secciones de pagos vencidos y pendientes.
- **New**: Botón rojo "Imprevistos" en Dashboard reemplaza el `+` de gastos; modal de gasto ahora pre-marca como imprevisto.
- **New**: ContractGenerator ahora guarda automáticamente el contrato en la BD al generar PDF: crea inquilino si no existe, sube el PDF al servidor, y asocia al apartamento (status → "ocupado").
- **New**: Campos "Teléfono de Trabajo" y "Dirección de Trabajo" en formulario y tabla de Inquilinos.

### 2026-07-20 — v2.0.1 — Auto-save + barra flotante de guardado (obsolescente, reemplazado por cloud-first)
- (Funcionalidad eliminada en v2.1.0 con la migración a cloud-first)

### 2026-07-20 — v2.0.0 — Login inquilinos, persistencia de datos, mejoras UX
- (Versión anterior, previa a cloud-first)

### 2026-07-18 — v1.0.3 — Generador de contratos + pagos de servicios + fechas de lectura

### 2026-07-18 — v1.0.2 — Compartir por WhatsApp + calendario + página de compartir

### 2026-07-18 — v1.0.1 — APK funcional + fixes de conectividad

### 2026-07-18 — v1.0.0 — Versión inicial
