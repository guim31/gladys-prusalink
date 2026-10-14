# PrusaLink fixtures

Answers of the PrusaLink API, served by `test/helpers/fakePrusaLink.js`. No real printer was
available: they come from

- the test fixtures of the Home Assistant `prusalink` integration (Apache-2.0,
  `tests/components/prusalink/conftest.py`): `version-xl.json`, `info-xl.json`, `status-idle.json`,
  `status-printing.json`, `job-printing.json`, `printer-legacy.json`;
- the documented answer of an MK4 on firmware 6.4.0 in pyprusalink (Apache-2.0,
  `pyprusalink/types.py`): `version-mk4.json`;
- the shapes of the PrusaLink OpenAPI (`prusa3d/Prusa-Link-Web`, `spec/openapi.yaml`, facts only):
  `status-rpi-camera.json` (PrusaLink on a Raspberry Pi with a camera).

The authentication of the fake server follows the firmware of the printers
(`Prusa-Firmware-Buddy`, `lib/WUI/nhttp`): `WWW-Authenticate: Digest realm="Printer API",
nonce="<16 hex>", stale=false`, no `qop`, user `maker`, a nonce valid 300 s, `stale=true` for a
valid answer to an expired nonce, and `X-Api-Key` as the other method.
