# Gases del Caribe — Método de extracción (referencia)

> Documento de referencia para no perder el contexto de cómo se extraen los
> valores de Gases del Caribe en el proyecto Laujim. Verificado en vivo contra
> el portal real el 31/08/2026.

## 1. Dos portales (límite de 10 cuentas)

Gases del Caribe limita cada cuenta a **10 contratos**. El edificio tiene 12
apartamentos, por lo que se necesitan **dos cuentas/portales**:

| Portal | Email | Contratos |
|--------|-------|-----------|
| Portal 1 | `arriendo.apartamentos.la.victoria@gmail.com` | 10 contratos |
| Portal 2 | `arriendo.apartamento.la.victoria@gmail.com` | 2 contratos (AP 102, AP 402) |

Ambos usan la misma contraseña: `Laujim1011.` (con punto final).

## 2. Mapeo contrato → apartamento

### Portal 1 (10 contratos)

| Contrato | Apartamento | Deuda actual | Deuda financiada | Total deuda | Fact. pend. | Próx. cuota financ. |
|----------|-------------|--------------|------------------|-------------|-------------|---------------------|
| 1036207 | Casa 101 | $46.145 | $0 | $46.145 | 1 | — |
| 66499518 | AP 203 | $0 | $152.896 | $152.896 | 0 | $5.089 |
| 66499522 | AP 201 | $0 | $149.890 | $149.890 | 0 | $5.047 |
| 66499526 | AP 302 | $0 | $149.890 | $149.890 | 0 | $5.047 |
| 66499532 | AP 401 | $0 | $149.890 | $149.890 | 0 | $5.047 |
| 66499577 | AP 303 | $2.210 | $149.890 | $152.100 | 1 | $5.047 |
| 66499585 | AP 301 | $0 | $149.890 | $149.890 | 0 | $5.047 |
| 66499589 | AP 202 | $211 | $153.339 | $153.550 | 1 | $5.104 |
| 66499604 | AP 403 | $0 | $197.696 | $197.696 | 0 | $8.348 |
| 67426719 | AP 501 | $42.680 | $184.030 | $226.710 | 1 | $20.882 |

### Portal 2 (2 contratos)

| Contrato | Apartamento | Deuda actual | Deuda financiada | Total deuda | Fact. pend. | Próx. cuota financ. |
|----------|-------------|--------------|------------------|-------------|-------------|---------------------|
| 48135611 | AP 102 | $0 | $70.464 | $70.464 | 0 | $4.077 |
| 66499573 | AP 402 | $0 | $149.890 | $149.890 | 0 | $5.047 |

### Correcciones de datos importantes

- **AP 202**: el DB tenía `gasPaymentCode: "66499584"` pero el contrato real es
  **`66499589`**. Código incorrecto → corregir.
- **AP 102**: el DB tenía `gasPaymentCode: "1036207"` (compartido con Casa 101),
  pero AP 102 tiene su **propio contrato `48135611`** en el Portal 2. Corregir.
- **AP 402**: el DB tenía `gasPaymentCode: "66499573"` que SÍ es correcto, pero
  está en el **Portal 2**, no en el Portal 1. El scraper debe buscar en ambos.

## 3. Facturas pendientes (julio 2026, mes actual)

| Contrato | Apartamento | Factura | Cupón | Valor | Estado |
|----------|-------------|---------|-------|-------|--------|
| 1036207 | Casa 101 | 2173737500 | 923956798 | $95.534 | PENDIENTE |
| 66499577 | AP 303 | 2173831259 | — | $2.210 | PENDIENTE |
| 66499589 | AP 202 | 2173831295 | 923956887 | $211 | PENDIENTE |
| 67426719 | AP 501 | 2173839189 | — | $85.191 | PENDIENTE |

El resto de contratos tienen la factura de julio **pagada** (no hay deuda actual).

## 4. API del portal (cómo extraer los valores)

La API base es: `https://pagosweb-production-api.innovacion-gascaribe.com`

### 4.1 Endpoint de deuda: `GET /contracts/debt/{contractId}`

Devuelve el desglose completo de la deuda. Campos clave:

```json
{
  "status": "success",
  "data": {
    "billingDate": "04-09-2026",
    "billingDateMonth": "sep.",
    "currentValue": 46145,        // Deuda actual (facturada, pendiente)
    "deferredValue": 0,           // Deuda financiada (convenios)
    "totalDebt": 46145,           // Total = currentValue + deferredValue
    "pendingBillings": 1,         // Nº de facturas pendientes
    "deferredNextPayment": { "value": 0, "date": "sep." },
    "currents": [                 // Conceptos de la deuda actual
      { "conceptDescription": "CARGO FIJO", "value": 5357, "invoiceId": 2173737500 },
      { "conceptDescription": "CONSUMO", "value": 40222, "invoiceId": 2173737500 }
    ],
    "deferreds": [                // Convenios de financiación
      { "conceptDescription": "REVISION PERIODICA", "pendingValue": 128483,
        "installmentValue": 4276, "pendingInstallments": 46, "totalInstallments": 48 }
    ]
  }
}
```

### 4.2 Endpoint de facturas: `GET /invoices/{contractId}`

Devuelve el historial de facturas (6 por contrato). Campos clave:

```json
{
  "status": "success",
  "data": [
    {
      "id": 2173831295,           // Nº factura
      "contractId": 66499589,
      "month": 7, "year": 2026,   // Mes/año de facturación
      "couponId": 923956887,      // Nº cupón
      "couponValue": 211,         // Valor de la factura
      "isPaid": false,            // ¿Pagada?
      "expirationDate": "2026-08-22T04:59:59.000Z",
      "contractAddress": "KR 10C CL 45B - 37 PISO 2 APTO 202"
    }
  ]
}
```

## 5. Autenticación (clave para que funcione)

**El problema raíz del HTTP 422:** el endpoint `/invoices/{id}` y
`/contracts/debt/{id}` requieren **una sesión autenticada** (cookie + token JWT).
Si se llama sin sesión, devuelve `422 {"errors":{"recaptcha":"El captcha no es válido"}}`.

### Cómo funciona la autenticación correcta

1. **Login** en `https://portal.gascaribe.com/login` con email + contraseña.
2. El portal guarda el token JWT en `localStorage.currentUser.token`.
3. Las peticiones a la API llevan estos headers:
   - `authorization: <JWT token>`
   - `frontendversion: 2bab6159f0b54875c848e8e3a600b41c4a5afcd5`
   - `accept: application/json, text/plain, */*`
4. La URL lleva `?g-recaptcha-response=-` (guion literal) — el portal lo envía
   siempre, pero **solo funciona con la sesión autenticada**.

### Por qué falla el scraper Android

El scraper Android (`portal-scraper.js`) usa `json()` con `credentials: 'omit'`
para llamadas cross-origin (CORS). Sin la cookie de sesión, la API exige un
token de Turnstile válido. El código actual envía `g-recaptcha-response=`
(vacío), que **siempre** devuelve 422.

**Solución:** el scraper debe usar la sesión autenticada del WebView. Como el
WebView navega a `portal.gascaribe.com` y hace login, tiene la cookie de sesión
para ese origen. La llamada a la API debe incluir la cookie de sesión (no
`credentials: 'omit'`) o usar el token JWT del `localStorage`.

## 6. Implementación en el scraper

### 6.1 Android (`android/app/src/main/assets/portal-scraper.js`)

**Fix aplicado (31/08/2026):** el bug del recaptcha vacío se corrigió en la
**línea 2339**. Antes el código enviaba `g-recaptcha-response=` (vacío), que
siempre devolvía 422. Ahora envía el guion literal `-` que el portal usa como
placeholder, y la autorización real la da el token JWT en el header
`authorization`:

```js
// ANTES (causaba 422):
const invoiceUrl = `${GAS_API}/invoices/${encodeURIComponent(candidate)}?g-recaptcha-response=${encodeURIComponent('')}`;
// DESPUÉS (corregido):
const invoiceUrl = `${GAS_API}/invoices/${encodeURIComponent(candidate)}?g-recaptcha-response=-`;
```

Verificado en vivo: con `authorization: <JWT>` (sin cookie de sesión, sin
Turnstile válido) los endpoints `/contracts`, `/contracts/debt/{id}` y
`/invoices/{id}` responden HTTP 200. El JWT se obtiene de
`localStorage.currentUser.token` tras el login (`storedToken()` en línea 1007,
enviado por `jsonWithAuthFallback()` en línea 979).

- **`runGasUi()` (línea 2590)**: es la ruta preferida (lee las tarjetas "Mis
  deudas" del DOM). Debe ser robusta para no caer en la ruta API rota.

- **Dos portales**: el scraper debe consultar AMBOS portales (10 + 2 contratos)
  y combinar los resultados. Actualmente solo consulta un portal.

### 6.2 Servidor (`services-scraper.cjs`)

- **Línea 3466**: usa `fetchPortalJson(page, ...)` que corre en el contexto de
  la página (con cookie de sesión), por lo que funciona. Solo añade
  `g-recaptcha-response` si hay token.

## 7. Resumen de valores extraídos (31/08/2026)

| Apt | Contrato | Portal | Deuda actual | Financiada | Total | Factura julio |
|-----|----------|--------|--------------|------------|-------|---------------|
| 101 | 1036207 | 1 | $46.145 | $0 | $46.145 | $95.534 (pend.) |
| 102 | 48135611 | 2 | $0 | $70.464 | $70.464 | $78.799 (pag.) |
| 201 | 66499522 | 1 | $0 | $149.890 | $149.890 | $54.469 (pag.) |
| 202 | 66499589 | 1 | $211 | $153.339 | $153.550 | $211 (pend.) |
| 203 | 66499518 | 1 | $0 | $152.896 | $152.896 | $47.738 (pag.) |
| 301 | 66499585 | 1 | $0 | $149.890 | $149.890 | $80.258 (pag.) |
| 302 | 66499526 | 1 | $0 | $149.890 | $149.890 | $16.846 (pag.) |
| 303 | 66499577 | 1 | $2.210 | $149.890 | $152.100 | $2.210 (pend.) |
| 401 | 66499532 | 1 | $0 | $149.890 | $149.890 | $28.849 (pag.) |
| 402 | 66499573 | 2 | $0 | $149.890 | $149.890 | $19.600 (pag.) |
| 403 | 66499604 | 1 | $0 | $197.696 | $197.696 | $43.025 (pag.) |
| 501 | 67426719 | 1 | $42.680 | $184.030 | $226.710 | $85.191 (pend.) |

## 8. Notas

- La "deuda actual" del endpoint `/contracts/debt` es la deuda **facturada y
  pendiente** (valores ya facturados). La factura del mes en curso puede ser
  mayor (incluye el consumo del mes que aún no se factura como deuda).
- La "deuda financiada" son los convenios de financiación (revisión periódica,
  reconexión, etc.) que se pagan en cuotas.
- El `totalDebt` = `currentValue` + `deferredValue`.
