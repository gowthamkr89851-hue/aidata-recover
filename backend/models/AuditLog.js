const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  logId: { type: String, required: true, unique: true },
  fileId: { type: String, required: true },
  action: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  hash: { type: String, required: true }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
