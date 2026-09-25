const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function createReportPdf(reportData) {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [612, 792];
  const margin = 48;
  const fontSize = 9;
  const lineHeight = 14;
  let page;
  let cursorY;

  function addPage() {
    page = pdf.addPage(pageSize);
    cursorY = page.getHeight() - margin;
  }

  function cleanText(value) {
    return String(value ?? '')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[^\x20-\x7e]/g, '?');
  }

  function drawWrapped(text, { bold = false, size = fontSize, color = rgb(0.16, 0.2, 0.18), indent = 0 } = {}) {
    const font = bold ? boldFont : regularFont;
    const maxWidth = page.getWidth() - margin * 2 - indent;
    const words = cleanText(text).split(/\s+/);
    let line = '';

    for (const word of words) {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (line) {
          if (cursorY < margin + lineHeight) addPage();
          page.drawText(line, { x: margin + indent, y: cursorY, size, font, color });
          cursorY -= lineHeight;
          line = '';
        }
        let chunk = '';
        for (const character of word) {
          const candidateChunk = `${chunk}${character}`;
          if (font.widthOfTextAtSize(candidateChunk, size) > maxWidth && chunk) {
            if (cursorY < margin + lineHeight) addPage();
            page.drawText(chunk, { x: margin + indent, y: cursorY, size, font, color });
            cursorY -= lineHeight;
            chunk = character;
          } else {
            chunk = candidateChunk;
          }
        }
        line = chunk;
        continue;
      }
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        if (cursorY < margin + lineHeight) addPage();
        page.drawText(line, { x: margin + indent, y: cursorY, size, font, color });
        cursorY -= lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) {
      if (cursorY < margin + lineHeight) addPage();
      page.drawText(line, { x: margin + indent, y: cursorY, size, font, color });
      cursorY -= lineHeight;
    }
  }

  function addSection(title) {
    cursorY -= 9;
    if (cursorY < margin + 34) addPage();
    drawWrapped(title, { bold: true, size: 11, color: rgb(0.1, 0.35, 0.31) });
    cursorY -= 2;
  }

  function addField(label, value) {
    drawWrapped(`${label}: ${value}`);
  }

  addPage();
  drawWrapped('Digital Evidence Reconstruction & Recovery Report', {
    bold: true,
    size: 17,
    color: rgb(0.08, 0.2, 0.16)
  });
  cursorY -= 5;
  addField('Report ID', reportData.reportId);
  addField('Timestamp', reportData.timestamp);
  addField('Classification', reportData.recoveryMetrics?.finalClassification);

  addSection('1. Case Description & Damage Assessment');
  addField('User Problem Description', reportData.userDescription);
  addField('Original Filename', reportData.originalFilename);
  addField('Detected File Type', reportData.fileType);
  addField('File Size', `${reportData.fileSize} bytes`);
  addField('SHA-256 Hash', reportData.sha256);
  addField('Damage Status', reportData.damageStatus);

  addSection('2. Evidence Sources Analyzed');
  if (reportData.evidenceSources?.length) {
    reportData.evidenceSources.forEach(source => {
      drawWrapped(`${source.fileName} | Sequence: ${source.sequenceIndex} | Status: ${source.status} | SHA-256: ${source.sha256}`);
    });
  } else {
    drawWrapped('No verified evidence fragments found.');
  }

  addSection('3. Fragment Count Summary');
  addField('Total fragments detected', reportData.fragmentSummary?.totalFragments ?? 0);
  addField('Recovered fragments', reportData.fragmentSummary?.recoveredFragments ?? 0);
  addField('Missing fragments', reportData.fragmentSummary?.missingFragments ?? 0);

  const profile = reportData.dataProfile || {};
  addSection('4. Processed Data Profile');
  addField('Detected type', profile.fileType || 'UNKNOWN');
  addField('Input damage status', profile.damageStatus || 'UNKNOWN');
  addField('Provided input bytes', profile.providedBytes ?? 0);
  addField('Assembled bytes', profile.assembledBytes ?? 0);
  addField('Recovered output bytes', profile.recoveredOutputBytes ?? 0);
  addField('Estimated original bytes', profile.estimatedOriginalBytes ?? 'Not available');
  addField('Estimated missing bytes', profile.estimatedMissingBytes ?? 'Not measurable from this input');
  addField('Format metadata', JSON.stringify(profile.formatMetadata || {}));

  addSection('5. Recovery Metrics Breakdown');
  const metrics = reportData.recoveryMetrics || {};
  addField('VERIFIED_RECOVERED', `${metrics.recoveredPercentage ?? 0}%`);
  addField('RECONSTRUCTED', `${metrics.reconstructedPercentage ?? 0}%`);
  addField('ENHANCED', `${metrics.enhancedPercentage ?? 0}%`);
  addField('AI_INFERRED', `${metrics.aiInferredPercentage ?? 0}%`);
  addField('UNRECOVERABLE', `${metrics.unrecoverablePercentage ?? 100}%`);

  addSection('6. Validation & Structural Integrity');
  addField('Overall Validation Score', `${reportData.validationResults?.score ?? 0}%`);
  addField('Structure Valid', reportData.validationResults?.structureValid ? 'YES' : 'NO');
  (reportData.validationResults?.checks || []).forEach(check => drawWrapped(`- ${check}`, { indent: 10 }));

  addSection('7. Recovery Explanation & Technical Limitations');
  drawWrapped(`Explanation: ${reportData.recoveryExplanation || 'No recovery explanation available.'}`);
  const limitations = reportData.limitations || [];
  if (limitations.length) limitations.forEach(item => drawWrapped(`- ${item}`, { indent: 10 }));
  else drawWrapped('No limitations identified.');

  if (reportData.auditTrail?.length) {
    addSection('8. Audit Trail');
    reportData.auditTrail.forEach(entry => drawWrapped(`${entry.timestamp} | ${entry.action} | ${entry.hash}`));
  }

  pdf.setTitle('Digital Evidence Reconstruction & Recovery Report');
  pdf.setSubject(`Forensic recovery report ${reportData.reportId || ''}`);
  pdf.setCreationDate(new Date(reportData.timestamp || Date.now()));
  return pdf.save();
}

module.exports = { createReportPdf };