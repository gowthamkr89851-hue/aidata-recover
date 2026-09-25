const express = require('express');
const router = express.Router();
const eventBus = require('../services/eventBus');

router.get('/stream/:fileId', (req, res) => {
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  if (res.flushHeaders) res.flushHeaders();
  const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ step: 'Connected', timestamp: new Date().toISOString(), progressPercentage: 0, statusMessage: 'Forensic event stream connected', details: { fileId: req.params.fileId } });
  const unsubscribe = eventBus.subscribe(req.params.fileId, send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

module.exports = router;