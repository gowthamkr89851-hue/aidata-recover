const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const FileAnalysis = require('../models/FileAnalysis');
const EvidenceRecord = require('../models/EvidenceRecord');
const RecoveryResult = require('../models/RecoveryResult');
const AuditLog = require('../models/AuditLog');
const reportService = require('../services/reportService');
const { createZip, addFile, sha256 } = require('../services/zipWriter');

router.get('/compare/:id', async (req, res) => {
  try {
    const recovery = await RecoveryResult.findOne({ recoveryId: req.params.id });
    if (!recovery) return res.status(404).json({ error: 'Recovery result not found.' });
    const original = await FileAnalysis.findOne({ fileId: recovery.fileId });
    if (!original || !fs.existsSync(original.storedPath) || !recovery.recoveredFilePath || !fs.existsSync(recovery.recoveredFilePath)) {
      return res.status(404).json({ error: 'Original or recovered artifact is unavailable for comparison.' });
    }
    const originalBuffer = fs.readFileSync(original.storedPath);
    const recoveredBuffer = fs.readFileSync(recovery.recoveredFilePath);
    const originalHash = sha256(originalBuffer);
    const recoveredHash = sha256(recoveredBuffer);
    res.json({
      recoveryId: recovery.recoveryId,
      fileName: original.originalName,
      detectedType: original.detectedType,
      original: { size: originalBuffer.length, sha256: originalHash, damageStatus: original.damageStatus },
      recovered: { size: recoveredBuffer.length, sha256: recoveredHash, validation: recovery.validation },
      comparison: { byteIdentical: originalHash === recoveredHash, sizeDifference: recoveredBuffer.length - originalBuffer.length, sizeRatio: originalBuffer.length ? Math.round((recoveredBuffer.length / originalBuffer.length) * 100) : 0, originalPreserved: true }
    });
  } catch (err) {
    res.status(500).json({ error: 'Before/after comparison failed.', details: err.message });
  }
});

router.get('/download/original/:id', async (req, res) => {
  try {
    const fileAnalysis = await FileAnalysis.findOne({ fileId: req.params.id });
    const evidence = fileAnalysis ? null : await EvidenceRecord.findOne({ evidenceId: req.params.id });
    const record = fileAnalysis || evidence;

    if (!record || !record.storedPath || !fs.existsSync(record.storedPath)) {
      return res.status(404).json({ error: 'Original evidence file not found.' });
    }

    res.download(record.storedPath, record.originalName || record.fileName || 'original-evidence.bin');
  } catch (err) {
    res.status(500).json({ error: 'Original evidence download failed.', details: err.message });
  }
});

router.get('/preview/original/:id', async (req, res) => {
  try {
    const fileAnalysis = await FileAnalysis.findOne({ fileId: req.params.id });
    const evidence = fileAnalysis ? null : await EvidenceRecord.findOne({ evidenceId: req.params.id });
    const record = fileAnalysis || evidence;

    if (!record || !record.storedPath || !fs.existsSync(record.storedPath)) {
      return res.status(404).json({ error: 'Original evidence file not found.' });
    }

    const detectedType = record.detectedType || 'UNKNOWN';
    const contentTypes = { JPG: 'image/jpeg', PNG: 'image/png', PDF: 'application/pdf', TXT: 'text/plain', CSV: 'text/csv', JSON: 'application/json' };
    res.set('Content-Type', contentTypes[detectedType] || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${(record.originalName || record.fileName || 'original-evidence.bin').replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.sendFile(path.resolve(record.storedPath));
  } catch (err) {
    res.status(500).json({ error: 'Original evidence preview failed.', details: err.message });
  }
});

router.get('/download/recovered/:id', async (req, res) => {
  try {
    const recovery = await RecoveryResult.findOne({ recoveryId: req.params.id });
    if (!recovery || !recovery.recoveredFilePath || !fs.existsSync(recovery.recoveredFilePath)) {
      return res.status(404).json({ error: 'Recovered artifact not found.' });
    }
    res.download(recovery.recoveredFilePath, path.basename(recovery.recoveredFilePath));
  } catch (err) {
    res.status(500).json({ error: 'Recovered artifact download failed.', details: err.message });
  }
});

router.get('/preview/recovered/:id', async (req, res) => {
  try {
    const recovery = await RecoveryResult.findOne({ recoveryId: req.params.id });
    if (!recovery || !recovery.recoveredFilePath || !fs.existsSync(recovery.recoveredFilePath)) return res.status(404).json({ error: 'Recovered artifact not found.' });
    const fileAnalysis = await FileAnalysis.findOne({ fileId: recovery.fileId });
    const contentTypes = { JPG: 'image/jpeg', PNG: 'image/png', PDF: 'application/pdf', TXT: 'text/plain', CSV: 'text/csv', JSON: 'application/json' };
    res.set('Content-Type', contentTypes[fileAnalysis?.detectedType] || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${path.basename(recovery.recoveredFilePath)}"`);
    res.sendFile(path.resolve(recovery.recoveredFilePath));
  } catch (err) {
    res.status(500).json({ error: 'Recovered evidence preview failed.', details: err.message });
  }
});

router.get('/export/package/:id', async (req, res) => {
  try {
    const recovery = await RecoveryResult.findOne({ $or: [{ recoveryId: req.params.id }, { fileId: req.params.id }] });
    const fileId = recovery?.fileId || req.params.id;
    const fileAnalysis = await FileAnalysis.findOne({ fileId });
    const evidence = recovery ? await EvidenceRecord.find({ evidenceId: { $in: recovery.evidenceIds || [] } }) : [];
    const auditLogs = await AuditLog.find({ fileId }).sort({ timestamp: 1 });
    if (!recovery && !fileAnalysis) return res.status(404).json({ error: 'Evidence package not found.' });

    const report = reportService.generateReport({ fileAnalysis, evidenceAnalysis: { verifiedFragments: evidence }, recoveryResult: recovery || {}, auditLogs });
    const entries = [];
    addFile(entries, `original/${fileAnalysis?.originalName || 'target.bin'}`, fileAnalysis?.storedPath);
    evidence.forEach(record => addFile(entries, `fragments/${record.fileName}`, record.storedPath));
    addFile(entries, 'recovered/recovered-artifact.bin', recovery?.recoveredFilePath);
    entries.push({ name: 'reports/evidence-report.json', data: JSON.stringify(report.reportData, null, 2) });
    entries.push({ name: 'reports/evidence-report.md', data: report.markdownContent });
    let previousHash = 'GENESIS';
    const auditChain = auditLogs.map(log => {
      const entryPreviousHash = previousHash;
      const chainHash = crypto.createHash('sha256').update(`${entryPreviousHash}:${log.logId}:${log.hash}`).digest('hex');
      previousHash = chainHash;
      return { logId: log.logId, fileId: log.fileId, action: log.action, timestamp: log.timestamp, details: log.details, hash: log.hash, previousHash: entryPreviousHash, chainHash };
    });
    entries.push({ name: 'audit/audit-log-chain.json', data: JSON.stringify(auditChain, null, 2) });
    const manifest = entries.map(entry => {
      const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data));
      return { path: entry.name, size: data.length, sha256: sha256(data) };
    });
    const manifestBody = JSON.stringify({ algorithm: 'SHA-256', generatedAt: new Date().toISOString(), files: manifest }, null, 2);
    const signature = crypto.createHmac('sha256', process.env.EXPORT_SIGNING_KEY || 'development-forensic-export-key').update(manifestBody).digest('hex');
    entries.push({ name: 'MANIFEST.sha256.json', data: JSON.stringify({ ...JSON.parse(manifestBody), signature }, null, 2) });
    const archive = createZip(entries);
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="evidence-package-${req.params.id}.zip"` });
    res.send(archive);
  } catch (err) {
    res.status(500).json({ error: 'Evidence package generation failed', details: err.message });
  }
});

module.exports = router;