'use strict';

const { startTracing } = require('./tracing');
const amqp = require('amqplib');
const { MAIN_QUEUE } = require('./broker');

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://guest:guest@localhost:5672';
const MAX_RETRIES = 3;

startTracing();

async function startConsumer() {
  const conn = await amqp.connect(RABBIT_URL);
  const ch = await conn.createChannel();

  await ch.assertQueue(MAIN_QUEUE, {
  durable: true,
  deadLetterExchange: 'gamequest.events.dlx',
  deadLetterRoutingKey: 'dead'
});
  await ch.prefetch(1);

  console.log('[CONSUMER] started');

  ch.consume(MAIN_QUEUE, async (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString());
      const retryCount = Number(msg.properties.headers?.['x-retries'] || 0);
      const traceId = msg.properties.headers?.traceId || event.traceId || null;

      console.log(`[CONSUMER] receive type=${event.type} aggregate=${event.aggregateType}:${event.aggregateId} retry=${retryCount} traceId=${traceId}`);

      if (Math.floor(Math.random() * 5) > 3) {
        throw new Error('Random processing error');
      }

      await fakeWork(event);

      ch.ack(msg);
      console.log(`[CONSUMER] ack eventId=${event.eventId}`);
    } catch (err) {
      const retryCount = Number(msg.properties.headers?.['x-retries'] || 0);
      console.error(`[CONSUMER] fail retry=${retryCount} error=${err.message}`);

      if (retryCount + 1 >= MAX_RETRIES) {
        console.error('[CONSUMER] sending to DLQ');
        ch.nack(msg, false, false);
        return;
      }

      ch.sendToQueue(
        MAIN_QUEUE,
        msg.content,
        {
          persistent: true,
          contentType: msg.properties.contentType || 'application/json',
          messageId: msg.properties.messageId,
          headers: {
            ...msg.properties.headers,
            'x-retries': retryCount + 1
          }
        }
      );

      ch.ack(msg);
    }
  });
}

async function fakeWork(event) {
  console.log(`[CONSUMER] handled ${event.type}`);
}

startConsumer().catch(err => {
  console.error('[CONSUMER] bootstrap failed:', err);
  process.exit(1);
});