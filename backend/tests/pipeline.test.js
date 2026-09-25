const request = require('supertest');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const { createControlledPDFSamples } = require('../test_samples/generateTestFiles');

let mongod;

beforeAll(async () => {
  // Setup MongoMemoryServer for isolated, clean test execution
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.disconnect();
  await mongoose.connect(uri);

  // Generate controlled test files
  await createControlledPDFSamples();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe('Digital Evidence Recovery Backend Pipeline Test Suite', () => {

  // -------------------------------------------------------------
  // Test 1: Health Check
  // -------------------------------------------------------------
  test('GET /api/health should return OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('OK');
    expect(res.body.service).toBeDefined();
  });

  // -------------------------------------------------------------
  // Test 2: Controlled Case 1 - PDF Recoverable (100% Verified)
  // -------------------------------------------------------------
  test('Case 1: PDF with complete fragments reassembles to VERIFIED_RECOVERED', async () => {
    const f1 = path.join(__dirname, '../test_samples/case1_pdf_recoverable/pdf_frag_01.bin');
    const f2 = path.join(__dirname, '../test_samples/case1_pdf_recoverable/pdf_frag_02.bin');
    const f3 = path.join(__dirname, '../test_samples/case1_pdf_recoverable/pdf_frag_03.bin');

    // 1. Upload fragments
    const uploadRes = await request(app)
      .post('/api/upload?type=fragment')
      .attach('files', f1)
      .attach('files', f2)
      .attach('files', f3);
    
    expect(uploadRes.statusCode).toEqual(200);
    expect(uploadRes.body.count).toEqual(3);

    const fragmentIds = uploadRes.body.records.map(r => r.evidenceId);

    // 2. Analyze evidence
    const analyzeRes = await request(app)
      .post('/api/analyze')
      .send({ fragmentIds });

    expect(analyzeRes.statusCode).toEqual(200);
    expect(analyzeRes.body.evidenceAnalysis.verifiedFragments.length).toEqual(3);

    // 3. Trigger recovery
    const recoverRes = await request(app)
      .post('/api/recover')
      .send({ fragmentIds });

    expect(recoverRes.statusCode).toEqual(200);
    expect(recoverRes.body.finalClassification).toEqual('VERIFIED_RECOVERED');
    expect(recoverRes.body.recoveredPercentage).toEqual(100);
    expect(recoverRes.body.validation.structureValid).toBe(true);
    expect(recoverRes.body.dataProfile).toMatchObject({
      fileType: 'PDF',
      providedBytes: expect.any(Number),
      assembledBytes: expect.any(Number),
      recoveredOutputBytes: expect.any(Number)
    });
    expect(recoverRes.body.dataProfile.assembledBytes).toBeGreaterThan(0);
    expect(fs.existsSync(recoverRes.body.recoveredFilePath)).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 3: Controlled Case 2 - PDF Missing Fragment (AI_INFERRED / Partial)
  // -------------------------------------------------------------
  test('Case 2: PDF missing body fragment classifies as AI_INFERRED / Partial without false 100%', async () => {
    const f1 = path.join(__dirname, '../test_samples/case2_pdf_missing_fragments/pdf_frag_01.bin');
    const f3 = path.join(__dirname, '../test_samples/case2_pdf_missing_fragments/pdf_frag_03.bin');

    const uploadRes = await request(app)
      .post('/api/upload?type=fragment')
      .attach('files', f1)
      .attach('files', f3);

    const fragmentIds = uploadRes.body.records.map(r => r.evidenceId);

    const recoverRes = await request(app)
      .post('/api/recover')
      .send({ fragmentIds });

    expect(recoverRes.statusCode).toEqual(200);
    expect(['AI_INFERRED', 'UNRECOVERABLE']).toContain(recoverRes.body.finalClassification);
    expect(recoverRes.body.recoveredPercentage).toBeLessThan(100);
    expect(recoverRes.body.limitations.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------
  // Test 4: Controlled Case 3 - Unrecoverable Binary
  // -------------------------------------------------------------
  test('Case 3: Corrupted binary without evidence reports UNRECOVERABLE (no false recovery)', async () => {
    const unrecFile = path.join(__dirname, '../test_samples/case3_pdf_unrecoverable/unrecoverable_garbage.bin');

    const uploadRes = await request(app)
      .post('/api/upload')
      .attach('files', unrecFile);

    const fileId = uploadRes.body.records[0].fileId;

    const recoverRes = await request(app)
      .post('/api/recover')
      .send({ fileId, fragmentIds: [] });

    expect(recoverRes.statusCode).toEqual(200);
    expect(recoverRes.body.finalClassification).toEqual('UNRECOVERABLE');
    expect(recoverRes.body.recoveredPercentage).toEqual(0);
    expect(recoverRes.body.unrecoverablePercentage).toEqual(100);
  });

  // -------------------------------------------------------------
  // Test 5: Integrated Sample Dataset (TXT, CSV, JSON, PNG, Duplicates & Corrupted)
  // -------------------------------------------------------------
  test('Sample Dataset: Correctly handles incident_report.txt, duplicates, and corrupted fragments', async () => {
    const sampleDir = path.join(__dirname, '../../recovery_test_sample/recovery_test_sample/damaged_input');
    
    if (!fs.existsSync(sampleDir)) return;

    const reportFrags = [
      path.join(sampleDir, 'fragment_report_01.bin'),
      path.join(sampleDir, 'fragment_report_02.bin'),
      path.join(sampleDir, 'fragment_report_03.bin')
    ];

    const uploadRes = await request(app)
      .post('/api/upload?type=fragment')
      .attach('files', reportFrags[0])
      .attach('files', reportFrags[1])
      .attach('files', reportFrags[2]);

    const fragmentIds = uploadRes.body.records.map(r => r.evidenceId);

    const recoverRes = await request(app)
      .post('/api/recover')
      .send({ fragmentIds });

    expect(recoverRes.statusCode).toEqual(200);
    expect(recoverRes.body.finalClassification).toEqual('VERIFIED_RECOVERED');
    expect(recoverRes.body.recoveredPercentage).toEqual(100);

    // Test corrupted & duplicate fragment detection
    const specialFrags = [
      path.join(sampleDir, 'fragment_image_01.bin'),
      path.join(sampleDir, 'duplicate_image_fragment.bin'),
      path.join(sampleDir, 'fragment_notes_02_CORRUPTED.bin')
    ];

    const specialUploadRes = await request(app)
      .post('/api/upload?type=fragment')
      .attach('files', specialFrags[0])
      .attach('files', specialFrags[1])
      .attach('files', specialFrags[2]);

    const specialIds = specialUploadRes.body.records.map(r => r.evidenceId);

    const analyzeRes = await request(app)
      .post('/api/analyze')
      .send({ fragmentIds: specialIds });

    expect(analyzeRes.body.evidenceAnalysis.duplicateCount).toBeGreaterThanOrEqual(1);
    expect(analyzeRes.body.evidenceAnalysis.corruptedCount).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------
  // Test 6: Image Enhancement + Problem Description
  // -------------------------------------------------------------
  test('Single image upload creates an enhanced 4K recovery output and stores the user description in the report', async () => {
    const sharp = require('sharp');
    const tempPath = path.join(__dirname, 'tmp-enhance-test.png');
    await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 3,
        background: { r: 20, g: 35, b: 60 }
      }
    })
      .composite([
        { input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" fill="white"/><text x="30" y="90" font-size="30" fill="black">forensic</text></svg>'), density: 72 }
      ])
      .png()
      .toFile(tempPath);

    const uploadRes = await request(app)
      .post('/api/upload')
      .field('description', 'The image is dark and blurry. Need a cleaner forensic-quality 4K output for inspection.')
      .attach('files', tempPath);

    const fileId = uploadRes.body.records[0].fileId;

    const recoverRes = await request(app)
      .post('/api/recover')
      .send({ fileId, userDescription: 'The image is dark and blurry. Need a cleaner forensic-quality 4K output for inspection.', useAI: false });

    expect(recoverRes.statusCode).toEqual(200);
    expect(recoverRes.body.finalClassification).toBe('VERIFIED_RECOVERED');
    expect(recoverRes.body.enhancedPercentage).toBeGreaterThan(0);
    expect(fs.existsSync(recoverRes.body.recoveredFilePath)).toBe(true);
    expect(path.extname(recoverRes.body.recoveredFilePath)).toBe('.png');
    const recoveredImage = await sharp(recoverRes.body.recoveredFilePath).metadata();
    expect(recoveredImage.format).toBe('png');

    const reportRes = await request(app).get(`/api/reports/${recoverRes.body.recoveryId}?format=markdown`);
    expect(reportRes.statusCode).toEqual(200);
    expect(reportRes.text).toContain('The image is dark and blurry');

    fs.unlinkSync(tempPath);
  });

  test('Enhanced JPEG recovery keeps JPEG encoding and extension', async () => {
    const sharp = require('sharp');
    const tempPath = path.join(__dirname, 'tmp-enhance-test.jpg');
    await sharp({
      create: {
        width: 160,
        height: 90,
        channels: 3,
        background: { r: 45, g: 75, b: 105 }
      }
    }).jpeg().toFile(tempPath);

    const uploadRes = await request(app).post('/api/upload').attach('files', tempPath);
    const recoverRes = await request(app)
      .post('/api/recover')
      .send({ fileId: uploadRes.body.records[0].fileId, useAI: false });

    expect(recoverRes.statusCode).toBe(200);
    expect(path.extname(recoverRes.body.recoveredFilePath)).toBe('.jpg');
    const recoveredImage = await sharp(recoverRes.body.recoveredFilePath).metadata();
    expect(recoveredImage.format).toBe('jpeg');

    fs.unlinkSync(tempPath);
  });

  // -------------------------------------------------------------
  // Test 7: Report Generation Endpoint
  // -------------------------------------------------------------
  test('GET /api/reports/:id returns structured JSON and Markdown recovery report', async () => {
    const f1 = path.join(__dirname, '../test_samples/case1_pdf_recoverable/pdf_frag_01.bin');
    const uploadRes = await request(app)
      .post('/api/upload')
      .attach('files', f1);

    const fileId = uploadRes.body.records[0].fileId;

    const recoverRes = await request(app)
      .post('/api/recover')
      .send({ fileId });

    const recoveryId = recoverRes.body.recoveryId;

    // Get JSON report
    const jsonReportRes = await request(app).get(`/api/reports/${recoveryId}?format=json`);
    expect(jsonReportRes.statusCode).toEqual(200);
    expect(jsonReportRes.body.reportId).toBeDefined();
    expect(jsonReportRes.body.recoveryMetrics).toBeDefined();
    expect(jsonReportRes.body.dataProfile.recoveredOutputBytes).toBe(recoverRes.body.recoveredFileSize);

    // Get Markdown report
    const mdReportRes = await request(app).get(`/api/reports/${recoveryId}?format=markdown`);
    expect(mdReportRes.statusCode).toEqual(200);
    expect(mdReportRes.text).toContain('# Digital Evidence Reconstruction & Recovery Report');
    expect(mdReportRes.text).toContain('## 4. Processed Data Profile');

    const pdfReportRes = await request(app).get(`/api/reports/${recoveryId}/download?format=pdf`);
    expect(pdfReportRes.statusCode).toEqual(200);
    expect(pdfReportRes.headers['content-type']).toContain('application/pdf');
    expect(pdfReportRes.body.subarray(0, 5).toString()).toBe('%PDF-');
    const pdfDocument = await require('pdf-lib').PDFDocument.load(pdfReportRes.body);
    expect(pdfDocument.getPageCount()).toBeGreaterThan(0);
  });
});
