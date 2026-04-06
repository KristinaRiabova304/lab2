'use strict';

const amqp = require('amqplib');

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://guest:guest@localhost:5672';

const EXCHANGE = 'gamequest.events';
const MAIN_QUEUE = 'gamequest.events.queue';
const DLX = 'gamequest.events.dlx';
const DLQ = 'gamequest.events.dlq';
const ROUTING_KEY = 'entity.event';
const DEAD_ROUTING_KEY = 'dead';

let conn;
let confirmChannel;

async function initBroker() {
  if (confirmChannel) {
    return { conn, channel: confirmChannel };
  }

  conn = await amqp.connect(RABBIT_URL);
  confirmChannel = await conn.createConfirmChannel();

  await confirmChannel.assertExchange(EXCHANGE, 'direct', { durable: true });
  await confirmChannel.assertExchange(DLX, 'direct', { durable: true });

  await confirmChannel.assertQueue(DLQ, { durable: true });
  await confirmChannel.bindQueue(DLQ, DLX, DEAD_ROUTING_KEY);

  await confirmChannel.assertQueue(MAIN_QUEUE, {
    durable: true,
    deadLetterExchange: DLX,
    deadLetterRoutingKey: DEAD_ROUTING_KEY
  });

  await confirmChannel.bindQueue(MAIN_QUEUE, EXCHANGE, ROUTING_KEY);

  return { conn, channel: confirmChannel };
}

async function publishEvent(event) {
  const { channel } = await initBroker();

  return new Promise((resolve, reject) => {
    channel.publish(
      EXCHANGE,
      ROUTING_KEY,
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        timestamp: Date.now(),
        headers: {
          eventType: event.type,
          traceId: event.traceId || null
        }
      },
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

module.exports = {
  initBroker,
  publishEvent,
  MAIN_QUEUE,
  DLQ
};