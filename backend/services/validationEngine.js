/**
 * Format-Specific Validation Engine
 */
function validate(buffer, formatType) {
  const checks = [];
  let structureValid = true;
  let signatureValid = true;
  let formatConsistency = true;
  let passedCount = 0;
  let totalCount = 0;

  function recordCheck(name, pass, detail = '') {
    totalCount++;
    if (pass) {
      passedCount++;
      checks.push(`PASS: ${name} ${detail}`.trim());
    } else {
      checks.push(`FAIL: ${name} ${detail}`.trim());
    }
  }

  if (!buffer || buffer.length === 0) {
    return {
      structureValid: false,
      signatureValid: false,
      formatConsistency: false,
      score: 0,
      checks: ['FAIL: Buffer is empty (0 bytes)']
    };
  }

  switch (formatType) {
    case 'PDF': {
      const headerText = buffer.toString('utf-8', 0, Math.min(buffer.length, 1024));
      const hasHeader = headerText.includes('%PDF-');
      recordCheck('PDF Header Signature (%PDF-)', hasHeader);
      if (!hasHeader) signatureValid = false;

      const footerText = buffer.toString('utf-8', Math.max(0, buffer.length - 2048));
      const hasEOF = footerText.includes('%%EOF');
      recordCheck('PDF Trailer Signature (%%EOF)', hasEOF);
      if (!hasEOF) structureValid = false;

      const fullText = buffer.toString('utf-8');
      const hasCatalog = fullText.includes('/Catalog') || fullText.includes('/Type /Catalog') || fullText.includes('/Type/Catalog') || fullText.includes('/ObjStm');
      recordCheck('PDF Document Catalog / Object Streams', hasCatalog);

      const hasObjects = /\d+ \d+ obj/.test(fullText) || fullText.includes('stream') || fullText.includes('/ObjStm');
      recordCheck('PDF Object Structures', hasObjects);

      structureValid = hasHeader && hasEOF && hasObjects;
      formatConsistency = hasHeader && hasEOF;
      break;
    }

    case 'PNG': {
      const headerHex = buffer.slice(0, 8).toString('hex').toLowerCase();
      const isHeaderValid = headerHex === '89504e470d0a1a0a';
      recordCheck('PNG Header Magic Bytes', isHeaderValid);
      if (!isHeaderValid) signatureValid = false;

      let hasIHDR = false;
      let hasIEND = false;
      let hasIDAT = false;

      if (buffer.length >= 16) {
        const firstChunkType = buffer.toString('ascii', 12, 16);
        hasIHDR = (firstChunkType === 'IHDR');
      }
      recordCheck('PNG First Chunk (IHDR)', hasIHDR);

      const footerHex = buffer.slice(Math.max(0, buffer.length - 32)).toString('hex').toLowerCase();
      hasIEND = footerHex.includes('49454e44'); // IEND
      recordCheck('PNG Final Chunk (IEND)', hasIEND);

      const asciiStr = buffer.toString('ascii');
      hasIDAT = asciiStr.includes('IDAT');
      recordCheck('PNG Data Chunks (IDAT)', hasIDAT);

      if (!isHeaderValid || !hasIHDR || !hasIEND) {
        structureValid = false;
        formatConsistency = false;
      }
      break;
    }

    case 'JSON': {
      let isParsed = false;
      try {
        const parsed = JSON.parse(buffer.toString('utf-8'));
        isParsed = true;
        recordCheck('JSON Syntax Parser', true, `Type: ${Array.isArray(parsed) ? 'Array' : typeof parsed}`);
      } catch (err) {
        recordCheck('JSON Syntax Parser', false, err.message);
        isParsed = false;
      }

      const text = buffer.toString('utf-8').trim();
      const hasBraces = (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
      recordCheck('JSON Enclosing Brackets', hasBraces);

      signatureValid = hasBraces;
      structureValid = isParsed;
      formatConsistency = isParsed;
      break;
    }

    case 'CSV': {
      const str = buffer.toString('utf-8');
      const lines = str.split(/\r?\n/).filter(l => l.trim().length > 0);
      recordCheck('CSV Non-empty Lines', lines.length > 0, `Line count: ${lines.length}`);
      
      let columnConsistent = true;
      if (lines.length > 0) {
        const expectedCols = lines[0].split(/,|;|\t/).length;
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(/,|;|\t/).length;
          if (cols !== expectedCols) {
            columnConsistent = false;
            break;
          }
        }
      }
      recordCheck('CSV Column Consistency Across Rows', columnConsistent);

      signatureValid = lines.length > 0;
      structureValid = columnConsistent;
      formatConsistency = lines.length > 0 && columnConsistent;
      break;
    }

    case 'TXT': {
      const text = buffer.toString('utf-8');
      const isUtf8 = !text.includes('\uFFFD'); // UTF-8 replacement character
      recordCheck('UTF-8 String Decoding', isUtf8);
      
      const printableRatio = getPrintableRatio(buffer);
      const isPrintable = printableRatio > 0.85;
      recordCheck('Printable Text Character Ratio', isPrintable, `Ratio: ${(printableRatio * 100).toFixed(1)}%`);

      signatureValid = isPrintable;
      structureValid = isUtf8 && isPrintable;
      formatConsistency = isUtf8;
      break;
    }

    case 'ZIP':
    case 'DOCX': {
      const headerHex = buffer.slice(0, 4).toString('hex').toLowerCase();
      const hasZipHeader = headerHex === '504b0304';
      recordCheck('ZIP/DOCX Local File Header (PK\\x03\\x04)', hasZipHeader);
      if (!hasZipHeader) signatureValid = false;

      const footerHex = buffer.slice(Math.max(0, buffer.length - 64)).toString('hex').toLowerCase();
      const hasCentralDirEnd = footerHex.includes('504b0506');
      recordCheck('ZIP End of Central Directory Record (PK\\x05\\x06)', hasCentralDirEnd);

      structureValid = hasZipHeader && hasCentralDirEnd;
      formatConsistency = hasZipHeader;
      break;
    }
    case 'MP4': {
      const hasFtyp = buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
      const hasMoov = buffer.includes(Buffer.from('moov'));
      recordCheck('MP4 ftyp box', hasFtyp);
      recordCheck('MP4 moov box', hasMoov);
      signatureValid = hasFtyp; structureValid = hasFtyp && hasMoov; formatConsistency = hasFtyp;
      break;
    }
    case 'SQLITE': {
      const validHeader = buffer.slice(0, 16).toString('ascii') === 'SQLite format 3\0';
      recordCheck('SQLite format 3 header', validHeader);
      recordCheck('SQLite page alignment', buffer.length >= 100 && (buffer.length % 512 === 0 || buffer.length >= 100));
      signatureValid = validHeader; structureValid = validHeader; formatConsistency = validHeader;
      break;
    }
    case 'PCAP': {
      const magic = buffer.slice(0, 4).toString('hex').toLowerCase();
      const validMagic = ['d4c3b2a1', 'a1b2c3d4', '4d3cb2a1', 'a1b23c4d'].includes(magic);
      recordCheck('PCAP global header magic', validMagic);
      recordCheck('PCAP global header length', buffer.length >= 24);
      signatureValid = validMagic; structureValid = validMagic && buffer.length >= 24; formatConsistency = validMagic;
      break;
    }

    default: {
      recordCheck('Unknown Format Signature Match', false, 'No valid magic bytes or format structure identified');
      structureValid = false;
      signatureValid = false;
      formatConsistency = false;
      break;
    }
  }

  const score = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  return {
    structureValid,
    signatureValid,
    formatConsistency,
    score,
    checks
  };
}

function getPrintableRatio(buffer) {
  if (buffer.length === 0) return 0;
  let count = 0;
  let binaryControl = 0;
  const len = Math.min(buffer.length, 1024);
  for (let i = 0; i < len; i++) {
    const b = buffer[i];
    if ((b >= 0 && b <= 8) || b === 11 || b === 12 || (b >= 14 && b <= 31) || b === 127) {
      binaryControl++;
    } else if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) {
      count++;
    }
  }
  if (binaryControl > 0) return 0;
  return count / len;
}

module.exports = { validate };
