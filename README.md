# PrusaLink for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows Prusa 3D printers through **PrusaLink**, the local web interface built
into their firmware, over the local network. No cloud, no Prusa Connect
account.

> **Developed without the hardware: feedback welcome.** The integration was
> built from the PrusaLink API description, the Home Assistant integration and
> its recorded answers, and tested against a simulator that authenticates like
> the printer firmware (HTTP Digest the way Prusa-Firmware-Buddy does it). It
> has not run on a real printer yet: please report what works and what does
> not in the [issues](https://github.com/guim31/gladys-prusalink/issues).

## Features

- **One device per printer** (up to three): state, file, progress, elapsed
  and remaining time, nozzle and bed temperatures and their setpoints, print
  speed, filament type, **Pause** and **Resume** buttons, and the camera image
  for PrusaLink on a Raspberry Pi.
- **Safe by design**: the temperatures are read only and the integration
  sends no heating command at all; there is no cancel button on the device
  (one tap would ruin a print).
- **3D printer dashboard widget**: progress gauge, time left, temperatures,
  the camera image or the thumbnail of the print, state, end time, filament,
  and pause, resume or cancel (with a confirmation).
- **Scene triggers**: print started, finished, failed or cancelled (with its
  reason), paused, attention required (filament runout, a question on the
  screen), printer error.
- **Scene actions**: pause, resume or cancel a print; read the printer state as
  a ready-made sentence and values.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- A Prusa MK4, MK4S, MK3.9, MK3.5, Core One, XL or MINI+ with a firmware 5.0
  or later and PrusaLink enabled (**Settings → Network → PrusaLink**), or an
  MK3S+ with PrusaLink on a Raspberry Pi, reachable from the Gladys machine.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-prusalink` (or find **PrusaLink** in the
   catalog).
2. In **Configuration**, enter the IP address of the printer and the PrusaLink
   password it shows, then save.
3. Add the printer from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- Every request is authenticated by HTTP Digest (user `maker`, realm
  `Printer API`), answered the way the firmware expects: no `qop`, no
  `algorithm` (firmwares before 5.2 refuse it), the nonce reused until the
  printer says it is stale. PrusaLink on a Raspberry Pi may ask for
  `qop="auth"`: handled too. When the printer offers no digest challenge (older
  firmwares), the same secret is tried once as an `X-Api-Key`; a refused digest is
  never retried as a key, which would send the password in clear.
- The container reads `/api/v1/status` every 10 s during a print and every
  30 s otherwise; `/api/v1/job` once per job (file name, thumbnail),
  `/api/printer` once a minute (filament type), `/api/v1/info` and
  `/api/version` at each connection. The devices are published with
  `should_poll: false`: Gladys does not poll them.
- Scene events are derived from two successive readings (the last answer
  before a loss of connection counts, so a print that ended meanwhile still
  fires); a short print seen only finished counts through its new job id.
- Only changed states are published (whole degrees, whole minutes), unchanged
  ones every 12 hours, and everything again when a device is added.
- What each printer has (name, filament type, camera) is kept in
  `/data/prusalink-state.json`, so a Gladys restart while the printer is off
  still publishes the same device.

## Limitations

- No file upload, no print start, no temperature or G-code command, no
  time-lapse, no Prusa Connect.
- The printer is read, not pushed: an event shorter than 10 seconds may be
  missed.
- The camera of the Core One and the MK4 only reaches Prusa Connect: no camera
  image for them.
- The XL reports a single nozzle temperature.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + simulated printers over HTTP
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
node tools/simulator.js   # a simulated printer on port 8080 (password pass-for-tests)
```

```
index.js                   SDK wiring (src/app.js registers the handlers)
src/hub.js                 printers, states, connection status, scene events, images
src/printer.js             one printer: reading loop, events, commands
src/devices.js             printer -> Gladys device, snapshot -> states
src/prusalink/client.js    HTTP client: digest, API key fallback, error kinds
src/prusalink/model.js     reading the answers, print events
src/widgets.js             "3D printer" dashboard widget
src/scenes.js              scene actions
src/texts.js               every text, in four languages
test/                      node --test; the SDK's fake Gladys, simulated PrusaLink
test/fixtures/prusalink/   PrusaLink answers (see its README)
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="prusalink" \
PRUSALINK_DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image and the
GitHub Release, but then `version` in `package.json` and in the manifest (with
the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- Home Assistant's
  [`prusalink`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/prusalink)
  integration (Apache-2.0): the set of sensors, the reading cadence, and the
  test fixtures reused in `test/fixtures/prusalink/`.
- [pyprusalink](https://github.com/home-assistant-libs/pyprusalink)
  (Apache-2.0): the answer types, and the digest workaround for firmwares
  before 5.2.
- [Prusa-Link-Web](https://github.com/prusa3d/Prusa-Link-Web) (its OpenAPI
  description of the API, read for facts only) and
  [Prusa-Firmware-Buddy](https://github.com/prusa3d/Prusa-Firmware-Buddy) (how
  the firmware challenges and checks the digest), by Prusa Research.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Prusa Research.
Prusa, Original Prusa and PrusaLink are trademarks of Prusa Research a.s.

## License

Apache-2.0
