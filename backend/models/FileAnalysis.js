const mongoose = require('mongoose');

const fileAnalysisSchema = new mongoose.Schema({
  fileId: { type: String, required: true, unique: true },
  originalName: { type: String, required: true },
  storedPath: { type: String, required: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  fileSize: { type: Number, required: true },
  estimatedOriginalSize: { type: Number, default: 0 },
  sha256: { type: String, required: true },
  detectedType: { 
    type: String, 
    enum: ['PDF', 'PNG', 'JPG', 'CSV', 'JSON', 'TXT', 'ZIP', 'DOCX', 'MP4', 'SQLITE', 'PCAP', 'UNKNOWN'], 
    default: 'UNKNOWN' 
  },
  magicBytesHeader: { type: String, default: '' },
  magicBytesFooter: { type: String, default: '' },
  damageStatus: { 
    type: String, 
    enum: ['INTACT', 'CORRUPTED', 'TRUNCATED', 'UNKNOWN_FORMAT'], 
    default: 'CORRUPTED' 
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  structuralIssues: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('FileAnalysis', fileAnalysisSchema);
