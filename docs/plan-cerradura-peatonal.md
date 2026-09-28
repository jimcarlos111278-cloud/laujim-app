# Plan: cerradura puerta peatonal (portón principal)

Puerta: reja de tubo blanca, batiente peatonal junto al portón vehicular.

## Decisión
- Chapa: **ODIS 783 eléctrica de sobreponer 12V** (kit + transformador + receptor + 2 controles).
- Cierre: **cierrapuertas hidráulico exterior** (sin esto la chapa no engancha).
- Control: **Shelly Plus 1 / 1 Gen4** en paralelo (contacto seco sobre los 12V,
  alimentado a 110V), Auto-Off 3–5 s. RF, app y llave independientes.
- Respaldo: batería 12V ~2A (trafo ODIS la prevé). Fail-secure: sin luz, con llave.
- Llaves: 3 del kit + 9 copias = 12, con registro numerado (llave → apto).
- Extra recomendado: sensor de puerta (reed o Shelly BLU) para estado real.

## Compras
1. Kit ODIS 783 + trafo + receptor + 2 controles.
2. 9 copias de llave + registro.
3. Cierrapuertas hidráulico exterior + tornillería inox.
4. Shelly Plus 1 / 1 Gen4.
5. Batería 12V ~2A. 6. Cableado exterior + caja estanca.
7. (Opc.) sensor de puerta.

## Instalación (orden)
1. Soldar caja + chapa + cerradero; probar llave.
2. Brazo: cierra sola y engancha sin azotar.
3. Electricista: trafo→chapa, Shelly en serie al pulso, caja estanca; probar RF.
4. Shelly: Auto-Off 3–5 s, nube ON, guardar device id + cloud auth key.

## App (pendiente al tener fierro)
- Botón → endpoint server → Shelly (Cloud/local) → abre 3–5 s → auditoría
  (quién/cuándo). Reutilizar flujo "abrir portón" (`EDGE_GATEWAY`).
- Después: horarios y notificaciones de apertura.

## Estado
- [ ] Compras 1–7
- [ ] Instalación 1–4
- [ ] Botón app + auditoría
