const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const FileAnalysis = require('../models/FileAnalysis');
const EvidenceRecord = require('../models/EvidenceRecord');
const RecoveryResult = require('../models/RecoveryResult');
const AuditLog = require('../models/AuditLog');
const validationEngine = require('../services/validationEngine');
const reportService = require('../services/reportService');
const reportPdfService = require('../services/reportPdfService');
const fragmentAnalyzer = require('../services/fragmentAnalyzer');
const eventBus = require('../services/eventBus');

/**
 * POST /api/validate
 * Validates file format integrity
 */
router.post('/validate', async (req, res) => {
  try {
    const { fileId, formatType, filePath } = req.body;
    let buffer = null;

    if (filePath && fs.existsSync(filePath)) {
      buffer = fs.readFileSync(filePath);
    } else if (fileId) {
      const rec = await FileAnalysis.findOne({ fileId });
      if (rec && fs.existsSync(rec.storedPath)) {
        buffer = fs.readFileSync(rec.storedPath);
      }
    }

    if (!buffer) {
      return res.status(400).json({ error: 'No valid file buffer or path found for validation.' });
    }

    const validationResult = validationEngine.validate(buffer, formatType || 'PDF');
    res.status(200).json(validationResult);
  } catch (err) {
    res.status(500).json({ error: 'Validation request failed', details: err.message });
  }
});

/**
 * GET /api/results/:id
 * Retrieves file analysis, evidence records, and recovery result state
 */
router.get('/results/:id', async (req, res) => {
  try {
    const fileId = req.params.id;
    const fileAnalysis = await FileAnalysis.findOne({ fileId });
    const recoveryResult = await RecoveryResult.findOne({ $or: [{ fileId }, { recoveryId: fileId }] });
    const evidenceRecords = await EvidenceRecord.find({ targetFileId: fileId });
    const auditLogs = await AuditLog.find({ fileId }).sort({ timestamp: 1 });

    if (!fileAnalysis && !recoveryResult) {
      return res.status(404).json({ error: 'Recovery result or file record not found for specified ID.' });
    }

    res.status(200).json({
      fileAnalysis,
      recoveryResult,
      evidenceRecords,
      auditLogs
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve results', details: err.message });
  }
});

/**
 * GET /api/reports/:id
 * Generates and returns structured JSON/Markdown recovery report
 */
router.get('/reports/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const format = req.query.format || 'json';

    const recoveryResult = await RecoveryResult.findOne({ $or: [{ recoveryId: id }, { fileId: id }] });
    const fileAnalysis = recoveryResult ? await FileAnalysis.findOne({ fileId: recoveryResult.fileId }) : await FileAnalysis.findOne({ fileId: id });
    const evidenceRecords = fileAnalysis ? await EvidenceRecord.find({ targetFileId: fileAnalysis.fileId }) : [];
    const auditLogs = fileAnalysis ? await AuditLog.find({ fileId: fileAnalysis.fileId }) : [];

    if (!recoveryResult && !fileAnalysis) {
      return res.status(404).json({ error: 'Report not found for specified ID.' });
    }

    const reportObj = reportService.generateReport({
      fileAnalysis,
      evidenceAnalysis: { verifiedFragments: evidenceRecords },
      recoveryResult: recoveryResult || {
        recoveryId: id,
        finalClassification: 'UNRECOVERABLE',
        recoveredPercentage: 0,
        aiInferredPercentage: 0,
        unrecoverablePercentage: 100,
        fragmentSummary: { totalFragments: 0, recoveredFragments: 0, missingFragments: 0 }
      },
      auditLogs
    });
    eventBus.emit(recoveryResult?.fileId || id, { step: 'Report Generation', progressPercentage: 100, statusMessage: 'Forensic report generated', details: { reportId: reportObj.reportId } });

    if (format === 'markdown' || format === 'md') {
      res.setHeader('Content-Type', 'text/markdown');
      return res.send(reportObj.markdownContent);
    }

    res.status(200).json(reportObj.reportData);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report', details: err.message });
  }
});

router.get('/reports/:id/download', async (req, res) => {
  try {
    const id = req.params.id;
    const format = String(req.query.format || 'markdown').toLowerCase();
    const recoveryResult = await RecoveryResult.findOne({ $or: [{ recoveryId: id }, { fileId: id }] });
    const fileAnalysis = recoveryResult ? await FileAnalysis.findOne({ fileId: recoveryResult.fileId }) : await FileAnalysis.findOne({ fileId: id });
    const evidenceRecords = fileAnalysis ? await EvidenceRecord.find({ targetFileId: fileAnalysis.fileId }) : [];
    const auditLogs = fileAnalysis ? await AuditLog.find({ fileId: fileAnalysis.fileId }) : [];
    if (!recoveryResult && !fileAnalysis) return res.status(404).json({ error: 'Report not found for specified ID.' });

    const reportObj = reportService.generateReport({
      fileAnalysis,
      evidenceAnalysis: { verifiedFragments: evidenceRecords },
      recoveryResult: recoveryResult || {},
      auditLogs
    });

    if (format === 'pdf') {
      const pdfBytes = await reportPdfService.createReportPdf(reportObj.reportData);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="forensic-report-${id}.pdf"` });
      return res.send(Buffer.from(pdfBytes));
    }

    const savedMarkdownPath = path.join(__dirname, '../reports', `rep_${id}.md`);
    if (format !== 'json' && fs.existsSync(savedMarkdownPath)) {
      res.set({ 'Content-Type': 'text/markdown', 'Content-Disposition': `attachment; filename="forensic-report-${id}.md"` });
      return res.sendFile(savedMarkdownPath);
    }
    res.set({ 'Content-Type': 'text/markdown', 'Content-Disposition': `attachment; filename="forensic-report-${id}.md"` });
    res.send(reportObj.markdownContent);
  } catch (err) {
    res.status(500).json({ error: 'Report download failed', details: err.message });
  }
});

module.exports = router;
