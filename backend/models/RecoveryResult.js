const mongoose = require('mongoose');

const recoveryResultSchema = new mongoose.Schema({
  recoveryId: { type: String, required: true, unique: true },
  fileId: { type: String, required: true },
  evidenceIds: [{ type: String }],
  recoveryMethod: { 
    type: String, 
    enum: ['FRAGMENT_REASSEMBLY', 'HEADER_REPAIR', 'AI_INFERRED_STRUCTURE', 'UNRECOVERABLE'], 
    default: 'UNRECOVERABLE' 
  },
  recoveredFilePath: { type: String, default: null },
  recoveredFileSize: { type: Number, default: 0 },
  dataProfile: { type: mongoose.Schema.Types.Mixed, default: {} },
  recoveredSha256: { type: String, default: null },
  recoveredPercentage: { type: Number, default: 0 },
  reconstructedPercentage: { type: Number, default: 0 },
  enhancedPercentage: { type: Number, default: 0 },
  aiInferredPercentage: { type: Number, default: 0 },
  unrecoverablePercentage: { type: Number, default: 100 },
  finalClassification: { 
    type: String, 
    enum: ['VERIFIED_RECOVERED', 'AI_INFERRED', 'UNRECOVERABLE'], 
    required: true 
  },
  validation: {
    structureValid: { type: Boolean, default: false },
    signatureValid: { type: Boolean, default: false },
    formatConsistency: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    checks: [{ type: String }]
  },
  userDescription: { type: String, default: '' },
  missingEvidenceFound: [{ type: String }],
  fragmentSummary: {
    totalFragments: { type: Number, default: 0 },
    recoveredFragments: { type: Number, default: 0 },
    missingFragments: { type: Number, default: 0 }
  },
  recoveryExplanation: { type: String, default: '' },
  limitations: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RecoveryResult', recoveryResultSchema);
