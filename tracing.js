'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

let started = false;

function startTracing() {
  if (started) return;
  started = true;

  const sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()]
  });

  sdk.start();

  process.on('SIGTERM', async () => {
    try {
      await sdk.shutdown();
    } catch (err) {
      console.error('Tracing shutdown error:', err.message);
    }
  });
}

module.exports = { startTracing };