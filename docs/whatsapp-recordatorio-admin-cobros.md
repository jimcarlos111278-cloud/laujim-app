# Plantilla administrativa de cobros

## Configuración en Meta

- Nombre: `recordatorio_admin_cobros`
- Categoría: `UTILITY`
- Idioma: `es_CO`
- Variables de cuerpo: 15, en el orden indicado abajo.

## Cuerpo

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

## Valores de ejemplo para Meta

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

El backend usa esta plantilla cuando la ventana de atención de WhatsApp está cerrada. Dentro de la ventana de 24 horas envía el detalle como texto para conservar toda la información disponible.

## Avisos de pagos recibidos

Los avisos de transferencias usan dos plantillas adicionales:

- `pago_confirmado_admin`: ocho variables; informa apartamento, inquilino, valor, origen, referencia, fecha y si la confirmación fue automática o manual.
- `pago_por_asociar`: cuatro variables y dos botones quick reply. Usa payload `payment_unknown_yes` para continuar con la asociación y `payment_unknown_no` para marcar una falsa alarma.

La definición completa y el orden exacto de variables están en [`whatsapp-plantillas.md`](./whatsapp-plantillas.md). Deben aprobarse en Meta con esos nombres, idioma `es_CO` y la misma cantidad de variables antes de activar el envío fuera de la ventana de atención.
