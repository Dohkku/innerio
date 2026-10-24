/**
 * Capa de notificaciones (doc 48, Fase 2).
 *
 * Firma estable, implementación según plataforma:
 *   - Móvil (Capacitor nativo): `@capacitor/local-notifications` real.
 *   - Web: no-op (la web hoy no notifica; doc 48 deja la puerta abierta).
 *
 * El selector es `Capacitor.isNativePlatform()`. El plugin se importa de
 * forma DINÁMICA solo en la rama nativa para no arrastrarlo al bundle web
 * (presupuesto <100 KB). El mismo build estático corre en web y dentro del
 * APK, así que el chunk lazy viaja en ambos pero solo se carga en móvil.
 *
 * Modelo B (recompute + reschedule): el aviso diario se programa/cancela
 * según el conteo real de Bandeja leído on-device. Respeta E2EE: todo el
 * cálculo es local, el server (que solo ve ciphertext) no participa.
 */
import { Capacitor } from '@capacitor/core';

export interface DailyTime {
  h: number;
  m: number;
}

export interface Notifier {
  /** true solo en plataforma nativa con el plugin disponible. */
  isSupported(): boolean;
  /** Pide permiso de notificaciones (Android 13+ runtime). Devuelve si quedó concedido. */
  ensurePermission(): Promise<boolean>;
  /** Programa el aviso diario recurrente a la hora dada. */
  scheduleDailyInboxCheck(time: DailyTime): Promise<void>;
  /** Cancela el aviso diario. */
  cancelDailyInboxCheck(): Promise<void>;
  /** Modelo B: con cosas en Bandeja programa el aviso; vacía, lo cancela. */
  refreshFromState(inboxCount: number, time: DailyTime): Promise<void>;
}

// id fijo del aviso diario (un único slot recurrente).
const DAILY_ID = 1001;

// Canal propio con importancia alta. En Android 8+ el sonido y el banner los
// decide el CANAL, no la notificación, y la config de un canal queda BLOQUEADA
// tras crearlo (ya no la puede cambiar la app). Por eso el id lleva versión: si
// hay que volver a forzar la config, se sube la versión y nace un canal nuevo.
// importance 4 = HIGH (sonido + banner). OJO: en ROMs muy modificadas (ColorOS
// /Realme, MIUI) el sistema puede crear el canal en silencio igualmente; ahí el
// sonido lo activa el usuario a mano en los ajustes de notificación del canal.
const CHANNEL_ID = 'inbox-reminder-v4';

// Contenido del aviso, reutilizado por el diario y por la prueba para que el
// preview sea fiel a lo que verá el usuario.
const NOTIF_TITLE = 'Innerio';
const NOTIF_BODY = '¿Repasamos la Bandeja antes de acabar el día?';

const webNotifier: Notifier = {
  isSupported: () => false,
  ensurePermission: async () => false,
  scheduleDailyInboxCheck: async () => {},
  cancelDailyInboxCheck: async () => {},
  refreshFromState: async () => {},
};

// OJO: NO devolver `mod.LocalNotifications` directamente desde una función
// async. Capacitor entrega el plugin como un Proxy que responde a CUALQUIER
// propiedad, incluido `.then`. Al resolver una promesa con ese proxy, el
// runtime lo trata como "thenable" y le invoca `.then()` (método inexistente)
// → la llamada o se cuelga para siempre o revienta con
// `"LocalNotifications.then()" is not implemented on android`. Envolverlo en un
// objeto plano rompe esa trampa: el proxy viaja como propiedad, nunca como el
// valor con el que se resuelve la promesa.
async function plugin() {
  const mod = await import('@capacitor/local-notifications');
  return { LN: mod.LocalNotifications };
}

async function ensurePermission(): Promise<boolean> {
  const { LN } = await plugin();
  // `requestPermissions` ya devuelve el estado actual si no hace falta pedir
  // (no re-muestra el diálogo si ya está concedido o denegado en firme).
  const perm = await LN.requestPermissions();
  return perm.display === 'granted';
}

// `createChannel` puede colgarse en algunas ROMs (visto en Realme/ColorOS con
// importance MAX). Es best-effort: si tarda o falla, seguimos y programamos el
// aviso igual (irá al canal por defecto). Nunca debe bloquear el envío.
async function ensureChannel(): Promise<void> {
  try {
    const { LN } = await plugin();
    const create = LN.createChannel({
      id: CHANNEL_ID,
      name: 'Recordatorio diario',
      description: 'Aviso para repasar la Bandeja',
      importance: 4, // HIGH: sonido + banner heads-up
      visibility: 1,
    });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
    await Promise.race([create, timeout]);
  } catch {
    // canal no creado: el aviso usará el canal por defecto
  }
}

async function scheduleDailyInboxCheck(time: DailyTime): Promise<void> {
  const { LN } = await plugin();
  await ensureChannel();
  await LN.schedule({
    notifications: [
      {
        id: DAILY_ID,
        title: NOTIF_TITLE,
        body: NOTIF_BODY,
        channelId: CHANNEL_ID,
        // `on: { hour, minute }` = recurrente diario a esa hora local.
        schedule: { on: { hour: time.h, minute: time.m }, allowWhileIdle: true },
      },
    ],
  });
}

async function cancelDailyInboxCheck(): Promise<void> {
  const { LN } = await plugin();
  await LN.cancel({ notifications: [{ id: DAILY_ID }] });
}

const nativeNotifier: Notifier = {
  isSupported: () => true,
  ensurePermission,
  scheduleDailyInboxCheck,
  cancelDailyInboxCheck,
  async refreshFromState(inboxCount, time) {
    if (inboxCount > 0) await scheduleDailyInboxCheck(time);
    else await cancelDailyInboxCheck();
  },
};

export const notifier: Notifier = Capacitor.isNativePlatform() ? nativeNotifier : webNotifier;
