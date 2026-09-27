# Triple A — Método de extracción (referencia)

> Documento de referencia para no perder el contexto de cómo se extraen los
> valores de Triple A (agua) en el proyecto Laujim. Verificado en vivo contra
> el portal real el 31/08/2026.

## 1. Portal y credenciales

Triple A usa **un solo portal** con todas las pólizas del edificio:

- URL: `https://portal.aaa.com.co`
- Login: `https://portal.aaa.com.co/iniciar-sesion`
- Email: `arriendo.apartamentos.la.victoria@gmail.com`
- Contraseña: `Laujim1011.` (con punto final)
- Rol: "Administrador Edificio" (12 pólizas)

## 2. Mapeo póliza → apartamento

El portal lista las pólizas por nombre (`AP 101`, `AP 102`, …) con un código
externo (`subscriptionExternalId`). **El portal tiene precedencia** sobre el
mapeo del proyecto. Se corrigieron los `waterPaymentCode` en `data/database.json`
el 31/08/2026:

| Apartamento | waterPaymentCode (corregido) | Póliza portal |
|-------------|------------------------------|---------------|
| 101 | 11156 | AP 101 |
| 102 | 800801 | AP 102 |
| 201 | 935937 | AP 201 |
| 202 | 937380 | AP 202 |
| 203 | 937381 | AP 203 |
| 301 | 974325 | AP 301 |
| 302 | 975244 | AP 302 |
| 303 | 975245 | AP 303 |
| 401 | 975247 | AP 401 |
| 402 | 975249 | AP 402 |
| 403 | 975250 | AP 403 |
| 501 | 974579 | AP 501 |

### Correcciones de datos importantes

- **AP 102**: el DB tenía `waterPaymentCode: "40135611"` pero la póliza real es
  **`800801`**. Corregir.
- **AP 201**: el DB tenía `975250` pero la póliza real es **`935937`**.
- **AP 202**: el DB tenía `975249` pero la póliza real es **`937380`**.
- **AP 203**: el DB tenía `975247` pero la póliza real es **`937381`**.
- **AP 301**: el DB tenía `975245` pero la póliza real es **`974325`**.
- **AP 303**: el DB tenía `974325` pero la póliza real es **`975245`**.
- **AP 401**: el DB tenía `937381` pero la póliza real es **`975247`**.
- **AP 402**: el DB tenía `800804` pero la póliza real es **`975249`**.
- **AP 403**: el DB tenía `937380` pero la póliza real es **`975250`**.
- **AP 501**: el DB tenía `935937` pero la póliza real es **`974579`**.

(101 y 302 ya estaban correctos.)

## 3. Autenticación (clave para que funcione)

El portal usa **NextAuth**. El flujo de autenticación para las llamadas a la API
BFF es:

1. **Login** en `https://portal.aaa.com.co/iniciar-sesion` con email + contraseña.
2. NextAuth guarda la sesión en la cookie httpOnly
   `__Secure-next-auth.session-token`.
3. Para llamar a la API BFF, el frontend primero consulta
   `GET /api/auth/session` (con la cookie de sesión), que devuelve un
   `accessToken` (JWT).
4. Ese JWT se envía como header `authorization: Bearer <token>` en todas las
   llamadas a `/bff/*`.

**Sin el header `authorization` (o con un JWT inválido), `/bff/*` devuelve
HTTP 401.** El JWT se obtiene de `/api/auth/session` → campo `accessToken`.

## 4. API BFF (cómo extraer los valores)

Base: `https://portal.aaa.com.co`

### 4.1 Lista de pólizas: `GET /bff/subscriptions`

Devuelve las 12 pólizas. Campos clave por póliza:

```json
{
  "data": [
    {
      "id": "9cf8acfb-7f97-4264-99b5-109a376b2754",  // UUID interno (para /bff/debts)
      "name": "AP 303",
      "subscriptionExternalId": "975245",            // Código externo (para /bff/invoices)
      "pendingValue": 223679,                        // Deuda total de la póliza
      "status": "in_debt",                           // paid | in_debt
      "subscriptionAddress": "CR 10C 45B 37 PI 3 AP 3"
    }
  ]
}
```

- `pendingValue` = **deuda total** de la póliza (incluye la parte financiada).
- `status` = `paid` (al día) o `in_debt` (en mora).

### 4.2 Facturas: `GET /bff/invoices/subscription/{subscriptionExternalId}`

**Importante:** usa el **código externo** (ej. `975245`), NO el UUID interno.
Si se usa el UUID, devuelve HTTP 500 (422 interno).

Devuelve el historial de facturas (ordenadas de más reciente a más antigua):

```json
{
  "data": {
    "invoices": [
      {
        "id": 74887896,
        "invoiceNumber": 74887896,
        "subscriptionId": 975245,
        "status": "in_debt",          // paid | in_debt
        "invoiceDate": "2026-08-20",
        "expirationDate": "2026-08-28",
        "monthValue": 178679          // Valor de la factura del mes
      }
    ]
  }
}
```

- La **deuda del mes** = `monthValue` de la factura más reciente con
  `status: "in_debt"`.
- `numFacturas` = nº de facturas sin pagar.

### 4.3 Deudas diferidas / financiación: `GET /bff/debts/{id}`

**Importante:** usa el **UUID interno** (`id` de `/bff/subscriptions`), SIN el
segmento `/subscription/`. La ruta correcta es `/bff/debts/{id}` (no
`/bff/debts/subscription/{id}` que devuelve 404).

Este endpoint devuelve las **deudas diferidas / convenios de financiación** en
el mismo envelope:

```json
{
  "totalDebts": 213489,
  "debts": [
    {
      "code": 3139488,               // Nº de financiación
      "conceptDescription": "Barrido y limpieza",
      "totalValue": 221045,          // Saldo inicial financiado
      "quotaValue": 8606,            // Valor de la cuota
      "billedQuotas": 1,
      "quotas": 24,                  // Total de cuotas
      "pendingBalance": 213489,      // Saldo pendiente
      "product": 1009752453,
      "productDescription": "Aseo Integral, Agua",
      "deferredDate": "2026-07-27T10:11:48",  // Fecha de inicio
      "paidQuotas": 0                // Cuotas pagadas
    }
  ]
}
```

- `totalDebts` = suma de los `pendingBalance` de las deudas diferidas.
- `pendingBalance` = **saldo pendiente** de la financiación.
- `quotaValue` = **valor de la cuota**.
- `paidQuotas` / `quotas` = **cuota X de Y** (ej. "0 de 24").
- `totalValue` = **saldo inicial** financiado.
- `code` = **número de financiación**.
- `deferredDate` = **fecha de inicio**.

## 5. Resumen de valores extraídos (31/08/2026)

| Apt | Código | Deuda total | Deuda mes | Financiada | Cuota | Progreso | Saldo inicial | Nº financ. |
|-----|--------|-------------|-----------|------------|-------|----------|---------------|------------|
| 101 | 11156 | $101.585 | $101.585 | $0 | — | — | — | — |
| 102 | 800801 | $151.224 | $151.224 | $12.257 | $6.128 | 1/4 | $24.513 | 3105606 |
| 201 | 935937 | $285.841 | $184.855 | $1.149 | $387 | 31/36 | $13.920 | 1162168 |
| 202 | 937380 | $0 | — | $0 | — | — | — | — |
| 203 | 937381 | $123.193 | $123.193 | $12.257 | $6.128 | 1/4 | $24.513 | 3105546 |
| 301 | 974325 | $0 | — | $0 | — | — | — | — |
| 302 | 975244 | $0 | — | $677.938 | $77.595 | 3/12 | $896.176 | 2969413 |
| 303 | 975245 | $223.679 | $178.679 | $213.489 | $8.606 | 0/24 | $221.045 | 3139488 |
| 401 | 975247 | $516.795 | $162.788 | $0 | — | — | — | — |
| 402 | 975249 | $0 | — | $0 | — | — | — | — |
| 403 | 975250 | $0 | — | $0 | — | — | — | — |
| 501 | 974579 | $47.851 | $47.851 | $0 | — | — | — | — |

Nota: **AP 302** tiene `pendingValue: 0` (póliza "al día") pero mantiene un
acuerdo de financiación activo de $677.938. El scraper lo captura por separado.

## 6. Implementación en el scraper (`services-scraper.cjs`)

### 6.1 Rutas corregidas (31/08/2026)

La función `fetchTripleAPortalSummary()` usaba rutas incorrectas que causaban
errores 404/500. Se corrigieron:

| Recurso | Ruta ANTES (rota) | Ruta AHORA (correcta) |
|---------|-------------------|-----------------------|
| Facturas | `/bff/invoices/subscription/{id}` (UUID) | `/bff/invoices/subscription/{externalId}` |
| Deudas | `/bff/debts/subscription/{id}` | `/bff/debts/{id}` |
| Deudas diferidas | `/bff/deferred-debts/subscription/{id}` | (leídas del mismo `/bff/debts/{id}`) |

### 6.2 Lógica de extracción de financiación

En `portalFinancingSummary()` se corrigieron tres cosas:

1. **`directField`**: ahora respeta el orden de prioridad de los campos. Antes
   devolvía `totalValue` (saldo inicial) en vez de `pendingBalance` (saldo
   pendiente) porque aparecía primero en el objeto. Esto hacía que
   `financiadaCOP` diera el saldo inicial en vez del saldo pendiente.
2. **`progressFrom`**: ahora combina los campos separados `paidQuotas` /
   `billedQuotas` + `quotas` en "X de Y" (ej. "0 de 24").
3. **`saldoInicialCOP`** ahora incluye `totalValue`, y **`numero`** incluye
   `code`.

### 6.3 Combinación de deuda total

La deuda total (`deudaTotalCOP`) se toma del `pendingValue` de
`/bff/subscriptions` (que ya incluye la parte financiada). La deuda del mes
(`deudaMesCOP`) viene de las facturas. La financiada (`deudaConveniosCOP`) viene
de `/bff/debts/{id}`.

## 7. Notas

- La "deuda total" (`pendingValue`) ya incluye la parte financiada; no se debe
  sumar la financiada a la deuda del mes para obtener el total.
- La "deuda del mes" es la factura más reciente sin pagar.
- La "deuda financiada" son los convenios de financiación (barrido y limpieza,
  reinstalación, suspensión, etc.) que se pagan en cuotas.
- El endpoint `/bff/debts/{id}` devuelve tanto la deuda ordinaria como la
  diferida en el mismo envelope; la financiación se identifica por los campos
  `quotaValue` / `pendingBalance` / `quotas`.
