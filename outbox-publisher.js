'use strict';

const db = require('./db');
const { publishEvent } = require('./broker');
const { isoNow } = require('./shared');

function startOutboxPublisher() {
  const timer = setInterval(async () => {
    const pending = Array.from(db.outbox.values()).filter(x => x.status === 'PENDING');

    for (const item of pending) {
      try {
        await publishEvent({
          eventId: item.eventId,
          type: item.type,
          aggregateType: item.aggregateType,
          aggregateId: item.aggregateId,
          payload: item.payload,
          createdAt: item.createdAt,
          traceId: item.traceId
        });

        item.status = 'SENT';
        item.sentAt = isoNow();

        console.log(`[OUTBOX] sent ${item.type} aggregate=${item.aggregateType}:${item.aggregateId}`);
      } catch (err) {
        console.error(`[OUTBOX] publish failed for ${item.eventId}:`, err.message);
      }
    }
  }, 1000);

  return () => clearInterval(timer);
}

module.exports = { startOutboxPublisher };