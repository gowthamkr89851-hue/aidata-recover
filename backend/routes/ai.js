const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');

/**
 * POST /api/ai/analyze
 * AI-assisted analysis for file structure, fragment relationships, and missing sections
 */
router.post('/analyze', async (req, res) => {
  try {
    const {
      detectedType = 'UNKNOWN',
      damageStatus = 'CORRUPTED',
      validFragmentCount = 0,
      recoveredBytes = 0,
      finalClassification = 'UNRECOVERABLE',
      structuralIssues = []
    } = req.body;

    const aiReport = await aiService.analyzeRecoveryContext({
      detectedType,
      damageStatus,
      validFragmentCount,
      recoveredBytes,
      finalClassification,
      structuralIssues
    });

    res.status(200).json(aiReport);
  } catch (err) {
    res.status(500).json({ error: 'AI analysis failed', details: err.message });
  }
});

router.post('/anomalies', async (req, res) => {
  try {
    const result = await aiService.detectStructuralAnomalies(req.body || {});
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'AI anomaly analysis failed', details: err.message });
  }
});

module.exports = router;
