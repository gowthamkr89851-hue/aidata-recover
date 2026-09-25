const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');

const SAMPLES_DIR = path.join(__dirname);
if (!fs.existsSync(SAMPLES_DIR)) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
}

async function createControlledPDFSamples() {
  // Create a minimal, standard PDF document using pdf-lib
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  page.drawText('CONFIDENTIAL DIGITAL EVIDENCE REPORT - CASE #2026-X9', {
    x: 50,
    y: 350,
    size: 16,
    color: rgb(0, 0, 0)
  });
  page.drawText('Reconstructed ground-truth pdf document content.', {
    x: 50,
    y: 300,
    size: 12,
    color: rgb(0.2, 0.2, 0.2)
  });

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);

  // Split into 3 fragments
  const partLength = Math.floor(pdfBuffer.length / 3);
  const frag1 = pdfBuffer.slice(0, partLength);
  const frag2 = pdfBuffer.slice(partLength, partLength * 2);
  const frag3 = pdfBuffer.slice(partLength * 2);

  // 1. Recoverable PDF sample set
  const recDir = path.join(SAMPLES_DIR, 'case1_pdf_recoverable');
  if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true });
  fs.writeFileSync(path.join(recDir, 'pdf_frag_01.bin'), frag1);
  fs.writeFileSync(path.join(recDir, 'pdf_frag_02.bin'), frag2);
  fs.writeFileSync(path.join(recDir, 'pdf_frag_03.bin'), frag3);
  fs.writeFileSync(path.join(recDir, 'original_reference.pdf'), pdfBuffer);

  // 2. Missing Fragment PDF sample set (frag2 missing)
  const missDir = path.join(SAMPLES_DIR, 'case2_pdf_missing_fragments');
  if (!fs.existsSync(missDir)) fs.mkdirSync(missDir, { recursive: true });
  fs.writeFileSync(path.join(missDir, 'pdf_frag_01.bin'), frag1);
  fs.writeFileSync(path.join(missDir, 'pdf_frag_03.bin'), frag3);

  // 3. Unrecoverable Binary sample set
  const unrecDir = path.join(SAMPLES_DIR, 'case3_pdf_unrecoverable');
  if (!fs.existsSync(unrecDir)) fs.mkdirSync(unrecDir, { recursive: true });
  const randomBytes = Buffer.alloc(512);
  for (let i = 0; i < randomBytes.length; i++) {
    randomBytes[i] = Math.floor(Math.random() * 256);
  }
  fs.writeFileSync(path.join(unrecDir, 'unrecoverable_garbage.bin'), randomBytes);

  console.log('[Test File Generator] Controlled PDF sample files generated successfully.');
}

if (require.main === module) {
  createControlledPDFSamples();
}

module.exports = { createControlledPDFSamples };
