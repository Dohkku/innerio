import type { CapacitorConfig } from '@capacitor/cli';

// Innerio Android shell. La UI es el build estático de apps/web; aquí solo
// configuramos el contenedor nativo. webDir apunta al output de adapter-static.
//
// Empaquetado puro (ADR-036): el build viaja DENTRO del APK, sin remote URL ni
// OTA. Cada cambio que deba llegar al móvil pasa por una release en Play.
const config: CapacitorConfig = {
  appId: 'dev.dohkku.innerio',
  appName: 'Innerio',
  webDir: '../web/build',
  android: {
    // El WebView de Android sirve los assets desde https://localhost (scheme
    // server), no file://, así que las rutas absolutas del build funcionan.
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      // Icono monocromo (silueta blanca del logo) en res/drawable-*/. Sin esto
      // Android pinta el genérico "i". `iconColor` tiñe el acento del aviso.
      smallIcon: 'ic_stat_innerio',
      iconColor: '#4C762D',
    },
  },
};

export default config;
