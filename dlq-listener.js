'use strict';

const amqp = require('amqplib');
const { startTracing } = require('./tracing');
const { DLQ } = require('./broker');

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://guest:guest@localhost:5672';

startTracing();

async function startDlqListener() {
  const conn = await amqp.connect(RABBIT_URL);
  const ch = await conn.createChannel();

  await ch.assertQueue(DLQ, { durable: true });

  console.log('[DLQ] listener started');

  ch.consume(DLQ, (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString());
      const traceId = msg.properties.headers?.traceId || event.traceId || null;

      console.error(`[DLQ] lost message type=${event.type} aggregate=${event.aggregateType}:${event.aggregateId} traceId=${traceId}`);
      console.error('[DLQ] payload:', event);

      ch.ack(msg);
    } catch (err) {
      console.error('[DLQ] parse error:', err.message);
      ch.ack(msg);
    }
  });
}

startDlqListener().catch(err => {
  console.error('[DLQ] bootstrap failed:', err);
  process.exit(1);
});