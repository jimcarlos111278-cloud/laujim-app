# Convertir a APK con Capacitor

## Requisitos
- Node.js (ya instalado)
- Java JDK 17+
- Android Studio (con SDK)

## Pasos

```bash
# 1. Instalar Capacitor CLI
npm install -g @capacitor/cli @capacitor/core @capacitor/android

# 2. Inicializar Capacitor
npx cap init "GestionApartamentos" "com.tuempresa.aptmanager"

# 3. Build web
npm run build

# 4. Agregar plataforma Android
npx cap add android

# 5. Sincronizar
npx cap sync

# 6. Abrir en Android Studio
npx cap open android

# 7. En Android Studio: Build > Build APK(s)
```

## Requisitos del sistema para compilar APK
- Windows, Mac o Linux
- 8GB RAM mínimo
- ~8GB espacio en disco
- Java JDK 17
- Android Studio

La app ya está lista para Capacitor. Todos los datos se guardan localmente en el navegador/dispositivo (IndexedDB), no requiere internet ni backend.
