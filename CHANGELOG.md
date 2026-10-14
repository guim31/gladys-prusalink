# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-14

### Added

- Prusa 3D printers in Gladys through PrusaLink, on the local network: MK4,
  MK4S, MK3.9, MK3.5, Core One, XL and MINI+ (firmware 5 or later), and the
  MK3S+ with PrusaLink on a Raspberry Pi. Up to three printers, HTTP Digest
  authentication with the password shown by the printer (or the API key of an
  older firmware, in the same field).
- One device per printer: state, file, progress, elapsed and remaining time,
  nozzle and bed temperatures and setpoints (read only), print speed, filament
  type, pause and resume buttons, and the camera image of PrusaLink on a
  Raspberry Pi. No heating command, and no cancel button on the device.
- The **3D printer** dashboard widget: progress, time left, temperatures, the
  camera image or the thumbnail of the print, state and end time, pause,
  resume and cancel (with a confirmation).
- Scene triggers: print started, finished, failed or cancelled, paused,
  attention required (filament runout, a question on the screen), printer
  error.
- Scene actions: pause, resume or cancel a print; read the printer state as a
  ready-made sentence and values.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-prusalink/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-prusalink/releases/tag/v1.0.0
