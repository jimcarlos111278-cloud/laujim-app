# Plantillas de WhatsApp Cloud de Laujim

El servidor usa estos nombres exactamente en Render. Todas las plantillas enumeradas en este documento están aprobadas y habilitadas en producción desde el 28 de agosto de 2026.

## 1. `saludo_inquilino`

- Categoría en Meta: Marketing.
- Idioma: Spanish (COL).
- Estado: Aprobada.

```text
Hola, {{1}}, ¿cómo estás? ¿Podemos hablar un momento?
```

Variable:

1. Nombre del inquilino.

## 2. `cobro_canon_servicios`

- Categoría en Meta: Servicio.
- Idioma: Spanish (COL).
- Estado: Aprobada.

```text
Hola {{1}} 👋

Te saluda la administración de apartamentos Laujim.

🏠 Apartamento: {{2}}
📊 Canon de {{3}}: {{4}}
📅 Vencimiento: {{5}}
📌 Estado: {{6}}

⚡ Air-e — Deuda Total: {{7}}
💧 Triple A — Deuda Total: {{8}}
🔥 Gases del Caribe — Deuda Total: {{9}}

💳 Enlaces de pago:
⚡ Air-e: {{10}}
💧 Triple A: {{11}}
🔥 Gases del Caribe: {{12}}

Cuando realices el pago del canon, responde adjuntando el comprobante para validarlo. ¡Gracias!
```

Variables, en este orden:

1. Nombre del inquilino
2. Apartamento
3. Periodo
4. Valor del canon
5. Fecha de vencimiento
6. Estado del canon
7. Deuda Total Air-e
8. Deuda Total Triple A
9. Deuda Total Gases del Caribe
10. Enlace de pago Air-e
11. Enlace de pago Triple A
12. Enlace de pago Gases del Caribe

Botones configurados en Meta:

- `Ya pagué`
- `No he pagado`

El webhook acepta tanto los identificadores de botón que envíe Meta como los títulos visibles. Al confirmar el pago, solicita adjuntar el comprobante; si el inquilino indica que aún no ha pagado, responde con las instrucciones correspondientes.

## Variables de Render

```text
WHATSAPP_GREETING_TEMPLATE=saludo_inquilino
WHATSAPP_PAYMENT_REMINDER_TEMPLATE=cobro_canon_servicios
```

La plantilla de cobro puede enviarse dentro o fuera de la ventana de atención porque ya está aprobada.

## 3. `pago_confirmado_admin`

- Categoría en Meta: Utility / Servicio.
- Idioma: Spanish (COL).
- Estado: Aprobada.
- Destinatarios: los números guardados en **Configuración → Administradores WhatsApp**.
- Uso: aviso automático cuando una transferencia coincide de forma única con una regla y el canon vigente. También se envía después de que un administrador asocia manualmente un pago pendiente.

```text
💳 Pago confirmado

Apartamento: {{1}}
Inquilino: {{2}}
Valor recibido: {{3}}
Origen: {{4}}
Remitente: {{5}}
Referencia: {{6}}
Fecha: {{7}}
Estado: {{8}}
```

Variables, en este orden:

1. Apartamento asociado.
2. Nombre del inquilino asociado, o `No identificado`.
3. Valor recibido.
4. Aplicación/canal de origen, o proveedor de pago.
5. Remitente enmascarado (solo los últimos cuatro dígitos cuando aplica).
6. Referencia o transacción, o `Sin referencia`.
7. Fecha y hora en Colombia, con etiqueta `(CDT)`.
8. `Confirmado automáticamente` o `Confirmado por administrador`.

No necesita botones. Al aprobarla, crea el nombre exacto `pago_confirmado_admin` y conserva exactamente ocho variables de cuerpo.

## 4. `pago_por_asociar`

- Categoría en Meta: Utility / Servicio.
- Idioma: Spanish (COL).
- Estado: Aprobada.
- Destinatarios: los administradores configurados.
- Uso: aviso cuando el pago no tiene una coincidencia única. Mientras no se confirme, no se registra como pago de ningún apartamento.

```text
💳 Pago recibido de los apartamentos

Valor: {{1}}
Origen: {{2}}
Remitente: {{3}}
Fecha: {{4}}

¿Es un pago de los apartamentos?
```

Variables:

1. Valor recibido.
2. Proveedor o aplicación de origen.
3. Remitente enmascarado.
4. Fecha y hora en Colombia, con etiqueta `(CDT)`.

Botones de respuesta rápida, en este orden:

1. `Sí, asociar` — payload `payment_unknown_yes`.
2. `No, falsa alarma` — payload `payment_unknown_no`.

Si el administrador responde Sí, Laujim pide el número de apartamento. Si responde No, cierra el aviso sin crear un pago. Al asociarlo manualmente, se envía `pago_confirmado_admin` con estado `Confirmado por administrador`.

El servidor envía esta plantilla cuando la ventana de atención está cerrada. Si la ventana está abierta, envía el mismo aviso como texto para que la interacción pueda continuar inmediatamente. Mientras Meta revisa una plantilla antigua sin botones se puede usar `WHATSAPP_PAYMENT_REVIEW_BUTTONS=false`, pero la versión recomendada incluye los dos botones.

## 5. Lectura OCR de comprobantes

Cuando un inquilino autorizado envía una imagen o un PDF después de indicar que ya pagó, Laujim:

1. descarga el archivo de forma privada desde WhatsApp Cloud y lo conserva en R2;
2. extrae, cuando están visibles, valor, fecha, entidad y referencia usando OCR local;
3. muestra esos datos en **Pagos → Comprobantes por validar**;
4. mantiene el pago como `pending_validation` hasta que el administrador pulse **Aprobar** o **Rechazar**.

La lectura OCR es evidencia auxiliar: no confirma un pago por sí misma porque una imagen puede estar incompleta, contener un dígito mal leído o no demostrar que el dinero llegó a la cuenta. En PDFs con texto seleccionable se usa primero esa lectura y, si es un escaneo, se renderizan hasta tres páginas para OCR. El texto completo no se guarda; solo se conservan los campos extraídos y un pequeño extracto diagnóstico.

Variables opcionales:

```text
PAYMENT_OCR_ENABLED=true
PAYMENT_OCR_LANGUAGE=spa+eng
PAYMENT_OCR_MAX_BYTES=16777216
PAYMENT_OCR_MAX_PDF_PAGES=3
PAYMENT_OCR_TIMEOUT_MS=90000
```

La descarga inicial del modelo de idioma puede tardar más que las siguientes lecturas. Si el modelo o el archivo no se pueden procesar, el comprobante sigue disponible para revisión manual y se muestra `OCR no disponible`.

## 6. `recordatorio_admin_cobros`

- Categoría en Meta: Utility / Servicio.
- Idioma: Spanish (COL).
- Estado: Aprobada.
- Uso: copia administrativa del apartamento cuyo canon vence ese día.
- Programación: 08:00 a. m. Colombia (CDT, UTC-5).
- Variables de cuerpo: 15, en este orden:

```text
Hola, {{1}} 👋

Este es un recordatorio administrativo para el cobro y monitoreo del apartamento {{2}}.

📊 ESTADO DEL CANON

💰 Valor: {{3}}
📅 Vencimiento: {{4}}
📌 Estado: {{5}}

📋 ESTADO DE SERVICIOS

⚡ Air-e
Deuda del mes: {{6}}
Facturas vencidas: {{7}}
Deuda total: {{8}}

💧 Triple A
Deuda del mes: {{9}}
Deuda de convenios: {{10}}
Deuda total: {{11}}

🔥 Gases del Caribe
Deuda del mes: {{12}}
Deuda de convenios: {{13}}
Deuda total: {{14}}

🕒 Última sincronización: {{15}}
```

Valores de ejemplo para Meta:

1. Administrador
2. 303
3. $2.500.000
4. 5 de septiembre de 2026
5. Pendiente
6. $156.710
7. 1
8. $221.700
9. $213.489
10. $213.489
11. $223.679
12. $2.210
13. $149.890
14. $152.100
15. 26/08/2026, 7:55 a. m. (CDT)

Debe aprobarse en Meta con el nombre exacto `recordatorio_admin_cobros`. El servidor envía esta plantilla cuando la ventana de 24 horas está cerrada; si está abierta, envía el mismo detalle como texto. Solo se envía a los números configurados en **Configuración → Administradores WhatsApp** y no se repite para el mismo apartamento, fecha y administrador.

## 7. `cambios_servicios_admin`

- Categoría en Meta: Utility / Servicio.
- Idioma: Spanish (COL).
- Estado: Aprobada.
- Uso: aviso automático para los administradores cuando una nueva sincronización confirma que disminuyó la **Deuda Total** de uno o más servicios.
- Variables de cuerpo: 4, en este orden:

```text
🔔 Cambios detectados en servicios

Apartamentos afectados: {{1}}
Servicios con disminución: {{2}}

{{3}}

Hora de sincronización (CDT): {{4}}

La disminución es una alerta automática; verifica el pago en el portal del servicio.
```

Ejemplo de variables:

1. 3
2. 9
3. 🏠 Apartamento 203
   ⚡ Air-e: $250.000 → $100.000 · Posible pago parcial
   💧 Triple A: $45.000 → $0 · Pago total detectado
   🔥 Gases del Caribe: $80.000 → $0 · Pago total detectado

   🏠 Apartamento 302
   ⚡ Air-e: $120.000 → $0 · Pago total detectado

   🏠 Apartamento 403
   🔥 Gases del Caribe: $95.000 → $40.000 · Posible pago parcial
4. 27/08/2026, 8:15 a. m. (CDT)

Debe aprobarse en Meta con el nombre exacto `cambios_servicios_admin` y exactamente cuatro variables de cuerpo. El servidor guarda el resultado de cada notificación y evita repetir el mismo cambio.

Cuando la ventana de atención del administrador está abierta, el flujo automático es:

1. Se genera y envía la imagen global actualizada de servicios.
2. Se envía esta plantilla con el resumen de las disminuciones detectadas.

Fuera de la ventana de 24 horas, Meta no permite enviar una imagen independiente iniciada por la empresa. En ese caso se envía la plantilla y se registra que la imagen fue omitida por la regla de Meta. Si se necesita la imagen también fuera de esa ventana, debe aprobarse una variante de plantilla con encabezado multimedia; no se debe intentar evadir esa restricción con un enlace no autorizado.

## 8. Reporte interactivo de servicios públicos (HTML Ultra Ligero)

- Ruta web pública: `/reportes/servicios` o `/reporte-servicios`.
- Formato: Archivo HTML autocontenido (~25-35 KB) responsive, con tarjetas interactivas para celular, vista de tabla compacta, métricas KPI superiores, barra de última sincronización individual y buscador en vivo.
- Entrega por WhatsApp:
  1. Envía mensaje de texto ejecutivo con los totales de deuda general, Air-e, Triple A, Gases, marcas de sincronización y enlace directo al reporte interactivo (`/reportes/servicios`).
  2. Envía la imagen visual `image/png` renderizada directamente en la conversación de WhatsApp con el nuevo diseño ejecutivo, tarjetas y métricas.
- Disparadores de texto para administradores:
  - Servicios: `servicios`, `servicios publicos`, `reporte servicios`, `reporte de servicios`, `todos`, `global`.
  - Plantillas de cobro: `plantilla`, `plantillas`, `la plantilla`, `enviar plantilla`, `enviar cobros`, `recordatorios`.
