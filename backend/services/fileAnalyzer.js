const fs = require('fs');
const crypto = require('crypto');
const metadataExtractor = require('./metadataExtractor');

/**
 * File Magic Byte Signatures
 */
const MAGIC_SIGNATURES = [
  { type: 'PDF', headerHex: '255044462d', mime: 'application/pdf', footerHex: '2525454f46' }, // %PDF- / %%EOF
  { type: 'PNG', headerHex: '89504e470d0a1a0a', mime: 'image/png', footerHex: '49454e44ae426082' }, // IEND chunk
  { type: 'JPG', headerHex: 'ffd8ff', mime: 'image/jpeg', footerHex: 'ffd9' },
  { type: 'ZIP', headerHex: '504b0304', mime: 'application/zip', footerHex: '504b0506' },
  { type: 'DOCX', headerHex: '504b0304', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
];

/**
 * Calculates SHA-256 hash of a buffer
 */
function calculateSHA256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Detects file type from magic bytes & text heuristics
 */
function detectFileType(buffer, filename = '') {
  const headerHex = buffer.slice(0, 16).toString('hex').toLowerCase();
  
  for (const sig of MAGIC_SIGNATURES) {
    if (headerHex.startsWith(sig.headerHex)) {
      if (sig.type === 'ZIP' && filename.endsWith('.docx')) {
        return { type: 'DOCX', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      }
      return { type: sig.type, mime: sig.mime };
    }
  }

  // Fallback signature checks inside content for partial / damaged files
  const contentStr = buffer.toString('utf-8', 0, Math.min(buffer.length, 1024));
  const printable = isPrintableText(buffer);

  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return { type: 'MP4', mime: 'video/mp4' };
  if (buffer.slice(0, 16).toString('ascii').startsWith('SQLite format 3')) return { type: 'SQLITE', mime: 'application/vnd.sqlite3' };
  if (buffer.length >= 4 && ['d4c3b2a1', 'a1b2c3d4', '4d3cb2a1', 'a1b23c4d'].includes(buffer.slice(0, 4).toString('hex').toLowerCase())) return { type: 'PCAP', mime: 'application/vnd.tcpdump.pcap' };

  if (contentStr.includes('%PDF-')) {
    return { type: 'PDF', mime: 'application/pdf' };
  }
  if (printable && (contentStr.startsWith('{"') || contentStr.startsWith('[{"') || contentStr.startsWith('{\n') || filename.endsWith('.json'))) {
    return { type: 'JSON', mime: 'application/json' };
  }
  if (printable && (filename.endsWith('.csv') || (contentStr.includes(',') && contentStr.includes('\n')))) {
    return { type: 'CSV', mime: 'text/csv' };
  }
  if (printable && (filename.endsWith('.txt') || printable)) {
    return { type: 'TXT', mime: 'text/plain' };
  }

  return { type: 'UNKNOWN', mime: 'application/octet-stream' };
}

/**
 * Heuristic to check if buffer is printable UTF-8 text (not binary noise)
 */
function isPrintableText(buffer) {
  if (buffer.length === 0) return false;
  
  const sampleLength = Math.min(buffer.length, 1024);
  let printableCount = 0;
  let binaryControlCount = 0;

  for (let i = 0; i < sampleLength; i++) {
    const byte = buffer[i];
    // Binary control bytes (NULL, NUL, BEL, etc.) immediately flag binary content
    if ((byte >= 0 && byte <= 8) || byte === 11 || byte === 12 || (byte >= 14 && byte <= 31) || byte === 127) {
      binaryControlCount++;
    } else if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      printableCount++;
    }
  }

  if (binaryControlCount > 0) return false;
  return (printableCount / sampleLength) > 0.80;
}

/**
 * Detects structural corruption & damage status
 */
function detectDamage(buffer, detectedType) {
  const issues = [];
  let damageStatus = 'INTACT';

  if (buffer.length === 0) {
    issues.push('File is empty (0 bytes)');
    return { damageStatus: 'CORRUPTED', issues, estimatedOriginalSize: 0 };
  }

  const headerHex = buffer.slice(0, 16).toString('hex').toLowerCase();
  const footerHex = buffer.slice(Math.max(0, buffer.length - 32)).toString('hex').toLowerCase();

  switch (detectedType) {
    case 'PDF': {
      const hasHeader = buffer.toString('utf-8', 0, 1024).includes('%PDF-');
      const hasFooter = buffer.toString('utf-8', Math.max(0, buffer.length - 2048)).includes('%%EOF');
      if (!hasHeader) {
        issues.push('Missing or damaged %PDF- header magic bytes');
        damageStatus = 'CORRUPTED';
      }
      if (!hasFooter) {
        issues.push('Missing %%EOF trailer footer marker (file appears truncated)');
        damageStatus = damageStatus === 'CORRUPTED' ? 'CORRUPTED' : 'TRUNCATED';
      }
      break;
    }
    case 'PNG': {
      if (!headerHex.startsWith('89504e470d0a1a0a')) {
        issues.push('Invalid PNG header signature');
        damageStatus = 'CORRUPTED';
      }
      if (!footerHex.includes('49454e44')) { // IEND
        issues.push('Missing PNG IEND footer chunk (truncated)');
        damageStatus = damageStatus === 'CORRUPTED' ? 'CORRUPTED' : 'TRUNCATED';
      }
      break;
    }
    case 'JSON': {
      try {
        JSON.parse(buffer.toString('utf-8'));
      } catch (err) {
        issues.push(`Invalid JSON syntax: ${err.message}`);
        damageStatus = 'CORRUPTED';
      }
      break;
    }
    case 'CSV': {
      const str = buffer.toString('utf-8');
      const lines = str.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 1) {
        issues.push('CSV has no valid data lines');
        damageStatus = 'CORRUPTED';
      }
      break;
    }
    case 'TXT': {
      if (!isPrintableText(buffer)) {
        issues.push('Contains binary or non-printable garbage characters');
        damageStatus = 'CORRUPTED';
      }
      break;
    }
    case 'MP4': {
      if (buffer.toString('ascii', 4, 8) !== 'ftyp') { issues.push('Missing MP4 ftyp box'); damageStatus = 'CORRUPTED'; }
      if (!buffer.includes(Buffer.from('moov'))) { issues.push('Missing MP4 moov box'); damageStatus = 'TRUNCATED'; }
      break;
    }
    case 'SQLITE': {
      if (!buffer.slice(0, 16).toString('ascii').startsWith('SQLite format 3')) { issues.push('Invalid SQLite header'); damageStatus = 'CORRUPTED'; }
      break;
    }
    case 'PCAP': {
      if (buffer.length < 24) { issues.push('Truncated PCAP global header'); damageStatus = 'TRUNCATED'; }
      break;
    }
    case 'UNKNOWN': {
      issues.push('Unrecognized signature/file structure');
      damageStatus = 'UNKNOWN_FORMAT';
      break;
    }
  }

  // Estimate original size where possible
  let estimatedOriginalSize = buffer.length;
  if (damageStatus === 'TRUNCATED') {
    estimatedOriginalSize = Math.round(buffer.length * 1.5);
  }

  return { damageStatus, issues, estimatedOriginalSize };
}

/**
 * Main analysis function for a file path or buffer
 */
async function analyzeFile(filePathOrBuffer, originalName = 'sample.bin') {
  const buffer = typeof filePathOrBuffer === 'string' ? fs.readFileSync(filePathOrBuffer) : filePathOrBuffer;
  const fileSize = buffer.length;
  const sha256 = calculateSHA256(buffer);
  
  const { type: detectedType, mime: mimeType } = detectFileType(buffer, originalName);
  const { damageStatus, issues: structuralIssues, estimatedOriginalSize } = detectDamage(buffer, detectedType);
  
  const magicBytesHeader = buffer.slice(0, 16).toString('hex').toUpperCase();
  const magicBytesFooter = buffer.slice(Math.max(0, buffer.length - 16)).toString('hex').toUpperCase();
  
  const metadata = metadataExtractor.extract(buffer, detectedType);

  return {
    originalName,
    fileSize,
    sha256,
    detectedType,
    mimeType,
    magicBytesHeader,
    magicBytesFooter,
    damageStatus,
    structuralIssues,
    estimatedOriginalSize,
    metadata
  };
}

module.exports = {
  calculateSHA256,
  detectFileType,
  detectDamage,
  analyzeFile
};
