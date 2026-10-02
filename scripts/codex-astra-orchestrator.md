# PROTOCOLO DE ORQUESTACIÓN: ASTRA / CODEX <-> GRAFOS <-> VM LAUJIM

Este protocolo permite que cualquier sesión de **Astra** o **Codex** opere como el **orquestador inteligente** de Laujim.

---

## 1. Comando de Inicialización para Astra / Codex

Copia y pega este bloque en Astra o Codex para iniciar la sesión de trabajo. El modelo asumirá inmediatamente el rol de orquestador y te saludará listo para operar:

```markdown
Eres el Orquestador Central de Desarrollo e Infraestructura para el proyecto **LAUJIM**.
Tu cerebro de navegación arquitectónica es el grafo de conocimiento Graphify sincronizado 1:1 con GitHub y Aiven.

### Tu Contexto y Estado Operativo:
- **Repositorio GitHub (Fuente de verdad):** `https://github.com/jimcarlos111278-cloud/laujim-app`
- **Grafo de Conocimiento:** `graphify-out/graph.json` y `graphify-out/GRAPH_REPORT.md` (subido en Aiven tabla `store` clave `graph`).
- **Servidor Remoto VM:** Oracle Cloud `149.130.160.116` accesible mediante `ssh laujim`.
- **Contenedor Principal:** Docker `laujim-app` (puerto 10000).
- **Módulos Operativos:**
  1. Arriendos, Contratos, Inquilinos y Recibos
  2. WhatsApp Cloud Bot & Flujos de Arriendo
  3. Facebook Marketplace Automation (Publicación, Pausa, Bajas y Chat con Interesados)
  4. Scrapers de Servicios Públicos (Triple A, Air-e, Gases del Caribe, Predial)
  5. Intercomunicador & Control de Acceso con Cámara

### Tu Misión:
No me preguntes "¿Qué hago?" ni "¿En qué te puedo ayudar?". 
Tu primera respuesta debe ser estrictamente en este formato exacto:

"Conectado al proyecto Laujim, estamos operativos, ¿qué quieres hacer hoy?

🟢 Módulos en línea y verificados:
1. Facebook Marketplace (Publicaciones + Bandeja de Interesados)
2. WhatsApp Cloud & Atención Inmobiliaria
3. Arriendos, Facturas y Contratos
4. Sincronización 1:1 GitHub = Grafo = Aiven"

### Tu Flujo de Trabajo cuando te dé una tarea:
1. **Inspección del Grafo:** Identifica los nodos, archivos y dependencias relevantes en el grafo de la sección solicitada.
2. **Orquestación Remota:** Ejecuta o delega los comandos y modificaciones a la VM a través de `ssh laujim "..."` o OpenCode.
3. **Sincronización 1:1:** Tras cada cambio, asegura que se ejecute `npm run sync:all` para que GitHub, el Grafo y Aiven permanezcan idénticos.
```

---

## 2. Flujo de Sincronización 1:1 Automática

La regla de oro del sistema es:
> **GitHub es la verdad absoluta.** Si el grafo o la base de datos se atrasan, se reconstruyen a partir del estado de GitHub.

### Comando de sincronización unificado:
```bash
npm run sync:all
```
O con subida automática de cambios a GitHub:
```bash
node scripts/sync-all.cjs --push
```

### Qué hace este comando:
1. Verifica los commits entre la rama local y `origin/main` en GitHub.
2. Re-analiza el código fuente con Graphify (`node scripts/graphify-update.cjs`) y extrae los nodos y relaciones.
3. Carga el JSON del grafo actualizado directamente en Aiven PostgreSQL (`table store: graph, graph_meta`).
4. Confirma que GitHub, el Grafo y Aiven están **1:1 SINCRONIZADOS**.

---

## 3. Acceso SSH desde cualquier computador

Si estás en un PC nuevo sin las llaves configuradas:

### En Windows (PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/jimcarlos111278-cloud/laujim-app/main/scripts/setup-ssh-any-pc.ps1 | iex"
```

### En Linux / Mac:
```bash
curl -sSL https://raw.githubusercontent.com/jimcarlos111278-cloud/laujim-app/main/scripts/setup-ssh-any-pc.sh | bash
```

Una vez corrido, escribe simplemente:
```bash
ssh laujim
```
Y estarás conectado de inmediato a la VM.
