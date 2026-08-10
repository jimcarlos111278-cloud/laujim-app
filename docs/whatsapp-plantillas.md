# Plantillas de WhatsApp Cloud de Laujim

El servidor usa estos nombres exactamente en Render. La plantilla de cobro ya fue enviada a Meta el 10 de agosto de 2026 y está pendiente de revisión.

## 1. `saludo_inquilino`

- Categoría en Meta: Marketing.
- Idioma: Spanish (COL).
- Estado observado: Activa: calidad pendiente.

```text
Hola, {{1}}, ¿cómo estás? ¿Podemos hablar un momento?
```

Variable:

1. Nombre del inquilino.

## 2. `cobro_canon_servicios`

- Categoría en Meta: Servicio.
- Idioma: Spanish (COL).
- Estado observado: En revisión.

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

La plantilla de cobro solo podrá enviarse fuera de la ventana de atención de WhatsApp cuando Meta termine de aprobarla.
