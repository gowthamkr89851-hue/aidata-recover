const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '../reports');

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * Compiles structured JSON & Markdown evidence recovery reports
 */
function generateReport({
  fileAnalysis,
  evidenceAnalysis,
  recoveryResult,
  auditLogs = []
}) {
  const reportId = `rep_${recoveryResult.recoveryId || Date.now()}`;
  const timestamp = new Date().toISOString();

  const fragmentSummary = recoveryResult.fragmentSummary || {
    totalFragments: evidenceAnalysis?.verifiedFragments?.length || 0,
    recoveredFragments: evidenceAnalysis?.verifiedFragments?.length || 0,
    missingFragments: 0
  };

  const reportData = {
    reportId,
    timestamp,
    userDescription: recoveryResult.userDescription || recoveryResult.problemDescription || 'No user issue description provided.',
    originalFilename: fileAnalysis ? fileAnalysis.originalName : 'Unknown',
    fileType: fileAnalysis ? fileAnalysis.detectedType : 'UNKNOWN',
    fileSize: fileAnalysis ? fileAnalysis.fileSize : 0,
    sha256: fileAnalysis ? fileAnalysis.sha256 : 'N/A',
    damageStatus: fileAnalysis ? fileAnalysis.damageStatus : 'CORRUPTED',
    dataProfile: recoveryResult.dataProfile || {
      fileType: fileAnalysis?.detectedType || 'UNKNOWN',
      damageStatus: fileAnalysis?.damageStatus || 'UNKNOWN',
      providedBytes: fileAnalysis?.fileSize || 0,
      assembledBytes: 0,
      recoveredOutputBytes: recoveryResult.recoveredFileSize || 0,
      estimatedOriginalBytes: fileAnalysis?.estimatedOriginalSize ?? null,
      estimatedMissingBytes: null,
      formatMetadata: fileAnalysis?.metadata || {}
    },
    evidenceSources: evidenceAnalysis ? evidenceAnalysis.verifiedFragments.map(f => ({
      fileName: f.fileName,
      sha256: f.sha256,
      status: f.status,
      sequenceIndex: f.seqIndex
    })) : [],
    fragmentSummary: {
      totalFragments: Number(fragmentSummary.totalFragments || 0),
      recoveredFragments: Number(fragmentSummary.recoveredFragments || 0),
      missingFragments: Number(fragmentSummary.missingFragments || 0)
    },
    recoveryMetrics: {
      recoveredPercentage: recoveryResult.recoveredPercentage || 0,
      reconstructedPercentage: recoveryResult.reconstructedPercentage || 0,
      enhancedPercentage: recoveryResult.enhancedPercentage || 0,
      aiInferredPercentage: recoveryResult.aiInferredPercentage || 0,
      unrecoverablePercentage: recoveryResult.unrecoverablePercentage || 100,
      finalClassification: recoveryResult.finalClassification || 'UNRECOVERABLE'
    },
    validationResults: recoveryResult.validation || {
      structureValid: false,
      score: 0,
      checks: []
    },
    recoveryExplanation: recoveryResult.recoveryExplanation || 'No recovery explanation available',
    limitations: recoveryResult.limitations || [],
    aiAssessment: recoveryResult.aiAssessment || null,
    auditTrail: auditLogs.map(log => ({
      action: log.action,
      timestamp: log.timestamp,
      hash: log.hash
    }))
  };

  // Generate Markdown version
  const markdownContent = `
# Digital Evidence Reconstruction & Recovery Report
**Report ID**: \`${reportId}\`  
**Timestamp**: ${timestamp}  
**Classification**: \`${reportData.recoveryMetrics.finalClassification}\`

---

## 1. Case Description & Damage Assessment
- **User Problem Description**: ${reportData.userDescription}
- **Original Filename**: ${reportData.originalFilename}
- **Detected File Type**: \`${reportData.fileType}\`
- **File Size**: ${reportData.fileSize} bytes
- **SHA-256 Hash**: \`${reportData.sha256}\`
- **Damage Status**: \`${reportData.damageStatus}\`

## 2. Evidence Sources Analyzed
${reportData.evidenceSources.length > 0 
  ? reportData.evidenceSources.map(e => `- **${e.fileName}** (Seq: ${e.sequenceIndex}, Status: ${e.status}, SHA-256: \`${e.sha256.substring(0, 16)}...\`)`).join('\n')
  : '*No verified evidence fragments found.*'}

## 3. Fragment Count Summary
- **Total fragments detected**: ${reportData.fragmentSummary.totalFragments}
- **Recovered fragments**: ${reportData.fragmentSummary.recoveredFragments}
- **Missing fragments**: ${reportData.fragmentSummary.missingFragments}

## 4. Processed Data Profile
- **Detected type**: ${reportData.dataProfile.fileType}
- **Input damage status**: ${reportData.dataProfile.damageStatus}
- **Provided input bytes**: ${reportData.dataProfile.providedBytes}
- **Assembled bytes**: ${reportData.dataProfile.assembledBytes}
- **Recovered output bytes**: ${reportData.dataProfile.recoveredOutputBytes}
- **Estimated original bytes**: ${reportData.dataProfile.estimatedOriginalBytes ?? 'Not available'}
- **Estimated missing bytes**: ${reportData.dataProfile.estimatedMissingBytes ?? 'Not measurable from this input'}
- **Format metadata**: \`${JSON.stringify(reportData.dataProfile.formatMetadata)}\`

## 5. Recovery Metrics Breakdown
| Metric | Percentage |
| :--- | :--- |
| **VERIFIED_RECOVERED** | ${reportData.recoveryMetrics.recoveredPercentage}% |
| **RECONSTRUCTED** | ${reportData.recoveryMetrics.reconstructedPercentage}% |
| **ENHANCED** | ${reportData.recoveryMetrics.enhancedPercentage}% |
| **AI_INFERRED** | ${reportData.recoveryMetrics.aiInferredPercentage}% |
| **UNRECOVERABLE** | ${reportData.recoveryMetrics.unrecoverablePercentage}% |

## 6. Validation & Structural Integrity
- **Overall Validation Score**: **${reportData.validationResults.score}%**
- **Structure Valid**: ${reportData.validationResults.structureValid ? 'YES' : 'NO'}
- **Validation Checks**:
${reportData.validationResults.checks ? reportData.validationResults.checks.map(c => `  - ${c}`).join('\n') : '  - None'}

## 7. Recovery Explanation & Technical Limitations
**Explanation**: ${reportData.recoveryExplanation}

**Limitations**:
${reportData.limitations.length > 0 
  ? reportData.limitations.map(l => `- ${l}`).join('\n')
  : '- None identified.'}

---
*Report generated by AI-Assisted Digital Evidence Reconstruction Pipeline.*
`.trim();

  // Save files to reports directory
  const jsonPath = path.join(REPORTS_DIR, `${reportId}.json`);
  const mdPath = path.join(REPORTS_DIR, `${reportId}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));
  fs.writeFileSync(mdPath, markdownContent);

  return {
    reportId,
    jsonPath,
    mdPath,
    reportData,
    markdownContent
  };
}

module.exports = { generateReport };
