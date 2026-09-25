const express = require('express');
const router = express.Router();
const fs = require('fs');
const FileAnalysis = require('../models/FileAnalysis');
const EvidenceRecord = require('../models/EvidenceRecord');
const RecoveryResult = require('../models/RecoveryResult');
const AuditLog = require('../models/AuditLog');
const recoveryEngine = require('../services/recoveryEngine');
const fragmentAnalyzer = require('../services/fragmentAnalyzer');
const eventBus = require('../services/eventBus');

/**
 * POST /api/recover
 * Reconstructs file from available evidence fragments & validates
 */
router.post('/', async (req, res) => {
  try {
    const { fileId, fragmentIds = [], useAI = true, userDescription = '' } = req.body;
    const streamId = fileId || `temp_${Date.now()}`;
    eventBus.emit(streamId, { step: 'Reassembly', progressPercentage: 80, statusMessage: 'Reassembling verified evidence', details: { fragmentCount: fragmentIds.length } });

    let fileRecord = null;
    let targetFileBuffer = null;
    let targetFileName = 'recovered_target';

    if (fileId) {
      fileRecord = await FileAnalysis.findOne({ fileId });
      if (fileRecord && fs.existsSync(fileRecord.storedPath)) {
        targetFileBuffer = fs.readFileSync(fileRecord.storedPath);
        targetFileName = fileRecord.originalName;
      }
    }

    // Load evidence fragments
    let rawFragments = [];
    if (fragmentIds.length > 0) {
      const records = await EvidenceRecord.find({ evidenceId: { $in: fragmentIds } });
      rawFragments = records.map(r => ({
        filename: r.fileName,
        path: r.storedPath,
        buffer: fs.existsSync(r.storedPath) ? fs.readFileSync(r.storedPath) : Buffer.from('')
      }));
    } else if (req.body.fragments && Array.isArray(req.body.fragments)) {
      rawFragments = req.body.fragments.map(f => ({
        filename: f.filename || 'fragment.bin',
        content: f.content
      }));
    }

    // Analyze and filter fragments
    const { verifiedFragments } = fragmentAnalyzer.analyzeEvidence(targetFileBuffer, targetFileName, rawFragments);

    // Run Recovery Engine
    const result = await recoveryEngine.recoverFile({
      fileId: streamId,
      targetFileBuffer,
      targetFileName,
      evidenceFragments: verifiedFragments,
      providedEvidenceBytes: rawFragments.reduce((total, fragment) => total + (fragment.buffer?.length || 0), 0),
      useAI,
      userDescription
    });

    // Save Recovery Result DB Record
    const recoveryDoc = new RecoveryResult({
      recoveryId: result.recoveryId,
      fileId: result.fileId,
      evidenceIds: result.evidenceIds,
      recoveryMethod: result.recoveryMethod,
      recoveredFilePath: result.recoveredFilePath,
      recoveredFileSize: result.recoveredFileSize,
      dataProfile: result.dataProfile,
      recoveredSha256: result.recoveredSha256,
      recoveredPercentage: result.recoveredPercentage,
      reconstructedPercentage: result.reconstructedPercentage,
      enhancedPercentage: result.enhancedPercentage,
      aiInferredPercentage: result.aiInferredPercentage,
      unrecoverablePercentage: result.unrecoverablePercentage,
      finalClassification: result.finalClassification,
      validation: result.validation,
      userDescription: userDescription || result.userDescription || '',
      missingEvidenceFound: result.missingEvidenceFound || [],
      fragmentSummary: result.fragmentSummary || { totalFragments: 0, recoveredFragments: 0, missingFragments: 0 },
      recoveryExplanation: result.recoveryExplanation,
      limitations: result.limitations
    });
    await recoveryDoc.save();

    if (fileId) {
      await new AuditLog({
        logId: `log_rec_${result.recoveryId}`,
        fileId,
        action: 'RECOVERY_ATTEMPT',
        details: { classification: result.finalClassification, recoveredPercentage: result.recoveredPercentage },
        hash: result.recoveredSha256 || 'NO_SHA'
      }).save();
    }

    eventBus.emit(streamId, { step: 'Validation', progressPercentage: 90, statusMessage: 'Recovered artifact validated', details: result.validation });
    eventBus.emit(streamId, { step: 'AI Inference', progressPercentage: 95, statusMessage: 'Forensic classification assessed', details: { classification: result.finalClassification } });
    eventBus.emit(streamId, { step: 'Report Generation', progressPercentage: 100, statusMessage: 'Recovery pipeline complete', details: { recoveryId: result.recoveryId } });

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Recovery execution failed', details: err.message });
  }
});

module.exports = router;
