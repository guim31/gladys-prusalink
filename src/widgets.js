// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `printer`, "3D printer".
//
// The Gladys device box already lists every feature. What the widget adds:
// the print at a glance (progress gauge, time left, temperatures as live
// tiles), the camera image or the thumbnail of the file being printed, when
// it will finish, and the buttons that matter in the current state — pause or
// resume, cancel (with a confirmation: the device box has no cancel button on
// purpose). No heating button: this integration never heats anything.
//
// Budget (8 components, 6 tiles, 1 focal, 1 status, 4 buttons): four tiles,
// one image, one status list, two buttons at most — 8. No button opens a form,
// so Gladys 5.1 is enough.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds } from './devices.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { inPrint, isKnown } from './prusalink/model.js';
import { DONE_TEXT, STATE_LABELS, formatDuration } from './texts.js';

export { WIDGET_KEY };

export const TEXT = {
  pick: {
    en: 'Choose a Prusa printer in the widget settings.',
    fr: 'Choisissez une imprimante Prusa dans les réglages du widget.',
    de: 'Wähle einen Prusa-Drucker in den Widget-Einstellungen.',
    es: 'Elija una impresora Prusa en los ajustes del widget.',
  },
  unknown: {
    en: 'This printer is not configured in the PrusaLink integration anymore.',
    fr: "Cette imprimante n'est plus configurée dans l'intégration PrusaLink.",
    de: 'Dieser Drucker ist in der PrusaLink-Integration nicht mehr eingerichtet.',
    es: 'Esta impresora ya no está configurada en la integración PrusaLink.',
  },
  waiting: {
    en: 'Waiting for the printer to answer.',
    fr: "En attente d'une réponse de l'imprimante.",
    de: 'Warte auf eine Antwort des Druckers.',
    es: 'Esperando la respuesta de la impresora.',
  },
  progress: { en: 'Progress', fr: 'Progression', de: 'Fortschritt', es: 'Progreso' },
  left: { en: 'Time left', fr: 'Restant', de: 'Restzeit', es: 'Restante' },
  nozzle: { en: 'Nozzle', fr: 'Buse', de: 'Düse', es: 'Boquilla' },
  bed: { en: 'Bed', fr: 'Plateau', de: 'Druckbett', es: 'Cama' },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  file: { en: 'File', fr: 'Fichier', de: 'Datei', es: 'Archivo' },
  elapsed: { en: 'Elapsed', fr: 'Écoulé', de: 'Verstrichen', es: 'Transcurrido' },
  finish: { en: 'Ends at', fr: 'Fin vers', de: 'Fertig um', es: 'Termina a las' },
  targets: { en: 'Targets', fr: 'Consignes', de: 'Solltemperaturen', es: 'Consignas' },
  speed: { en: 'Speed', fr: 'Vitesse', de: 'Geschwindigkeit', es: 'Velocidad' },
  material: { en: 'Filament', fr: 'Filament', de: 'Filament', es: 'Filamento' },
  message: { en: 'Message', fr: 'Message', de: 'Meldung', es: 'Mensaje' },
  image: { en: 'Print', fr: 'Impression', de: 'Druck', es: 'Impresión' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pausieren', es: 'Pausar' },
  resume: { en: 'Resume', fr: 'Reprendre', de: 'Fortsetzen', es: 'Reanudar' },
  cancel: { en: 'Cancel', fr: 'Annuler', de: 'Abbrechen', es: 'Cancelar' },
};

const STATE_COLORS = {
  unreachable: WIDGET_COLORS.DANGER,
  unauthorized: WIDGET_COLORS.DANGER,
  error: WIDGET_COLORS.DANGER,
  idle: WIDGET_COLORS.NEUTRAL,
  ready: WIDGET_COLORS.SUCCESS,
  busy: WIDGET_COLORS.INFO,
  printing: WIDGET_COLORS.PRIMARY,
  paused: WIDGET_COLORS.WARNING,
  attention: WIDGET_COLORS.WARNING,
  finished: WIDGET_COLORS.SUCCESS,
  stopped: WIDGET_COLORS.NEUTRAL,
};

export const WIDGET_ACTIONS = ['pause', 'resume', 'cancel'];

// A new image key per minute: the core caches an image one hour by key.
const IMAGE_PERIOD_MS = 60_000;

const pick = (table, language) => table[language] ?? table.en;
const textOnly = (text, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text }],
});

function temperatureText(celsius, units) {
  const value = units === 'us' ? Math.round((celsius * 9) / 5 + 32) : Math.round(celsius);
  return `${value} °${units === 'us' ? 'F' : 'C'}`;
}

function clockTime(date, language) {
  try {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

/** A short stable hash, for image keys. */
function hash(text) {
  let h = 0;
  for (const char of text) {
    h = (Math.imul(h, 31) + char.codePointAt(0)) >>> 0;
  }
  return h.toString(36);
}

function button(language, key, icon, extra = {}) {
  return { type: 'button', label: pick(TEXT[key], language), icon, action: { key }, ...extra };
}

/** The image of the widget: the webcam if any, else the thumbnail of the job. */
function imageOf(hub, printer, snapshot, language) {
  if (!isKnown(snapshot.state)) {
    return null;
  }
  const alt = pick(TEXT.image, language);
  if (printer.capabilities.camera) {
    const period = Math.floor(hub.now() / IMAGE_PERIOD_MS);
    return { type: 'image', key: `cam-${printer.slot}-${period}`, alt, fit: 'contain' };
  }
  if (snapshot.thumbnail && snapshot.state !== 'idle' && snapshot.state !== 'ready') {
    const key = `job-${printer.slot}-${hash(`${snapshot.jobId}:${snapshot.thumbnail}`)}`;
    return { type: 'image', key, alt, fit: 'contain' };
  }
  return null;
}

/**
 * The widget content for a printer.
 * @param {object} hub
 * @param {{ settings?: object, language?: string, units?: string }} request
 */
export function buildContent(hub, { settings = {}, language = 'en', units = 'metric' }) {
  const lang = STATE_LABELS[language] ? language : 'en';
  if (typeof settings.device !== 'string' || settings.device === '') {
    return textOnly(pick(TEXT.pick, lang), 300);
  }
  const printer = [...hub.printers.values()].find(
    (p) => deviceIds(hub.gladys, p.slot).device === settings.device,
  );
  if (!printer) {
    return textOnly(pick(TEXT.unknown, lang), 300);
  }
  if (!printer.capabilities) {
    return textOnly(pick(TEXT.waiting, lang), 30);
  }
  const ids = deviceIds(hub.gladys, printer.slot);
  const snapshot = printer.link.snapshot;
  const printing = inPrint(snapshot);
  const components = [
    {
      type: 'gauge',
      label: pick(TEXT.progress, lang),
      device_feature: ids.feature('progress'),
      color: WIDGET_COLORS.PRIMARY,
    },
    { type: 'value', label: pick(TEXT.left, lang), device_feature: ids.feature('time_left') },
    {
      type: 'value',
      label: pick(TEXT.nozzle, lang),
      device_feature: ids.feature('nozzle_temperature'),
    },
    { type: 'value', label: pick(TEXT.bed, lang), device_feature: ids.feature('bed_temperature') },
  ];
  const image = imageOf(hub, printer, snapshot, lang);
  if (image) {
    components.push(image);
  }

  const items = [
    {
      label: pick(TEXT.state, lang),
      value: STATE_LABELS[lang][snapshot.state].slice(0, 40),
      color: STATE_COLORS[snapshot.state],
    },
  ];
  const known = isKnown(snapshot.state);
  if (known && snapshot.message) {
    items.push({
      label: pick(TEXT.message, lang),
      value: snapshot.message.slice(0, 40),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (known && snapshot.file) {
    items.push({ label: pick(TEXT.file, lang), value: snapshot.file.slice(0, 40), icon: 'file' });
  }
  if (printing && snapshot.printTime !== null) {
    items.push({
      label: pick(TEXT.elapsed, lang),
      value: formatDuration(snapshot.printTime, lang),
      icon: 'clock',
    });
  }
  if (snapshot.state === 'printing' && snapshot.timeLeft !== null) {
    items.push({
      label: pick(TEXT.finish, lang),
      value: clockTime(new Date(hub.now() + snapshot.timeLeft * 1000), lang),
      icon: 'flag',
    });
  }
  if (known) {
    const targets = [snapshot.nozzle.target, snapshot.bed.target]
      .filter((target) => typeof target === 'number' && target > 0)
      .map((target) => temperatureText(target, units));
    if (targets.length > 0) {
      items.push({
        label: pick(TEXT.targets, lang),
        value: targets.join(' / '),
        icon: 'thermometer',
      });
    }
    if (printing && snapshot.speed !== null) {
      items.push({ label: pick(TEXT.speed, lang), value: `${snapshot.speed} %`, icon: 'zap' });
    }
    if (printer.capabilities.material && snapshot.material) {
      items.push({ label: pick(TEXT.material, lang), value: snapshot.material, icon: 'disc' });
    }
  }
  components.push({ type: 'status', items });

  const cancel = button(lang, 'cancel', 'x-circle', { style: 'danger' });
  cancel.action.confirm = true;
  if (snapshot.state === 'printing') {
    components.push(button(lang, 'pause', 'pause'), cancel);
  } else if (snapshot.state === 'paused') {
    components.push(button(lang, 'resume', 'play'), cancel);
  } else if (printing) {
    // Attention required in a print: resuming is done on the printer.
    components.push(cancel);
  }

  return { ttl_seconds: printing ? 30 : 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (the widget action receives no language: all four). */
    async action(hub, { actionKey, settings = {} }) {
      if (!WIDGET_ACTIONS.includes(actionKey)) {
        throw new Error(`Unknown widget action ${actionKey}`);
      }
      try {
        await hub.command(settings.device, actionKey);
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
      return DONE_TEXT[actionKey];
    },
  },
};
