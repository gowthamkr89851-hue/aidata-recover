const mongoose = require('mongoose');

const evidenceRecordSchema = new mongoose.Schema({
  evidenceId: { type: String, required: true, unique: true },
  targetFileId: { type: String, default: null },
  fileName: { type: String, required: true },
  storedPath: { type: String, required: true },
  fileSize: { type: Number, required: true },
  sha256: { type: String, required: true },
  sequenceIndex: { type: Number, default: -1 },
  status: { 
    type: String, 
    enum: ['VERIFIED', 'CANDIDATE', 'UNMATCHED', 'CORRUPTED', 'DUPLICATE'], 
    default: 'UNMATCHED' 
  },
  matchScore: { type: Number, default: 0 },
  relevanceNotes: { type: String, default: '' },
  detectedType: { type: String, default: 'UNKNOWN' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EvidenceRecord', evidenceRecordSchema);
