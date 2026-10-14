// -----------------------------------------------------------------------------
// The PrusaLink simulator of the tests, on the network: listens on
// 0.0.0.0:$PORT (default 8080), password $PRUSALINK_PASSWORD, and plays a
// print in a loop (one step every $STEP_MS, default 20 s). Used to try the
// container, in its sandbox, against a printer:
//   node tools/simulator.js
// -----------------------------------------------------------------------------

import { FakePrusaLink, PASSWORD } from '../test/helpers/fakePrusaLink.js';

const fake = new FakePrusaLink({ password: process.env.PRUSALINK_PASSWORD || PASSWORD });
const port = Number(process.env.PORT) || 8080;
await fake.start(port, '0.0.0.0');
console.log(`Fake PrusaLink on port ${port}`);
const steps = [
  () => fake.setIdle('IDLE'),
  () => fake.setPrinting({ id: 200, progress: 10 }),
  () => fake.setPrinting({ id: 200, progress: 55 }),
  () => fake.setState('PAUSED'),
  () => fake.setState('PRINTING'),
  () => fake.setState('FINISHED'),
];
let step = 0;
setInterval(
  () => {
    step = (step + 1) % steps.length;
    steps[step]();
    console.log(`state ${fake.status.printer.state}`);
  },
  Number(process.env.STEP_MS) || 20_000,
);
