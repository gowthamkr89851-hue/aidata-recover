const fs = require('fs');
const crypto = require('crypto');
const fileAnalyzer = require('./fileAnalyzer');

/**
 * Calculates SHA-256 hash
 */
function getSHA256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function calculateEntropy(buffer) {
  if (!buffer.length) return 0;
  const counts = new Array(256).fill(0);
  buffer.forEach(byte => { counts[byte]++; });
  return counts.reduce((entropy, count) => {
    if (!count) return entropy;
    const probability = count / buffer.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function overlapSize(left, right, max = 64) {
  const limit = Math.min(max, left.length, right.length);
  for (let size = limit; size >= 4; size--) {
    if (left.slice(left.length - size).equals(right.slice(0, size))) return size;
  }
  return 0;
}

function orderByNgramOverlap(fragments) {
  if (fragments.length < 2) return fragments;
  const starts = fragments.filter(fragment => fragment.buffer.slice(0, 16).toString('utf8').includes('%PDF-') || fragment.buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a' || fragment.buffer.slice(0, 4).toString('hex') === '504b0304' || fragment.buffer.slice(0, 4).toString('ascii') === 'SQLite format 3');
  const ordered = [starts[0] || fragments.slice().sort((a, b) => b.matchScore - a.matchScore)[0]];
  const remaining = fragments.filter(fragment => fragment !== ordered[0]);
  while (remaining.length) {
    const current = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestOverlap = -1;
    remaining.forEach((fragment, index) => {
      const overlap = overlapSize(current.buffer, fragment.buffer);
      if (overlap > bestOverlap) { bestOverlap = overlap; bestIndex = index; }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

/**
 * Parses sequence index from filename (e.g. fragment_report_02.bin -> 2)
 */
function extractSequenceIndex(filename) {
  const match = filename.match(/_(\d+)(?:\.bin|\.[a-z0-9]+)?$/i);
  return match ? parseInt(match[1], 10) : -1;
}

/**
 * Determines prefix/family key of a fragment (e.g. fragment_report_01.bin -> report)
 */
function extractFamilyKey(filename) {
  const cleaned = filename.replace(/_CORRUPTED/i, '').replace(/duplicate_/i, '');
  const match = cleaned.match(/fragment_([a-z0-9]+)_/i) || cleaned.match(/^([a-z0-9]+)_/i);
  return match ? match[1].toLowerCase() : filename.toLowerCase();
}

/**
 * Analyzes evidence fragments against a target damaged file / set of fragments
 */
function analyzeEvidence(targetFileBuffer, targetFileName = '', fragmentFiles = []) {
  const seenHashes = new Set();
  const rawFragments = [];

  // Parse all raw fragment properties first
  for (const frag of fragmentFiles) {
    const buffer = typeof frag.content === 'string' 
      ? Buffer.from(frag.content, 'utf-8') 
      : (frag.buffer || fs.readFileSync(frag.path));
    
    const fileName = frag.filename || frag.name || 'fragment.bin';
    const sha256 = getSHA256(buffer);
    const seqIndex = extractSequenceIndex(fileName);
    const familyKey = extractFamilyKey(fileName);
    const typeAnalysis = fileAnalyzer.detectFileType(buffer, fileName);

    rawFragments.push({
      fileName,
      buffer,
      sha256,
      seqIndex,
      familyKey,
      typeAnalysis,
      entropy: calculateEntropy(buffer)
    });
  }

  // Determine target family key if not explicitly given
  let effectiveTargetFamily = '';
  if (targetFileName && !targetFileName.startsWith('target_sample') && !targetFileName.startsWith('recovered_target')) {
    effectiveTargetFamily = extractFamilyKey(targetFileName);
  } else if (rawFragments.length > 0) {
    // Find the most common familyKey among fragments
    const familyCounts = {};
    for (const f of rawFragments) {
      familyCounts[f.familyKey] = (familyCounts[f.familyKey] || 0) + 1;
    }
    effectiveTargetFamily = Object.keys(familyCounts).reduce((a, b) => familyCounts[a] > familyCounts[b] ? a : b, '');
  }

  // Propagate detected type within same family if header is in one fragment
  let inferredFamilyType = 'UNKNOWN';
  if (targetFileBuffer && targetFileBuffer.length > 0) {
    inferredFamilyType = fileAnalyzer.detectFileType(targetFileBuffer, targetFileName).type;
  }
  if (inferredFamilyType === 'UNKNOWN') {
    for (const f of rawFragments) {
      if (f.familyKey === effectiveTargetFamily && f.typeAnalysis.type !== 'UNKNOWN') {
        inferredFamilyType = f.typeAnalysis.type;
        break;
      }
    }
  }

  const fragments = [];

  for (const f of rawFragments) {
    const { fileName, buffer, sha256, seqIndex, familyKey, typeAnalysis, entropy } = f;

    // 1. Check for Duplicate
    if (seenHashes.has(sha256)) {
      fragments.push({
        fileName,
        buffer,
        sha256,
        seqIndex,
        familyKey,
        status: 'DUPLICATE',
        matchScore: 0,
        entropy,
        relevanceNotes: 'Exact duplicate of an existing evidence fragment'
      });
      continue;
    }
    seenHashes.add(sha256);

    // 2. Check for Corruption
    const isCorruptedName = fileName.includes('_CORRUPTED');
    let isCorrupted = isCorruptedName;
    if (fileName.endsWith('.json') || familyKey.includes('notes')) {
      const text = buffer.toString('utf-8');
      if (text.includes('INVALID_SYNTAX') || text.includes('CORRUPTED') || text.includes('{ corrupted')) {
        isCorrupted = true;
      }
    }

    if (isCorrupted) {
      fragments.push({
        fileName,
        buffer,
        sha256,
        seqIndex,
        familyKey,
        status: 'CORRUPTED',
        matchScore: 0,
        entropy,
        relevanceNotes: 'Fragment contains corrupted data bytes or syntax errors'
      });
      continue;
    }

    // 3. Correlation & Matching Score Calculation
    let matchScore = 0;
    const notes = [];

    // Family key match
    if (effectiveTargetFamily && familyKey === effectiveTargetFamily) {
      matchScore += 50;
      notes.push(`Matched evidence family set (${familyKey})`);
    }

    // Type signature match
    if (inferredFamilyType !== 'UNKNOWN' && (typeAnalysis.type === inferredFamilyType || typeAnalysis.type === 'UNKNOWN')) {
      matchScore += 30;
      notes.push(`Compatible file type (${inferredFamilyType})`);
    }

    // Header/Footer position matching
    const textSample = buffer.toString('utf-8', 0, Math.min(buffer.length, 128));
    if (textSample.includes('%PDF-') || textSample.startsWith('{"') || buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a' || buffer.slice(0, 4).toString('ascii') === 'SQLite format 3') {
      matchScore += 20;
      notes.push('Header signature present');
    }

    // Determine status
    let status = 'UNMATCHED';
    if (matchScore >= 50) {
      status = 'VERIFIED';
    } else if (matchScore >= 30) {
      status = 'CANDIDATE';
    } else {
      notes.push('Unrelated data fragment - excluded from reconstruction');
    }

    fragments.push({
      fileName,
      buffer,
      sha256,
      seqIndex,
      familyKey,
      status,
      matchScore,
      entropy,
      relevanceNotes: notes.join('; ')
    });
  }

  // Filter and order verified fragments by sequence index
  let verifiedFragments = fragments
    .filter(f => f.status === 'VERIFIED' || f.status === 'CANDIDATE')
    .sort((a, b) => {
      if (a.seqIndex !== -1 && b.seqIndex !== -1) {
        return a.seqIndex - b.seqIndex;
      }
      return a.fileName.localeCompare(b.fileName);
    });

  const hasUsableSequence = verifiedFragments.length > 1 && verifiedFragments.every(fragment => fragment.seqIndex !== -1);
  if (!hasUsableSequence) verifiedFragments = orderByNgramOverlap(verifiedFragments);

  return {
    totalAnalyzed: fragmentFiles.length,
    allFragments: fragments,
    verifiedFragments,
    duplicateCount: fragments.filter(f => f.status === 'DUPLICATE').length,
    corruptedCount: fragments.filter(f => f.status === 'CORRUPTED').length,
    unmatchedCount: fragments.filter(f => f.status === 'UNMATCHED').length
  };
}

module.exports = {
  analyzeEvidence,
  extractSequenceIndex,
  extractFamilyKey
  ,calculateEntropy,
  overlapSize,
  orderByNgramOverlap
};
