const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const FileAnalysis = require('../models/FileAnalysis');
const EvidenceRecord = require('../models/EvidenceRecord');
const AuditLog = require('../models/AuditLog');
const fileAnalyzer = require('../services/fileAnalyzer');
const validationEngine = require('../services/validationEngine');
const eventBus = require('../services/eventBus');

const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage setup with safe filenames & non-executable permissions
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * POST /api/upload
 * Handles upload of damaged files or evidence fragments
 */
router.post('/', upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided for upload.' });
    }

    const uploadedRecords = [];
    const initialChecks = [];
    const userDescription = String(req.body.description || req.body.problem || '').trim();
    const isFragmentBatch = req.query.type === 'fragment' || req.body.isFragment === 'true';

    for (const file of req.files) {
      const buffer = fs.readFileSync(file.path);
      const fileId = `file_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const analysis = await fileAnalyzer.analyzeFile(buffer, file.originalname);
      const validation = validationEngine.validate(buffer, analysis.detectedType);
      initialChecks.push({
        fileName: file.originalname,
        detectedType: analysis.detectedType,
        damageStatus: analysis.damageStatus,
        sha256: analysis.sha256,
        structuralIssues: analysis.structuralIssues,
        validation
      });

      if (isFragmentBatch) {
        const evidenceId = `ev_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const evidenceDoc = new EvidenceRecord({
          evidenceId,
          fileName: file.originalname,
          storedPath: file.path,
          fileSize: file.size,
          sha256: analysis.sha256,
          detectedType: analysis.detectedType,
          status: 'CANDIDATE'
        });
        await evidenceDoc.save();
        eventBus.emit(evidenceId, { step: 'Upload', progressPercentage: 20, statusMessage: 'Evidence fragment uploaded', details: { fileName: file.originalname } });
        eventBus.emit(evidenceId, { step: 'Magic Byte Detection', progressPercentage: 40, statusMessage: 'Fragment signature detected', details: { detectedType: analysis.detectedType } });
        uploadedRecords.push(evidenceDoc);
      } else {
        const fileDoc = new FileAnalysis({
          fileId,
          originalName: file.originalname,
          storedPath: file.path,
          mimeType: analysis.mimeType,
          fileSize: file.size,
          estimatedOriginalSize: analysis.estimatedOriginalSize,
          sha256: analysis.sha256,
          detectedType: analysis.detectedType,
          magicBytesHeader: analysis.magicBytesHeader,
          magicBytesFooter: analysis.magicBytesFooter,
          damageStatus: analysis.damageStatus,
          metadata: analysis.metadata,
          structuralIssues: analysis.structuralIssues
        });
        await fileDoc.save();

        const auditHash = crypto.createHash('sha256').update(`${fileId}:UPLOAD:${Date.now()}`).digest('hex');
        await new AuditLog({
          logId: `log_${fileId}`,
          fileId,
          action: 'UPLOAD',
          details: { originalName: file.originalname, sha256: analysis.sha256 },
          hash: auditHash
        }).save();
        eventBus.emit(fileId, { step: 'Upload', progressPercentage: 15, statusMessage: 'Original sample uploaded', details: { fileName: file.originalname } });
        eventBus.emit(fileId, { step: 'Magic Byte Detection', progressPercentage: 30, statusMessage: 'File signature detected', details: { detectedType: analysis.detectedType } });
        eventBus.emit(fileId, { step: 'Signature Verification', progressPercentage: 45, statusMessage: 'Initial structure assessed', details: { damageStatus: analysis.damageStatus } });

        uploadedRecords.push(fileDoc);
      }
    }

    const publicRecords = uploadedRecords.map(record => {
      const item = record.toObject();
      delete item.storedPath;
      return item;
    });

    res.status(200).json({
      message: 'Files successfully uploaded and registered.',
      count: publicRecords.length,
      records: publicRecords,
      initialChecks,
      userDescription
    });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

module.exports = router;
