const express = require('express');
const router = express.Router();
const fs = require('fs');
const FileAnalysis = require('../models/FileAnalysis');
const EvidenceRecord = require('../models/EvidenceRecord');
const AuditLog = require('../models/AuditLog');
const fileAnalyzer = require('../services/fileAnalyzer');
const fragmentAnalyzer = require('../services/fragmentAnalyzer');
const eventBus = require('../services/eventBus');

/**
 * POST /api/analyze
 * Analyzes file signature, metadata, damage, and evidence fragment correlation
 */
router.post('/', async (req, res) => {
  try {
    const { fileId, fragmentIds = [] } = req.body;
    if (fileId) eventBus.emit(fileId, { step: 'Fragment Correlation', progressPercentage: 60, statusMessage: 'Correlating evidence fragments', details: { fragmentCount: fragmentIds.length } });

    let fileRecord = null;
    let targetBuffer = null;
    let targetName = 'target_sample';

    if (fileId) {
      fileRecord = await FileAnalysis.findOne({ fileId });
      if (fileRecord && fs.existsSync(fileRecord.storedPath)) {
        targetBuffer = fs.readFileSync(fileRecord.storedPath);
        targetName = fileRecord.originalName;
      }
    }

    // Retrieve evidence fragments from DB or request body
    let fragmentFiles = [];
    if (fragmentIds.length > 0) {
      const records = await EvidenceRecord.find({ evidenceId: { $in: fragmentIds } });
      fragmentFiles = records.map(r => ({
        filename: r.fileName,
        path: r.storedPath,
        buffer: fs.existsSync(r.storedPath) ? fs.readFileSync(r.storedPath) : Buffer.from('')
      }));
    } else if (req.body.fragments && Array.isArray(req.body.fragments)) {
      fragmentFiles = req.body.fragments.map(f => ({
        filename: f.filename || 'fragment.bin',
        content: f.content
      }));
    }

    // Run file analysis if buffer exists
    let analysisResult = null;
    if (targetBuffer) {
      analysisResult = await fileAnalyzer.analyzeFile(targetBuffer, targetName);
    }

    // Run evidence fragment matching
    const evidenceAnalysis = fragmentAnalyzer.analyzeEvidence(targetBuffer, targetName, fragmentFiles);
    if (fileId) eventBus.emit(fileId, { step: 'Signature Verification', progressPercentage: 75, statusMessage: 'Evidence signatures verified', details: { matched: evidenceAnalysis.verifiedFragments.length } });

    // Save audit log
    if (fileId) {
      await new AuditLog({
        logId: `log_analyze_${Date.now()}`,
        fileId,
        action: 'ANALYZE',
        details: { totalFragments: fragmentFiles.length, matched: evidenceAnalysis.verifiedFragments.length },
        hash: fileAnalyzer.calculateSHA256(Buffer.from(`${fileId}:ANALYZE`))
      }).save();
    }

    res.status(200).json({
      fileId: fileId || null,
      fileAnalysis: analysisResult,
      evidenceAnalysis
    });
  } catch (err) {
    res.status(500).json({ error: 'Analysis failed', details: err.message });
  }
});

module.exports = router;
