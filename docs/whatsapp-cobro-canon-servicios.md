# Plantilla de WhatsApp: `cobro_canon_servicios`

Categoría en Meta: Servicio. Idioma: Spanish (COL). Estado actual: En revisión.

## Cuerpo para Meta

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

## Orden de variables

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

Botones configurados: `Ya pagué` y `No he pagado`. El código contempla los identificadores de Meta y los títulos visibles.

El servidor envía esta plantilla como `cobro_canon_servicios` por defecto. Meta debe aprobarla antes de enviarla fuera de la ventana de atención de 24 horas.
