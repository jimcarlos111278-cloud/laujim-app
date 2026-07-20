# Gestión de Apartamentos — Laujim APP

> ⚠️ **REGLAS DEL REPOSITORIO**
> 1. **Cada cambio que se haga en el código debe actualizar este README** — si agregas, modificas o eliminas funcionalidad, configuración, dependencias, rutas, endpoints, schemas o scripts, debes reflejarlo aquí.
> 2. **Cada cambio debe registrarse en la sección [Historial de Cambios](#historial-de-cambios)** al final del README, con fecha, versión, y descripción técnica.
> 3. Este README es la fuente de verdad del proyecto. Si algo no está documentado aquí, no existe oficialmente.

---

## Arquitectura del Sistema

Aplicación web progresiva (PWA) + APK Android nativa para administración de apartamentos/residencias. Arquitectura **offline-first**: toda la lógica de negocio opera contra IndexedDB local (Dexie.js), con sincronización asíncrona hacia un servidor Express que persiste en JSON. El frontend React se compila con Vite y se despliega como SPA estática servida por Express o embebida en WebView de Capacitor para Android.

### Flujo de datos

```
[Navegador / WebView Capacitor]
        │
        ├─► IndexedDB (Dexie) ──► Lectura/escritura síncrona offline
        │       │
        │       └─► Botón "Guardar Todo" (Settings) ──► Envío masivo a Express API
        │
        └─► Sync Queue (localStorage: apt_pending_ops)
                │
                └─► Auto-sync cada 30s ──► Express API (puerto 1011)
                                                │
                                                └─► data/database.json (persistencia)
```
**Estrategia de Persistencia:** Los cambios realizados en la aplicación se guardan primero en IndexedDB (local). Luego, se encolan en una "Sync Queue" para su sincronización asíncrona con el servidor. Cada deploy en Render.com reinicia el sistema de archivos, por lo que `data/database.json` se inicializa con el contenido de `db.cjs`. Para asegurar que los datos del usuario persistan entre deploys, es **CRÍTICO** usar el botón "Guardar Todo" en la configuración de la aplicación antes de cada despliegue, y luego ejecutar `npm run sync-seed` localmente para actualizar los archivos `data/database.json` y `db.cjs` en el repositorio.

### Stack Tecnológico Detallado

| Capa | Tecnología | Versión | Propósito |
|------|-----------|---------|-----------|\
| UI | React | ^19.2.7 | Renderizado de componentes |
| Router | React Router DOM | ^7.18.1 | Enrutamiento SPA cliente |
| Build | Vite | ^8.1.1 | Bundler + dev server |
| Plugin Vite | @vitejs/plugin-react | ^6.0.3 | Fast Refresh JSX |
| Estilos | Tailwind CSS | ^4.3.3 | Utility-first CSS |
| Plugin Tailwind | @tailwindcss/vite | ^4.3.3 | Integración Vite + Tailwind v4 |
| DB Local | Dexie.js | ^4.4.4 | IndexedDB wrapper |
| Backend | Express | ^5.2.1 | API REST + static server |
| Mobile | Capacitor | ^8.4.2 | WebView Android nativo |
| Plugin Capacitor | @capacitor/share | ^8.0.1 | Share nativo (fotos) |
| Gráficos | Recharts | ^3.9.2 | Charting React |
| PDF | jsPDF | ^4.2.1 | Exportar fichas PDF |
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
    rollupOptions: {
      output: {
        format: 'iife',                // IIFE para Capacitor compatibilidad
        name: 'app',
        inlineDynamicImports: true,     // Single bundle
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
const DEFAULT_SERVER = 'http://192.168.1.21:1011'; // Ejemplo para servidor local
// En Render.com, esta se sobreescribe con la URL del despliegue

// Detección de plataforma
export function isCapacitor() {
  return typeof window !== 'undefined' && (window.Capacitor !== undefined);
}

// Resolución de URL base de la API según el contexto:
//   1. Custom (localStorage.apt_server_url) → Settings (OBSOLETO, no usado)
//   2. Capacitor APK → DEFAULT_SERVER
//   3. PWA standalone → DEFAULT_SERVER
//   4. Navegador normal → window.location.origin
export function getBase() {
  const custom = localStorage.getItem('apt_server_url');
  if (custom) return custom + '/api'; // Esta opción es obsoleta y no debería usarse
  if (isCapacitor()) return DEFAULT_SERVER + '/api';
  if (window.matchMedia('(display-mode: standalone)').matches) return DEFAULT_SERVER + '/api';
  return window.location.origin + '/api';
}

export function getRawBase() {
  return getBase().replace('/api', '') || DEFAULT_SERVER;
}

// Resuelve URLs de fotos: relativas → absolutas contra el servidor
export function photoUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return getRawBase() + url;
}
```

**Reglas de resolución de base URL:**
1.  **OBSOLETO**: Si `localStorage.apt_server_url` existe (antes configurable en Settings): ya no se usa, la app asume el servidor de despliegue o el `DEFAULT_SERVER`.
2.  Si ejecuta dentro de Capacitor (`window.Capacitor`): usa `DEFAULT_SERVER` + `/api` (para desarrollo local)
3.  Si ejecuta en modo standalone PWA (`display-mode: standalone`): usa `DEFAULT_SERVER` + `/api` (para desarrollo local)
4.  Si es navegador normal (incluyendo Render.com): usa `window.location.origin` + `/api`

### `server.cjs` — Servidor Express

```js
// Archivo: server.cjs
const PORT = process.env.PORT || 1011; // Ahora lee de env.PORT para Render.com
const AUTH_TOKEN = 'laujim laujim';
const DATA_FILE = 'data/database.json';
const UPLOADS_DIR = 'uploads/';
const PHOTOS_DIR = 'uploads/photos/';
const CONTRACTS_DIR = 'uploads/contracts/';
const UPLOAD_LIMIT = 20 * 1024 * 1024;  // 20MB por archivo
```

| Propiedad | Valor | Notas |
|-----------|-------|-------|\
| Puerto | `1011` (o `env.PORT`) | Fijo, no configurable por env. En Render usa `env.PORT` |
| Auth | Header `x-auth-token: laujim laujim` | Excluye `/api/login`, `/api/version`, `/api/public/*` |
| JSON body limit | `50mb` | `express.json({ limit: '50mb' })` |
| File upload limit | `20MB` | Multer `limits.fileSize` |
| DB persistencia | `data/database.json` | Carga al inicio. Se inicializa desde `db.cjs` en Render.com |
| Seed data | 12 apartments, 2 users | Se genera automáticamente si el archivo no existe (ver `db.cjs`) |
| Static files | Sirve `dist/` | Fallback SPA a `dist/index.html` |
| Uploads | `uploads/photos/`, `uploads/contracts/` | Servidos en `/uploads/` |

**Middlewares en orden:**
1.  `cors()` — permite cualquier origen
2.  `express.json({ limit: '50mb' })` — parsea JSON
3.  Auth middleware — valida `x-auth-token` en todas las rutas **excepto** `/api/login`, `/api/version`, y `**/api/public/**`
4.  Static `uploads/` — sirve archivos subidos
5.  Static `dist/` — sirve el build de producción
6.  Catch-all — envía `dist/index.html` para SPA routing

**Método de auth:** El cliente autentica directamente con el servidor `admin/laujim123` o `[apto]/[código]`. No hay sesiones ni JWT; el `x-auth-token` se envía en cada request vía header para la API.

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
      "127.0.0.1",
      "*.onrender.com" // Añadido para Render.com
    ]
  }
}
```

`capacitor.json` es un duplicado con `"bundledWebRuntime": false` y `"appName": "Gestion Apartamentos"` (con espacio). Se mantiene por compatibilidad pero Capacitor 8 lee `capacitor.config.json`.

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
        versionName = "2.0.0" // Versión manual
    }
}
```

### `index.html` — Entry Point

- Service Worker registrado condicionalmente:
  - Si detecta `window.Capacitor` o `cordova`: **desregistra** cualquier SW y limpia caches
  - Si no: registra `public/sw.js` para caché offline
- Script de diagnóstico renderiza overlay si React no monta en 8 segundos
- Meta tags PWA: `theme-color=#2563eb`, `apple-mobile-web-app-capable=yes`

### `public/sw.js` — Service Worker

```js
const CACHE = 'apt-manager-v1';
// NO intercepta rutas /api/, /api/public/, ni version.json
// Estrategia: network-first con fallback a cache
```

### `public/manifest.json` — PWA Manifest

```json
{
  "name": "Gestión de Apartamentos",
  "short_name": "Gestión Aptos",
  "display": "standalone",
  "background_color": "#f3f4f6",
  "theme_color": "#2563eb",
  "orientation": "portrait",
  "categories": ["productivity", "utilities"],
  "icons": [{ "src": "/icons.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }]
}
```

### `public/icons.svg` — Ícono SVG 512×512

Casa blanca sobre fondo azul `#2563eb`, esquinas redondeadas `rx=80`.

### `scripts/generate-version.js` — Versionado Automático

```js
// Genera dist/version.json con:
// { version: "1.0.N", build: "YYYYMMDDHHmm", patch: N, date: "...", time: "..." }
// (OBSOLETO: La versión de la APK ahora es manual en build.gradle, la PWA usa una versión fija)
```

### `scripts/copy-apk.js` — Post-build APK

Copia `android/app/build/outputs/apk/debug/app-debug.apk` → `dist/app-debug.apk` y `public/app-debug.apk`.

### `src/main.jsx` — Bootstrap React

Renderiza `<App />` envuelto en `<StrictMode>` y `<ErrorBoundary>`. Espera `DOMContentLoaded` si el DOM aún carga. Si todo falla, muestra error en pantalla con stack trace.

### `src/App.jsx` — Router e Inicialización

```jsx
// Init sequence en useEffect:
//   1. initDB() — seed data si vacío
//   2. requestNotificationPermission() — Notifications API
//   3. startAutoSync(30000, onChange) — sync cada 30s
//      onChange: si detecta cambios en pagos, pregunta al usuario
//      si quiere regenerar recordatorios ICS

// Rutas (ver sección Rutas del Frontend)
```

### `src/db/database.js` — Dexie Schema v5

*v3 → v4:* Se añadió índice `paid` en utilityPayments y campos `waterReadingDay`, `gasReadingDay`, `electricityReadingDay` en apartments.
*v4 → v5:* Se añadió la tabla `passwords` para la gestión de acceso de inquilinos.

```js
new Dexie('ApartmentManager').version(5).stores({
  users:           '++id, username, role',
  apartments:      '++id, name, status, createdAt',
  tenants:         '++id, name, email, documentId',
  contracts:       '++id, apartmentId, tenantId, startDate, endDate',
  payments:        '++id, apartmentId, contractId, date, type, period',
  utilityPayments: '++id, apartmentId, service, period, paid',
  expenses:        '++id, apartmentId, date, category',
  vacancies:       '++id, apartmentId, startDate',
  settings:        '++id, key',
  photos:          '++id, apartmentId',
  familyMembers:   '++id, apartmentId, name',
  passwords:       '++id, apartmentId, type', // Nueva tabla en v5
})
```

**Seed data:** Incluye 2 usuarios (`admin/laujim123` owner, `invitado/invitado123` guest), 12 apartamentos y passwords aleatorios para inquilinos.

### `src/api.js` — Capa de Datos (Offline-First)

Cada operación CRUD sigue este patrón:
1.  **Escribe en IndexedDB** (local, instantáneo)
2.  **Encola en Sync Queue** (`localStorage.apt_pending_ops`) con método, colección, datos
3.  **Intenta enviar al servidor** (`tryServer`) — si falla (offline), la operación queda en cola

Colecciones expuestas: `users`, `apartments`, `tenants`, `contracts`, `payments`, `expenses`, `utilityPayments`, `vacancies`, `familyMembers`, `photos`, `passwords`.

Operaciones especiales:
-   `uploadPhoto(file, apartmentId)` — sube foto vía FormData, la agrega a IndexedDB y encola (ya no borra fotos existentes, las añade)
-   `deletePhoto(id)` — elimina de IndexedDB, encola, intenta DELETE al servidor
-   `uploadContract(file, contractId)` — sube PDF de contrato vía FormData

### `src/utils/sync.js` — Motor de Sincronización

```js
// Sync Queue key: localStorage 'apt_pending_ops'
// Formato: [{ method, collection, data, id, localId, _id, _createdAt }]

// isServerAvailable() — GET /api/apartments/count timeout 3s
// syncPush() — envía ops pendientes en orden, elimina las exitosas
// syncPull() — para cada colección: GET → clear() → bulkAdd()
// syncAll() → syncPush() + syncPull()
// syncAllWithChanges() — detecta cambios en payments antes/después
// startAutoSync(30000, onChange) — tick cada 30s
// clearPendingOps() - Elimina todas las operaciones pendientes
// COLLECTIONS - Lista de colecciones a sincronizar
```

**Colecciones sincronizadas (12):** `users`, `apartments`, `tenants`, `contracts`, `payments`, `expenses`, `utilityPayments`, `vacancies`, `familyMembers`, `settings`, `photos`, `passwords`.

### `src/utils/helpers.js` — Utilidades

| Función | Descripción |
|---------|-------------|\
| `formatCurrency(n)` | `new Intl.NumberFormat('es-CO', { currency: 'COP' })` |
| `formatDate(str)` | `toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })` |
| `formatShortDate(str)` | Igual pero `month: 'short'` |
| `daysBetween(start, end?)` | Días entre dos fechas |
| `monthsBetween(start, end?)` | Meses entre dos fechas |
| `getCurrentPeriod()` | `"YYYY-MM"` del mes actual |
| `getMonthName(n)` | 1=Enero, 12=Diciembre |
| `generateId()` | `Date.now().toString(36) + Math.random().toString(36).substr(2)` |
| `daysUntil(paymentDay)` | Días hasta el próximo día de pago (dado el día del mes) |
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
// Solo dispara si Notification.permission === 'granted'
```

### `src/utils/calendar.js` — Recordatorios ICS

```js
// generateAllPaymentReminders(apartments):
//   - Solo aptos con status === 'occupied' y paymentDueDay > 0
//   - Genera VEVENT con RRULE:FREQ=MONTHLY;BYMONTHDAY=N
//   - UIDs fijos: laujim-pago-{slug}@laujim.app
//   - Eventos de aptos liberados → STATUS:CANCELLED
//   - Almacena UIDs activos en localStorage 'laujim_calendar_uids'
//   - Download como "todos-los-pagos.ics"
```

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

### `src/components/Layout.jsx` — Sidebar Responsive

Navegación lateral con 9 entradas:
- Dashboard (`/dashboard`, icono `LayoutDashboard`)
- Apartamentos (`/apartments`, `Building2`)
- Inquilinos (`/tenants`, `Users`)
- Contratos (`/contracts`, `FileText`)
- Generar Contrato (`/generate-contract`, `ScrollText`)
- Pagos (`/payments`, `DollarSign`)
- Servicios Públicos (`/utilities`, `Zap`)
- Compartir (`/share`, `Share2`)
- Reportes (`/reports`, `BarChart3`)
- Configuración (`/settings`, `Settings`)

Responsive: sidebar oculta en mobile, toggle con botón hamburguesa.

### `src/components/ErrorBoundary.jsx` — Error Boundary

Captura errores de renderizado en React. Muestra pantalla con mensaje de error y botón "Recargar".

### `src/components/VersionBanner.jsx` — Banner de Actualización

- En **APK**: (OBSOLETO: Ya no compara versión con el servidor. Ahora solo indica si hay una nueva versión en GitHub Releases.)
- En **PWA**: muestra banner "Nueva versión disponible — recarga para actualizar".
- Usa `sessionStorage` para no repetir el mismo banner en la misma sesión.

---

## Funciones Principales

| Módulo | Descripción |
|--------|-------------|\
| **Dashboard** | Estadísticas generales: ocupación, ingresos mensuales esperados, **total recaudado (histórico)**, **recaudado este mes**, pagos pendientes, próximos pagos con cuenta regresiva, alerta de apartamentos vacantes |
| **Apartamentos** | CRUD completo: registro de unidades con nombre, descripción, canon, depósito, día de pago, habitaciones, baños, área, piso, estado (ocupado/vacante) |
| **Detalle de Apartamento** | **Múltiples fotos (subida/eliminación sin sobrescribir)**, inquilino actual, historial de contratos, miembros de familia, historial de pagos y gastos, registro de vacancias, exportar PDF, compartir WhatsApp |
| **Inquilinos** | CRUD con nombre, email, teléfono, documento de identidad, notas; enlace a WhatsApp y correo; historial de contratos por inquilino |
| **Contratos** | Creación con selección de apto + inquilino, fechas inicio/fin, canon, depósito, términos; subida de archivo PDF del contrato; al crear cambia el apto a "ocupado" automáticamente |
| **Pagos** | Registro de pagos de arriendo (completo o parcial) y gastos (con categorías: Mantenimiento, Reparación, Limpieza, Impuesto, Seguro, Adecuación, Otro); filtro por tipo y búsqueda |
| **Servicios Públicos** | Control de agua, gas y electricidad por apartamento: código de pago, período, valor, fecha de vencimiento, estado de pago; enlaces directos a Triple A, Gases del Caribe, Air-e |
| **Reportes** | Gráficos anuales: barras de ingresos vs gastos vs neto por mes, gráfico circular de gastos por categoría, métricas de rentabilidad y rotación de vacancias |
| **Compartir** | Página `/share` con previsualización de HTML público de aptos disponibles, descarga, PDF, compartir por WhatsApp y Gmail |
| **Generar Contrato** | Formulario completo de contrato de arrendamiento con 18 cláusulas legales, precarga datos del apto e inquilino, genera PDF con jsPDF, compatible con el generador Python (`C:\Contratos`) |
| **Pagar Recibos** | Modal con grid de 12 aptos × 3 servicios con checkboxes, navegación por mes, alertas de vencimiento (2 semanas post-lectura), guardado masivo |
| **Configuración** | **Botón "Guardar Todo" (envía toda la BD a `/api/save`)**, **botón "Descargar Backup (JSON)"**, sincronización manual (push/pull), **botón para limpiar operaciones pendientes**, notificaciones (móviles/navegador), gestión de **códigos de acceso de inquilinos**, link público para aptos disponibles, **link a GitHub Releases para APK**, enlaces a servicios públicos de Barranquilla, botón **"Cerrar Sesión"**. |

### Funcionalidades transversales
- **Offline-first**: todas las operaciones leer/escriben en IndexedDB; las operaciones se encolan y sincronizan cuando el servidor está disponible
- **Auto-sync** cada 30 segundos
- **Notificaciones** del navegador para recordatorios de pago (3 días antes, 1 día antes, vencido)
- **Recordatorios de calendario** (archivo ICS descargable con RRULE mensual) para pagos de arriendo
- **Exportar PDF** con ficha completa del apartamento
- **Generar HTML público** de apartamentos disponibles para compartir
- **Compartir fotos WhatsApp** (nativo en APK via `@capacitor/share`, fallback a `navigator.share()` y `wa.me/?text=`)
- **PWA**: Service Worker para caché offline y manifest para instalar en el móvil
- **APK Android**: compilación con Capacitor 8 para instalar como app nativa
- **Login de inquilinos**: Cada inquilino puede acceder a `/mi-apto` con su número de apartamento y un código de 4 dígitos generado aleatoriamente.

---

## Estructura del Proyecto

```
Proyecto Laujim APP/
├── index.html                  # Entry point HTML (SW condicional según Capacitor)
├── vite.config.js              # Vite + React + Tailwind + proxy /api → :1011
├── server.cjs                  # Servidor Express (API REST + static files)
├── package.json                # Dependencias y scripts (v1.0.0)
├── capacitor.config.json       # appId: com.laujim.aptmanager, scheme: http
├── capacitor.json              # (duplicado obsoleto, mantiene Capacitor config)
│
├── public/
│   ├── manifest.json           # Web App Manifest (PWA)
│   ├── sw.js                   # Service Worker (caché offline de assets)
│   ├── icons.svg               # Ícono SVG adaptable 512×512
│   └── app-debug.apk           # APK generado (copia para descarga directa)
│
├── src/
│   ├── main.jsx                # Entry point React (StrictMode, ErrorBoundary)
│   ├── App.jsx                 # Router + init (DB, notificaciones, auto-sync)
│   ├── index.css               # @import "tailwindcss"
│   ├── api.js                  # Capa de datos: IndexedDB + sync queue + server ops
│   ├── db/
│   │   └── database.js         # Dexie schema v5 + seed data (12 aptos, 2 usuarios, passwords)
│   ├── components/
│   │   ├── Layout.jsx          # Sidebar responsive + navegación principal
│   │   ├── Modal.jsx           # Modal/dialog reutilizable
│   │   ├── StatsCard.jsx       # Tarjeta de estadística con ícono y color
│   │   ├── ErrorBoundary.jsx   # Captura errores de renderizado
│   │   └── VersionBanner.jsx   # Banner de nueva versión disponible
│   ├── pages/
│   │   ├── Dashboard.jsx       # Resumen stats, ocupación, próximos pagos
│   │   ├── Apartments.jsx      # Lista con búsqueda, filtros, CRUD
│   │   ├── ApartmentDetail.jsx # Detalle completo con fotos, familia, finanzas
│   │   ├── Tenants.jsx         # Gestión de inquilinos
│   │   ├── Contracts.jsx       # Contratos + subida de PDF
│   │   ├── Payments.jsx        # Pagos de renta + gastos
│   │   ├── Utilities.jsx       # Servicios públicos (agua, gas, luz) + grilla pagos masivos
│   │   ├── Reports.jsx         # Reportes con gráficos Recharts
│   │   ├── ShareApartments.jsx # Página compartir: iframe, PDF, WhatsApp, Gmail
│   │   ├── ContractGenerator.jsx # Formulario generador de contratos de arrendamiento
│   │   ├── Settings.jsx        # Config: URL server, sync, notif, APK, compartir
│   │   ├── Login.jsx           # Página de Login para admin e inquilinos
│   │   └── MiApto.jsx          # Vista de inquilino (info de pago, servicios, contrato)
│   └── utils/
│       ├── config.js           # URL base del server + token de auth
│       ├── helpers.js          # formatCurrency (COP), fechas, cálculos
│       ├── sync.js             # Motor de sincronización (push/pull/auto-sync 30s)
│       ├── notifications.js    # API de Notifications API
│       ├── calendar.js         # Generación de archivos ICS con RRULE
│       ├── pdf.js              # PDF de ficha de apto + HTML público de vacantes
│       ├── contractGenerator.js # Generación de PDF de contratos (jsPDF, 18 cláusulas)
│       └── auth.js             # Lógica de autenticación (loginAdmin, loginTenant, getAuth)
│
├── android/                    # Proyecto Android (Capacitor 8)
│   ├── app/src/main/AndroidManifest.xml
│   │   # cleartext traffic = true, INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS
│   ├── app/build.gradle
│   │   # compileSdk 36, minSdk 23, targetSdk 36, namespace com.laujim.aptmanager, versionName manual
│   └── gradle/
│
├── dist/                       # Build de producción (Vite)
│   ├── version.json            # Generado por scripts/generate-version.js (OBSOLETO para APK)
│   └── app-debug.apk           # APK copiado desde android/
│
├── data/                       # Base de datos del servidor (JSON)
│   └── database.json           # Persistencia del servidor Express
│
├── uploads/                    # Archivos subidos (fotos, contratos)
│   ├── photos/\n│   └── contracts/\n│\n├── scripts/\n│   ├── generate-version.js     # Genera version.json al build (OBSOLETO para APK)\n│   ├── copy-apk.js             # Copia APK de android/ a dist/ y public/\n│   ├── fix-html.js             # (referenciado en build, propósito desconocido)\n│   ├── add-passwords.js        # Genera passwords aleatorios y actualiza seeds\n│   └── sync-seed.js            # Descarga datos del servidor y actualiza seeds\n│\n├── build-apk.ps1               # Script PowerShell: build → cap copy → assembleDebug\n│                               #   JAVA_HOME=C:\\Program Files\\Eclipse Adoptium\\jdk-21*\n│                               #   ANDROID_HOME=C:\\Android, ANDROID_SDK_ROOT=C:\\Android\n├── setup-java.ps1              # Configurar JAVA_HOME (Eclipse Adoptium)\n├── setup-android-sdk.ps1       # Configurar ANDROID_HOME\n├── find-jdk21.ps1              # Buscar JDK 21 en el sistema\n├── crear-acceso-directo.ps1    # Crear acceso directo en escritorio\n├── iniciar-servidor.bat        # Menú para elegir modo local o servidor\n└── iniciar-servidor-sync.bat   # Build + iniciar servidor Express directo\n```

---

## API REST Completa

Endpoint base: `http://<host>:1011/api`
Auth header: `x-auth-token: laujim laujim`

| Método | Ruta | Descripción | Auth | Cuerpo/Params |\
|--------|------|-------------|------|---------------|\
| GET | `/version` | Versión del build (`version.json`) | No | - |\
| POST | `/login` | Login con usuario/contraseña de admin/inquilino | No | `{ username, password }` |\
| GET | `/data/all` | **NUEVO:** Obtener todas las colecciones de la BD | Sí | - |\
| POST | `/save` | **NUEVO:** Guardar todas las colecciones (bulk update/insert) | Sí | `{ collection1: [...], collection2: [...] }` |\
| GET | `/:collection` | Listar todos los registros | Sí | - |\
| GET | `/:collection/count` | Contar registros | Sí | - |\
| GET | `/:collection/:id` | Obtener uno por ID numérico | Sí | - |\
| GET | `/:collection/where/:field/:value` | Filtrar por campo exacto | Sí | - |\
| GET | `/:collection/first/:field/:value` | Primer match | Sí | - |\
| GET | `/:collection/filter/:field/:value` | Filtrar (alias de where) | Sí | - |\
| POST | `/:collection` | Crear registro | Sí | `{ ...fields }` |\
| PUT | `/:collection/:id` | Actualizar registro | Sí | `{ ...fields }` |\
| DELETE | `/:collection/:id` | Eliminar registro | Sí | - |\
| POST | `/bulk-add/:collection` | Crear múltiples registros | Sí | `[{ ... }, ...]` |\
| POST | `/upload/photo` | Subir foto de apto | Sí | FormData: `photo` (file) + `apartmentId` |\
| DELETE | `/photo/:id` | Eliminar foto (archivo + DB) | Sí | - |\
| POST | `/upload/contract` | Subir contrato PDF | Sí | FormData: `contract` (file) + `contractId` |\
| POST | `/generate-contract` | Iniciar generador Python de contratos | Sí | `{ ...datos del contrato }` |\

**Colecciones disponibles (12):** `apartments`, `tenants`, `contracts`, `payments`, `expenses`, `utilityPayments`, `vacancies`, `familyMembers`, `users`, `settings`, `photos`, `passwords`.

---

## Rutas del Frontend

| Ruta | Componente | Descripción |\
|------|-----------|-------------|\
| `/login` | `Login.jsx` | Página de login para administradores e inquilinos |\
| `/mi-apto` | `MiApto.jsx` | Vista del inquilino: info de pago, servicios, contrato, etc. |\
| `/publico` | `PublicApartments.jsx` | Página pública con apartamentos vacantes (para compartir) |\
| `/dashboard` | `Dashboard.jsx` | Estadísticas generales, ocupación, próximos pagos |\
| `/apartments` | `Apartments.jsx` | Lista con búsqueda, CRUD |\
| `/apartments/:id` | `ApartmentDetail.jsx` | Detalle completo: fotos, familia, contratos, finanzas |\
| `/tenants` | `Tenants.jsx` | Inquilinos con búsqueda y contactos |\
| `/contracts` | `Contracts.jsx` | Contratos con subida de PDF |\
| `/payments` | `Payments.jsx` | Pagos y gastos con filtros |\
| `/utilities` | `Utilities.jsx` | Servicios públicos (agua/gas/luz) |\
| `/reports` | `Reports.jsx` | Reportes con gráficos Recharts |\
| `/share` | `ShareApartments.jsx` | Compartir HTML público, PDF, WhatsApp, Gmail |\
| `/generate-contract` | `ContractGenerator.jsx` | Generar contrato de arrendamiento (sin apto) |\
| `/generate-contract/:id` | `ContractGenerator.jsx` | Generar contrato con datos precargados del apto |\
| `/settings` | `Settings.jsx` | Configuración, sync, APK, compartir, notificaciones, **logout** |\
| `*` | → `/dashboard` | Redirección por defecto |\

---

## Datos Iniciales (Seed)

### Usuarios
| Usuario | Contraseña | Rol |\
|---------|-----------|-----|\
| `admin` | `laujim123` | owner |\
| `invitado` | `invitado123` | guest |\

### Apartamentos (12 unidades)
101 Casa, 102 Aparta Estudio, 201, 202, 203, 301, 302, 303, 401, 402, 403, 501 — 4 pisos, 3 aptos por piso (piso 4 tiene 4). Todos con `paymentDueDay: 5`, `status: 'vacant'`.

### Contraseñas de Inquilinos
Generadas aleatoriamente (4 dígitos). Se pueden ver y regenerar en **Settings → Acceso de Inquilinos**.

---

## Requerimientos del Sistema

### Para desarrollo/web local
-   **Node.js** 18+ (probado con 22+)
-   **npm** 9+
-   Navegador moderno (Chrome, Firefox, Edge)

### Para compilar APK (Android)
-   **Java JDK 21** (Eclipse Adoptium: `C:\Program Files\Eclipse Adoptium\jdk-21.x.x`)
-   **Android SDK** (en `C:\Android`)
-   Variables de entorno:
    -   `JAVA_HOME` → ruta del JDK 21
    -   `ANDROID_HOME` → `C:\Android`
    -   `ANDROID_SDK_ROOT` → `C:\Android`

### Dependencias npm
| Paquete | Versión | Tipo |\
|---------|---------|------|\
| react | ^19.2.7 | Dep |\
| react-dom | ^19.2.7 | Dep |\
| react-router-dom | ^7.18.1 | Dep |\
| dexie | ^4.4.4 | Dep |\
| lucide-react | ^1.25.0 | Dep |\
| recharts | ^3.9.2 | Dep |\
| jspdf | ^4.2.1 | Dep |\
| express | ^5.2.1 | Dep |\
| multer | ^2.2.0 | Dep |\
| cors | ^2.8.6 | Dep |\
| tailwindcss | ^4.3.3 | Dep |\
| @tailwindcss/vite | ^4.3.3 | Dep |\
| @capacitor/core | ^8.4.2 | Dep |\
| @capacitor/cli | ^8.4.2 | Dep |\
| @capacitor/android | ^8.4.2 | Dep |\
| @capacitor/share | ^8.0.1 | Dep |\
| vite | ^8.1.1 | DevDep |\
| @vitejs/plugin-react | ^6.0.3 | DevDep |\
| oxlint | ^1.71.0 | DevDep |\
| @types/react | ^19.2.17 | DevDep |\
| @types/react-dom | ^19.2.3 | DevDep |\

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
npm run sync-seed         # NUEVO: Descarga datos del servidor y actualiza los archivos seed (data/database.json, db.cjs, src/db/database.js)
```

---

## Sync (Offline-First)

### Flujo
1.  **Local (IndexedDB/Dexie)**: operaciones de lectura/escritura principales
2.  **Sync Queue** (`localStorage apt_pending_ops`): acumula operaciones POST/PUT/DELETE
3.  **Auto-sync** cada 30 segundos (`src/utils/sync.js:startAutoSync()`):
    -   Push: envía operaciones pendientes al servidor en orden FIFO
    -   Pull: para cada colección, hace GET, limpia IndexedDB, bulkAdd
4.  **Botón "Guardar Todo" (Settings)**: Envía una copia completa de todas las colecciones de IndexedDB al servidor (`/api/save`). **Uso recomendado antes de cada deploy en Render.com.**
5.  **Sin conexión**: el app funciona 100% offline con datos locales
6.  **Con conexión**: replica automáticamente al servidor
7.  **Detección de cambios**: `syncAllWithChanges()` compara pagos antes/después via JSON.stringify
8.  **Desde Settings**: botón "Sincronizar Ahora" (push+pull), botón "Pull" (solo traer datos), botón **"Limpiar Ops Pendientes"** (elimina operaciones atascadas en la cola).

### Formato de la Sync Queue
```json
{
  "method": "POST" | "PUT" | "DELETE",
  "collection": "apartments",
  "data": { ... },
  "id": 123,
  "localId": 123,
  "_id": "1721312345678_abc123",
  "_createdAt": "2026-07-18T12:00:00.000Z"
}
```

---

## Notas Regionales

-   **Moneda**: COP (Peso Colombiano, formato `es-CO` con `Intl.NumberFormat`)
-   **Idioma**: Español
-   **Servicios públicos**: Barranquilla (Triple A, Gases del Caribe, Air-e)
-   **Código país WhatsApp**: +57
-   **Zona horaria**: America/Bogota (usada en version.json y cálculos de fecha)

---

## APK — Problemas Conocidos y Soluciones

### La APK compila pero no funciona / pantalla en blanco
1.  **`usesCleartextTraffic`**: Android 9+ bloquea HTTP por defecto. Ya agregado en `AndroidManifest.xml`:
    ```xml
    android:usesCleartextTraffic="true"
    ```
2.  **URL del servidor**: La APK usa el `DEFAULT_SERVER` de `src/utils/config.js`. Si tu servidor no está en la misma red local que la APK, no funcionará. Para Render.com, la APK debe tener permisos de red para acceder a la URL de Render.
3.  **Service Worker**: Deshabilitado automáticamente cuando se detecta Capacitor (`index.html` línea 14-22). El SW interfiere con la carga de assets en WebView.
4.  **`androidScheme: "http"`**: Ya configurado en `capacitor.config.json`. Necesario para HTTP plano.
5.  **`allowNavigation`**: Capacitor 8 requiere whitelist de hosts. Configurado en `capacitor.config.json` con rangos `192.168.1.*`, `192.168.0.*`, `10.0.2.*`, `localhost`, `127.0.0.1`, y `*.onrender.com`.
6.  **`window.Capacitor` detection**: `config.js` usa `window.Capacitor` para detectar APK y usar `DEFAULT_SERVER` correctamente.

### La app no carga en el navegador
1.  Revisar la consola del navegador (F12) para errores JS
2.  Si React no monta, un overlay de diagnóstico aparece a los 8 segundos con el UA, errores capturados y enlaces
3.  Verificar que `npm install` se ejecutó correctamente

---

## Scripts Disponibles

| Script | Descripción |\
|--------|-------------|\
| `npm run dev` | Servidor dev Vite :5173 |\
| `npm run build` | Build producción + version.json + fix-html.js |\
| `npm run preview` | Preview del build de producción |\
| `npm run network` | Dev mode con `--host` (accesible en red local) |\
| `npm run lint` | Oxlint (react, oxc plugins) |\
| `npm run build-apk` | Build web + compilar APK + copiar a dist/ y public/ |\
| `node server.cjs` | Iniciar servidor Express :1011 |\
| `.\\build-apk.ps1` | Script PowerShell completo de build APK |\
| `.\\iniciar-servidor.bat` | Menú interactivo para elegir modo |\
| `.\\iniciar-servidor-sync.bat` | Build + servidor Express directo |\
| `npm run sync-seed` | **NUEVO:** Descarga datos del servidor (`/api/data/all`) y actualiza `data/database.json`, `db.cjs`, `src/db/database.js`. **¡CRÍTICO para guardar los datos del usuario entre deploys!** |\

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

### 2026-07-20 — v2.0.0 — Login inquilinos, persistencia de datos, mejoras UX, limpieza general
-   **New**: Sistema de Login para Administradores (`admin/laujim123`) e Inquilinos (`[número_apto]/[código_4_dígitos]`) en la ruta `/login`.
-   **New**: Página `/mi-apto` para inquilinos con su información de pago, códigos de servicios, contrato y datos del apartamento.
-   **New**: Botón **"Guardar Todo"** en Configuración (sección "Base de Datos") que permite enviar todos los datos locales (IndexedDB) al servidor (`POST /api/save`). **¡Esencial para persistir los datos antes de un deploy!**
-   **New**: Botón **"Limpiar Ops Pendientes"** en Configuración para eliminar operaciones de sincronización atascadas.
-   **New**: Endpoint en el servidor `POST /api/save` para recibir y guardar todas las colecciones de la base de datos de una vez.
-   **New**: El script `npm run sync-seed` ahora se encarga de descargar los datos vivos del servidor (`/api/data/all`) y actualizar `data/database.json`, `db.cjs`, y `src/db/database.js`, incluyendo la tabla `passwords` y el esquema v5 de Dexie.
-   **New**: Generación de contraseñas de 4 dígitos **totalmente aleatorias** para inquilinos (antes seguían un patrón). Se gestionan en Configuración → Acceso de Inquilinos.
-   **New**: Botón **"Cerrar Sesión"** en Configuración.
-   **Update**: Dashboard ahora muestra "Recolectado Total" (histórico) y "Este mes / Esperado", para una visión más clara del rendimiento.
-   **Update**: Subida de fotos en `ApartmentDetail.jsx` y `api.js` ya **no elimina fotos existentes**, sino que las añade.
-   **Update**: Página de Configuración (`Settings.jsx`) ha sido limpiada:
    -   Eliminada sección de conexión a servidor local (obsoleta con Render.com).
    -   Eliminado el generador de HTML público (ya existe la ruta `/publico`).
    -   La sección APK ahora solo enlaza a GitHub Releases para descargar la APK.
-   **Fix**: Orden de rutas en `server.cjs` corregido para que `/api/data/all` y `/api/public/vacants` no colisionen con las rutas genéricas `/:collection`.
-   **Fix**: Esquema Dexie actualizado a v5 para incluir la tabla `passwords`.
-   **Fix**: El script `scripts/add-passwords.js` fue mejorado para generar contraseñas aleatorias.
-   **Chore**: Actualizado `src/utils/sync.js` para exportar `COLLECTIONS` y soportar la limpieza de operaciones pendientes.

### 2026-07-18 — v1.0.3 — Generador de contratos + pagos de servicios + fechas de lectura
-   **New**: Generador de contratos de arrendamiento integrado en la web app (`/generate-contract`). Replica toda la lógica del generador Python en JS usando jsPDF: 18 cláusulas legales, conversión de números a letras, firmas. Se accede desde el menú lateral o desde cada detalle de apto. Los datos del apto e inquilino se precargan automáticamente.
-   **New**: Botón "Generar Contrato" en cada detalle de apartamento (junto al botón de compartir) que abre el formulario con datos precargados.
-   **New**: Página de pago de recibos de servicios públicos en Utilities.jsx — modal con tabla de 12 aptos × 3 servicios (agua/gas/luz) con checkboxes para marcar pagado/no pagado, navegación por mes (anterior/siguiente), indicador de vencimiento en rojo si han pasado 2 semanas desde la fecha de lectura, botón Guardar que crea o actualiza registros en IndexedDB.
-   **New**: Sección "Servicios Públicos" en el detalle de apartamento (`ApartmentDetail.jsx`) con navegación mes a mes, código de pago, valor, enlace "Pagar" al proveedor, botón "Pagado/No Pagado", alerta de vencimiento si pasaron 2 semanas de la fecha de lectura, y contador de recibos impagos acumulados.
-   **New**: Campos `readingDate` (fecha de lectura) en utilityPayments — se muestra en la tabla de Servicios Públicos y en el formulario de alta.
-   **New**: Campos `waterReadingDay`, `gasReadingDay`, `electricityReadingDay` en apartamentos — día del mes de lectura de cada servicio, editables desde el formulario de edición del apto, se muestran en Especificaciones del detalle.
-   **New**: Función `isOverdueByReadingDate(period, readingDay)` en helpers.js — verifica si han pasado 14+ días desde la fecha de lectura del período.
-   **New**: Funciones `nextPeriod()`, `prevPeriod()`, `getPeriodLabel()`, `getAllPeriodsFrom()`, `periodToDate()` en helpers.js para navegación entre períodos.
-   **Update**: Dexie schema v4 añade índice `paid` en utilityPayments para consultas más rápidas.
-   **Update**: Server seed data incluye `waterReadingDay: 10`, `gasReadingDay: 12`, `electricityReadingDay: 15` en todos los apartamentos.
-   **Fix**: Compartir WhatsApp en Capacitor ahora usa `Share.share()` nativo con fotos en base64 y fallback a `navigator.share()` y wa.me.
-   **Chore**: Creado `src/utils/contractGenerator.js` con lógica completa de generación de PDF de contratos en jsPDF.

### 2026-07-18 — v1.0.2 — Compartir por WhatsApp + calendario + página de compartir
-   **New**: Recordatorios de calendario ICS con RRULE mensual desde Dashboard y ApartmentDetail; UIDs fijos por apto evitan duplicados, aptos liberados generan `STATUS:CANCELLED`
-   **New**: Auto-sync con detección de cambios — `syncAllWithChanges()` compara pagos antes/después y dispara callback solo cuando hay cambios
-   **New**: Botón WhatsApp en ApartmentDetail que usa `@capacitor/share` (nativo) para compartir fotos + descripción del apto, con fallback a `navigator.share()` y `wa.me/?text=`
-   **New**: Página `/share` (ShareApartments) con previsualización en iframe, descarga HTML, guardar como PDF, compartir por WhatsApp y Gmail
-   **New**: Generación de HTML público con fotos incrustadas (base64), galería vertical centrada, `object-fit: contain` 300px, fotos fallidas omitidas con `onerror`
-   **New**: Menú lateral agrega ruta "Compartir" hacia `/share`
-   **Fix**: Fotos en HTML compartido se apilan verticalmente sin solaparse, info del apto antes que las fotos
-   **Fix**: Build APK con Java 21 (`JAVA_HOME` → `jdk-21.0.11.10-hotspot`) — Gradle 8.14.3 con Capacitor 8 requiere JDK 21 para compilar `:capacitor-android`
-   **Chore**: Instalado `@capacitor/share` para compartir nativo con fotos en Android

### 2026-07-18 — v1.0.1 — APK funcional + fixes de conectividad
-   **Fix [APK]**: Detectada instalación en Capacitor APK (`src/utils/config.js`). `window.matchMedia('(display-mode: standalone)')` **NO funciona** en Capacitor WebView, lo que hacía que `getBase()` devolviera `window.location.origin` (apuntando al servidor interno de Capacitor) en lugar del servidor real del PC. Agregada detección de `window.Capacitor` para usar `DEFAULT_SERVER` correctamente.
-   **Fix [APK]**: Agregado `allowNavigation` en `capacitor.config.json` y `capacitor.json` — Capacitor 8 requiere lista blanca de hosts a los que el WebView puede hacer fetch/navegación. Añadidos rangos `192.168.1.*`, `192.168.0.*`, `10.0.2.*`, `localhost`, `127.0.0.1`.
-   **Fix [APK]**: Compilado APK debug exitoso con Gradle 8.13, SDK 36, target 36. Tamaño: ~17.6 MB.
-   **Fix [APK]**: Agregado permiso `ACCESS_NETWORK_STATE` en `AndroidManifest.xml`.
-   **Fix [APK]**: Re-sincronizados assets web con `npx cap copy android` tras el build — los cambios en `config.js` ahora están empaquetados en el APK.
-   **Doc**: README actualizado con configuración completa de Capacitor, troubleshooting de APK, y changelog.

### 2026-07-18 — v1.0.0 — Versión inicial
-   **Fix**: Agregado `android:usesCleartextTraffic="true"` en `AndroidManifest.xml` — Android 9+ bloqueaba HTTP en WebView causando pantalla en blanco
-   **Fix**: Consolidada configuración de Capacitor en `capacitor.config.json` con `server.hostname` y `androidScheme: "http"` (el archivo `capacitor.json` duplicado no era leído por Capacitor)
-   **Fix**: Corregida ruta en `build-apk.ps1` — apuntaba a `C:\Users\jimca\Desktop\APP Laujim\android` en lugar de la ubicación real del proyecto; ahora usa `$PSScriptRoot` para ser independiente de la ubicación
-   **Fix**: Service Worker deshabilitado en Capacitor (`index.html`) — el SW interfería con la carga de assets JS/CSS en el WebView de Android
-   **Fix**: Agregados try-catch en `App.jsx` alrededor de `initDB()`, `requestNotificationPermission()`, y `startAutoSync()` para evitar que errores silenciosos bloqueen el renderizado
-   **Fix**: Esquema Dexie actualizado a v3 con nuevas colecciones (`familyMembers`, `photos`) respecto a la versión anterior
-   **Fix**: Agregada lógica de detección de Capacitor en `index.html` para desregistrar SW automáticamente
-   **New**: Dashboard con notificaciones de pago próximas, recordatorios ICS, comparativa mensual
-   **New**: Página de Detalle de Apartamento con fotos, familiares, historial financiero
-   **New**: Reportes con gráficos anuales (Recharts) y desglose de gastos
-   **New**: Generación de HTML público con apartamentos disponibles para compartir
-   **New**: Sistema de sincronización offline-first con cola de operaciones pendientes
-   **New**: Versionado automático de builds (`generate-version.js`) con banner de nueva versión
-   **New**: Módulo de servicios públicos con enlaces directos a proveedores de Barranquilla
-   **Doc**: README completo con arquitectura, API, estructura, configuración, y troubleshooting
