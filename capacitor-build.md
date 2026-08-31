# Construir APK para Android

## Requisitos
- Node.js (ya lo tienes)
- Java JDK 17+
- Android Studio (con SDK)

## Pasos

```bash
# 1. Instalar herramientas de Capacitor
npm install @capacitor/core @capacitor/android

# 2. Compilar la web
npm run build

# 3. Agregar plataforma Android
npx cap add android

# 4. Sincronizar
npx cap sync

# 5. Abrir Android Studio
npx cap open android

# 6. En Android Studio: Build > Build Bundle(s) / APK(s) > Build APK(s)

# El APK se genera en:
# android/app/build/outputs/apk/debug/app-debug.apk
```

## Alternativa sin Android Studio (solo CLI)
```bash
cd android
gradlew assembleDebug
```

## Notas
- La app funciona **100% offline** sin internet
- Los datos se guardan en el teléfono (IndexedDB)
- Para compartir datos entre dispositivos, inicia el servidor en PC con `node server.cjs`
