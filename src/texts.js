// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// A device integration never receives the user's language: the `language`
// field of the configuration picks one (default: French).
// -----------------------------------------------------------------------------

/** Feature names, frozen when the device is added to Gladys. */
export const NAMES = {
  en: {
    state: 'State',
    file: 'File',
    progress: 'Progress',
    elapsed: 'Elapsed time',
    left: 'Time left',
    nozzle: 'Nozzle',
    bed: 'Bed',
    target: 'target',
    speed: 'Print speed',
    material: 'Filament',
    pause: 'Pause',
    resume: 'Resume',
    camera: 'Camera',
  },
  fr: {
    state: 'État',
    file: 'Fichier',
    progress: 'Progression',
    elapsed: 'Temps écoulé',
    left: 'Temps restant',
    nozzle: 'Buse',
    bed: 'Plateau',
    target: 'consigne',
    speed: "Vitesse d'impression",
    material: 'Filament',
    pause: 'Pause',
    resume: 'Reprise',
    camera: 'Caméra',
  },
  de: {
    state: 'Status',
    file: 'Datei',
    progress: 'Fortschritt',
    elapsed: 'Verstrichene Zeit',
    left: 'Restzeit',
    nozzle: 'Düse',
    bed: 'Druckbett',
    target: 'Soll',
    speed: 'Druckgeschwindigkeit',
    material: 'Filament',
    pause: 'Pausieren',
    resume: 'Fortsetzen',
    camera: 'Kamera',
  },
  es: {
    state: 'Estado',
    file: 'Archivo',
    progress: 'Progreso',
    elapsed: 'Tiempo transcurrido',
    left: 'Tiempo restante',
    nozzle: 'Boquilla',
    bed: 'Cama',
    target: 'consigna',
    speed: 'Velocidad de impresión',
    material: 'Filamento',
    pause: 'Pausar',
    resume: 'Reanudar',
    camera: 'Cámara',
  },
};

/** The `state` feature (text), one label per state of src/prusalink/model.js. */
export const STATE_LABELS = {
  en: {
    unreachable: 'Printer unreachable',
    unauthorized: 'Password missing or refused',
    idle: 'Idle',
    ready: 'Ready',
    busy: 'Busy',
    printing: 'Printing',
    paused: 'Paused',
    attention: 'Attention required',
    finished: 'Finished',
    stopped: 'Stopped',
    error: 'Error',
  },
  fr: {
    unreachable: 'Imprimante injoignable',
    unauthorized: 'Mot de passe absent ou refusé',
    idle: 'Au repos',
    ready: 'Prête',
    busy: 'Occupée',
    printing: 'Impression',
    paused: 'En pause',
    attention: 'Intervention requise',
    finished: 'Terminée',
    stopped: 'Arrêtée',
    error: 'Erreur',
  },
  de: {
    unreachable: 'Drucker nicht erreichbar',
    unauthorized: 'Passwort fehlt oder abgelehnt',
    idle: 'Inaktiv',
    ready: 'Bereit',
    busy: 'Beschäftigt',
    printing: 'Druckt',
    paused: 'Pausiert',
    attention: 'Eingriff nötig',
    finished: 'Fertig',
    stopped: 'Abgebrochen',
    error: 'Fehler',
  },
  es: {
    unreachable: 'Impresora inaccesible',
    unauthorized: 'Contraseña ausente o rechazada',
    idle: 'En reposo',
    ready: 'Lista',
    busy: 'Ocupada',
    printing: 'Imprimiendo',
    paused: 'En pausa',
    attention: 'Intervención necesaria',
    finished: 'Terminada',
    stopped: 'Detenida',
    error: 'Error',
  },
};

/** Text features never take an empty text. */
export const NO_FILE = {
  en: 'No file',
  fr: 'Aucun fichier',
  de: 'Keine Datei',
  es: 'Ningún archivo',
};

export const NO_MATERIAL = {
  en: 'None',
  fr: 'Aucun',
  de: 'Keines',
  es: 'Ninguno',
};

const pad = (minutes) => String(minutes).padStart(2, '0');

/** Durations: "1 h 05 min" and its translations. */
export const DURATION = {
  en: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
  fr: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
  de: { hours: (h, m) => `${h} Std. ${pad(m)} Min.`, minutes: (m) => `${m} Min.` },
  es: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
};

export function formatDuration(seconds, language) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const table = DURATION[language] ?? DURATION.en;
  const total = Math.round(seconds / 60);
  if (total < 60) {
    return table.minutes(total);
  }
  return table.hours(Math.floor(total / 60), total % 60);
}

/** Why a command was refused; thrown to Gladys or shown as a widget toast. */
export const COMMAND_ERRORS = {
  en: {
    not_printing: 'No print in progress.',
    not_paused: 'The print is not paused.',
    already_paused: 'The print is already paused.',
    unreachable: 'The printer does not answer.',
    unauthorized: 'PrusaLink refused the password.',
    unknown_device: 'This printer is not configured in the integration anymore.',
    no_camera: 'No camera image in PrusaLink.',
    image_size: 'The camera image is larger than 150 KB: lower its resolution in PrusaLink.',
    image_format: 'The camera image is neither a JPEG nor a PNG.',
  },
  fr: {
    not_printing: 'Aucune impression en cours.',
    not_paused: "L'impression n'est pas en pause.",
    already_paused: "L'impression est déjà en pause.",
    unreachable: "L'imprimante ne répond pas.",
    unauthorized: 'PrusaLink a refusé le mot de passe.',
    unknown_device: "Cette imprimante n'est plus configurée dans l'intégration.",
    no_camera: 'Aucune image de caméra dans PrusaLink.',
    image_size: "L'image de la caméra dépasse 150 Ko : baissez sa résolution dans PrusaLink.",
    image_format: "L'image de la caméra n'est ni un JPEG ni un PNG.",
  },
  de: {
    not_printing: 'Kein Druck aktiv.',
    not_paused: 'Der Druck ist nicht pausiert.',
    already_paused: 'Der Druck ist bereits pausiert.',
    unreachable: 'Der Drucker antwortet nicht.',
    unauthorized: 'PrusaLink hat das Passwort abgelehnt.',
    unknown_device: 'Dieser Drucker ist in der Integration nicht mehr eingerichtet.',
    no_camera: 'Kein Kamerabild in PrusaLink.',
    image_size: 'Das Kamerabild ist größer als 150 KB: Verringere seine Auflösung in PrusaLink.',
    image_format: 'Das Kamerabild ist weder JPEG noch PNG.',
  },
  es: {
    not_printing: 'No hay ninguna impresión en curso.',
    not_paused: 'La impresión no está en pausa.',
    already_paused: 'La impresión ya está en pausa.',
    unreachable: 'La impresora no responde.',
    unauthorized: 'PrusaLink ha rechazado la contraseña.',
    unknown_device: 'Esta impresora ya no está configurada en la integración.',
    no_camera: 'No hay imagen de cámara en PrusaLink.',
    image_size: 'La imagen de la cámara supera los 150 KB: reduzca su resolución en PrusaLink.',
    image_format: 'La imagen de la cámara no es ni JPEG ni PNG.',
  },
};

/** One multi-language object for a coded command error. */
export function commandMessage(code) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => [
      language,
      table[code] ?? table.unreachable,
    ]),
  );
}

/** The connection status of the Configuration screen. */
export const STATUS_TEXT = {
  en: {
    none: 'Enter the address and the PrusaLink password of your printer, then save.',
    invalid: (n) => `Printer ${n}: invalid address.`,
    noPassword: (n) => `Printer ${n}: enter the PrusaLink password.`,
    unauthorized: (n) => `Printer ${n}: user or password refused by PrusaLink.`,
    unreachable: (n) => `Printer ${n}: PrusaLink does not answer.`,
  },
  fr: {
    none: "Saisissez l'adresse et le mot de passe PrusaLink de votre imprimante, puis enregistrez.",
    invalid: (n) => `Imprimante ${n} : adresse invalide.`,
    noPassword: (n) => `Imprimante ${n} : saisissez le mot de passe PrusaLink.`,
    unauthorized: (n) => `Imprimante ${n} : utilisateur ou mot de passe refusé par PrusaLink.`,
    unreachable: (n) => `Imprimante ${n} : PrusaLink ne répond pas.`,
  },
  de: {
    none: 'Gib die Adresse und das PrusaLink-Passwort deines Druckers ein und speichere.',
    invalid: (n) => `Drucker ${n}: ungültige Adresse.`,
    noPassword: (n) => `Drucker ${n}: Gib das PrusaLink-Passwort ein.`,
    unauthorized: (n) => `Drucker ${n}: Benutzer oder Passwort von PrusaLink abgelehnt.`,
    unreachable: (n) => `Drucker ${n}: PrusaLink antwortet nicht.`,
  },
  es: {
    none: 'Introduzca la dirección y la contraseña PrusaLink de su impresora y guarde.',
    invalid: (n) => `Impresora ${n}: dirección no válida.`,
    noPassword: (n) => `Impresora ${n}: introduzca la contraseña de PrusaLink.`,
    unauthorized: (n) => `Impresora ${n}: usuario o contraseña rechazados por PrusaLink.`,
    unreachable: (n) => `Impresora ${n}: PrusaLink no responde.`,
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

/** The report of the "Test the connection" action. */
export const TEST_TEXT = {
  en: {
    none: 'No printer configured.',
    ok: (n, name, version, state) => `Printer ${n}: ${name}, PrusaLink ${version}, ${state}.`,
    failed: (n, state) => `Printer ${n}: ${state}.`,
  },
  fr: {
    none: 'Aucune imprimante configurée.',
    ok: (n, name, version, state) => `Imprimante ${n} : ${name}, PrusaLink ${version}, ${state}.`,
    failed: (n, state) => `Imprimante ${n} : ${state}.`,
  },
  de: {
    none: 'Kein Drucker eingerichtet.',
    ok: (n, name, version, state) => `Drucker ${n}: ${name}, PrusaLink ${version}, ${state}.`,
    failed: (n, state) => `Drucker ${n}: ${state}.`,
  },
  es: {
    none: 'No hay ninguna impresora configurada.',
    ok: (n, name, version, state) => `Impresora ${n}: ${name}, PrusaLink ${version}, ${state}.`,
    failed: (n, state) => `Impresora ${n}: ${state}.`,
  },
};

/** Toasts of the widget buttons (the widget action receives no language). */
export const DONE_TEXT = {
  pause: {
    en: 'Pause requested.',
    fr: 'Pause demandée.',
    de: 'Pause angefordert.',
    es: 'Pausa solicitada.',
  },
  resume: {
    en: 'Resume requested.',
    fr: 'Reprise demandée.',
    de: 'Fortsetzen angefordert.',
    es: 'Reanudación solicitada.',
  },
  cancel: {
    en: 'Cancellation requested.',
    fr: 'Annulation demandée.',
    de: 'Abbruch angefordert.',
    es: 'Cancelación solicitada.',
  },
};

/** The sentence of the `get_status` scene action. */
export const SENTENCE = {
  en: {
    printing: (name, state, file, percent, left) =>
      `${name}: ${state}, ${file}, ${percent} %${left ? `, ${left} left` : ''}.`,
    other: (name, state) => `${name}: ${state}.`,
  },
  fr: {
    printing: (name, state, file, percent, left) =>
      `${name} : ${state}, ${file}, ${percent} %${left ? `, encore ${left}` : ''}.`,
    other: (name, state) => `${name} : ${state}.`,
  },
  de: {
    printing: (name, state, file, percent, left) =>
      `${name}: ${state}, ${file}, ${percent} %${left ? `, noch ${left}` : ''}.`,
    other: (name, state) => `${name}: ${state}.`,
  },
  es: {
    printing: (name, state, file, percent, left) =>
      `${name}: ${state}, ${file}, ${percent} %${left ? `, quedan ${left}` : ''}.`,
    other: (name, state) => `${name}: ${state}.`,
  },
};
