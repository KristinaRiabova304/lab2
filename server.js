'use strict';

const { startTracing } = require('./tracing');
const { initBroker } = require('./broker');
const { startOutboxPublisher } = require('./outbox-publisher');
const app = require('./app');

startTracing();

async function bootstrap() {
  await initBroker();
  startOutboxPublisher();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GameQuest API running on http://localhost:${PORT}`);
  });
}

bootstrap().catch(err => {
  console.error('Server bootstrap failed:', err);
  process.exit(1);
});