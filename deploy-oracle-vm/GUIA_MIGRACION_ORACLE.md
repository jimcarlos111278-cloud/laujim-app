# GUÍA COMPLETA DE MIGRACIÓN: RENDER -> ORACLE VM ALWAYS FREE (149.130.160.116)

Esta guía describe cómo pasar toda la infraestructura de Laujim App a la nueva máquina virtual de Oracle Cloud, eliminando Render de forma definitiva, con base de datos PostgreSQL local de 0ms (con respaldo sincronizado a Aiven), streaming de video on-demand y soporte de dominio propio con Cloudflare.

---

## 1. Datos de tu Servidor Oracle VM
* **IP Pública Fija:** `149.130.160.116`
* **Sistema Operativo:** Ubuntu 24.04 LTS (ARM Ampere A1)
* **Recursos:** 2 OCPU / 12 GB RAM / 200 GB Disco SSD / 600 Mbps simétricos
* **Acceso SSH:** Puerto `22`, usuario `ubuntu`, llave Ed25519 (`laujim-oci-ed25519`)
* **Acceso Gráfico RDP:** Puerto `3389`, usuario `ubuntu` (archivo `Personal VM/ABRIR VM.rdp`)

---

## 2. Paso a Paso de la Migración

### PASO 1: Conectarse a la VM
Puedes conectarte por cualquiera de las dos vías:

**Opción A (Por Escritorio Remoto RDP - Recomendada):**
1. En tu Escritorio, abre el archivo RDP:
   `C:\Users\jimca\OneDrive\Escritorio\Personal VM - Completo 2026-09-11.zip` (o extráelo y haz doble clic en `ABRIR VM.rdp`).
2. Ingresa con el usuario `ubuntu` y la contraseña documentada.
3. Se abrirá el escritorio visual GNOME de Ubuntu.

**Opción B (Por SSH):**
Ejecuta en PowerShell:
```powershell
ssh -i "C:\Users\jimca\OneDrive\Escritorio\Personal VM\Acceso\Credenciales SSH\laujim-oci-ed25519" ubuntu@149.130.160.116
```

---

### PASO 2: Sincronizar los archivos del proyecto a la VM
Como tu conexión RDP tiene habilitado `redirectdrives:i:1` (unidades compartidas):
1. Dentro del escritorio de Ubuntu, abre la terminal o la app **Files (Archivos)**.
2. Tu disco `C:` de Windows está visible en:
   `/home/ubuntu/thinclient_drives/C`
3. Puedes copiar la carpeta del proyecto a la VM ejecutando en la terminal de Ubuntu:
   ```bash
   mkdir -p /home/ubuntu/laujim-app
   rsync -av --exclude 'node_modules' --exclude '.git' "/home/ubuntu/thinclient_drives/C/Proyecto Edificio Laujim APP/" /home/ubuntu/laujim-app/
   ```

---

### PASO 3: Ejecutar el Instalador Automático
En la terminal de la VM (por SSH o dentro de Ubuntu):
```bash
cd /home/ubuntu/laujim-app/deploy-oracle-vm
chmod +x install-vm.sh sync-db-aiven.sh
./install-vm.sh
```

**¿Qué hace este instalador automáticamente?**
1. Configura el firewall de Oracle/Ubuntu para abrir los puertos `80` (HTTP) y `443` (HTTPS).
2. Instala Docker y Docker Compose nativo para procesadores ARM64.
3. Levanta **PostgreSQL 16 local** en Docker (`laujim-db`) en el SSD de 200 GB.
4. Levanta el **Motor de Video EZVIZ** (FastAPI + FFmpeg ARM) en el puerto `8080`.
5. Levanta **Laujim App** (Node.js 22) en el puerto `10000`.
6. Levanta **Caddy** en los puertos `80/443` para gestionar certificados SSL automáticos.
7. Programa un cron cada 6 horas para respaldar la base de datos local hacia **Aiven**.

---

### PASO 4: Configuración en Cloudflare (Dominio y SSL)
1. Inicia sesión en tu panel de **Cloudflare**.
2. Ve a la sección **DNS > Records**:
   * Agrega un registro **A**:
     * **Name:** `@` (o tu subdominio, ej. `app`)
     * **IPv4 address:** `149.130.160.116`
     * **Proxy status:** **Proxied (Nube naranja activada)**
3. Ve a la pestaña **SSL/TLS**:
   * Selecciona el modo: **Full** (o **Full Strict**).
4. Edita el archivo `Caddyfile` en `/home/ubuntu/laujim-app/deploy-oracle-vm/Caddyfile` y coloca tu nombre de dominio exacto:
   ```caddyfile
   tu-dominio.com {
       reverse_proxy localhost:10000
   }
   ```
5. Reinicia Caddy:
   ```bash
   docker compose restart caddy
   ```

---

### PASO 5: Verificación de Servicios y Cámaras
1. **Acceso Web:** Abre `https://tu-dominio.com` en tu navegador. Deberás ver la pantalla de inicio de sesión de Laujim App con candado verde seguro.
2. **Cámaras en vivo (Inquilino y Admin):**
   * Al entrar a la sección de cámaras, el sistema solicitará el stream on-demand a `127.0.0.1:8080`.
   * El video cargará a 15/25 FPS fluidos con audio AAC.
   * Al cerrar la pestaña o salir del portal, se apaga solo a los 20 segundos.
3. **Extractor de Grabaciones (Panel Admin):**
   * En el panel de administración o abriendo `http://149.130.160.116:8080`:
   * Selecciona cámara, fecha de inicio y fin (ej. `08:10` a `08:44`).
   * Clic en **"Extraer y Generar MP4"**: descarga los fragmentos de la microSD y te entrega el archivo completo en máxima calidad QHD+ (2880×1620) en segundos.

---

### PASO 6: Apagar Render
Una vez verificado que todo funciona correctamente en la VM:
1. Ingresa a tu dashboard en **Render.com**.
2. Selecciona tu servicio web `laujim-app`.
3. Haz clic en **Settings > Suspend Service** (Suspender Servicio).
4. Manténlo suspendido durante 48 horas mientras validas que ningún inquilino reporte incidencias.
5. Luego de 48 horas, elimina el servicio en Render.

---

## 3. Resumen de Ventajas Obtenidas
| Característica | Render (Anterior) | Oracle VM (Nueva) |
| :--- | :--- | :--- |
| **Costo Mensual** | $0 (con riesgo de suspensión) | **$0.00 USD (Always Free)** |
| **Memoria RAM** | 512 MB (colapsaba con Chromium) | **12 GB RAM dedicados** |
| **CPU** | 0.1 vCPU compartida | **2 OCPU (ARM Ampere A1)** |
| **Base de Datos** | Aiven remota con latencia y límites | **Postgres local (0ms) + Backup Aiven** |
| **Disponibilidad** | Se dormía tras 15 min de inactividad | **Encendido 24/7/365 continuo** |
| **Video Cámaras** | Fotos estáticas lentas cada varios seg | **HLS continuo on-demand + Extractor MP4** |
| **Almacenamiento** | Efímero (se borraba al reiniciar) | **200 GB SSD persistente** |
