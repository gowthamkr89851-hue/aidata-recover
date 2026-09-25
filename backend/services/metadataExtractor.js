/**
 * Extracts format-specific metadata from file buffer
 */
function extract(buffer, detectedType) {
  const metadata = {
    bufferLength: buffer.length
  };

  try {
    switch (detectedType) {
      case 'PDF': {
        const text = buffer.toString('utf-8', 0, Math.min(buffer.length, 4096));
        const versionMatch = text.match(/%PDF-(\d+\.\d+)/);
        metadata.pdfVersion = versionMatch ? versionMatch[1] : 'Unknown';
        
        const fullText = buffer.toString('utf-8');
        const objectMatches = fullText.match(/\d+ \d+ obj/g);
        metadata.objectCount = objectMatches ? objectMatches.length : 0;
        metadata.hasCatalog = fullText.includes('/Type /Catalog') || fullText.includes('/Type/Catalog');
        metadata.hasXref = fullText.includes('xref') || fullText.includes('/Type /XRef');
        metadata.hasEOF = fullText.includes('%%EOF');
        break;
      }
      case 'PNG': {
        if (buffer.length >= 24 && buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
          metadata.width = buffer.readUInt32BE(16);
          metadata.height = buffer.readUInt32BE(20);
          metadata.bitDepth = buffer[24];
          metadata.colorType = buffer[25];
        }
        
        // Scan PNG chunk types
        const chunks = [];
        let offset = 8;
        while (offset + 8 <= buffer.length) {
          const length = buffer.readUInt32BE(offset);
          const type = buffer.toString('ascii', offset + 4, offset + 8);
          chunks.push(type);
          offset += 12 + length;
          if (type === 'IEND' || offset > buffer.length) break;
        }
        metadata.pngChunks = chunks;
        break;
      }
      case 'JSON': {
        try {
          const parsed = JSON.parse(buffer.toString('utf-8'));
          metadata.structure = Array.isArray(parsed) ? 'Array' : 'Object';
          metadata.topLevelKeys = Array.isArray(parsed) ? parsed.length : Object.keys(parsed);
        } catch {
          metadata.parseError = 'Invalid JSON structure';
        }
        break;
      }
      case 'CSV': {
        const str = buffer.toString('utf-8');
        const lines = str.split(/\r?\n/).filter(l => l.trim().length > 0);
        metadata.lineCount = lines.length;
        if (lines.length > 0) {
          const headers = lines[0].split(/,|;|\t/).map(h => h.trim());
          metadata.columnCount = headers.length;
          metadata.headers = headers;
        }
        break;
      }
      case 'TXT': {
        const str = buffer.toString('utf-8');
        const lines = str.split(/\r?\n/);
        metadata.lineCount = lines.length;
        metadata.characterCount = str.length;
        metadata.wordCount = str.trim().split(/\s+/).filter(Boolean).length;
        break;
      }
      case 'ZIP':
      case 'DOCX': {
        metadata.isZipArchive = true;
        const fullText = buffer.toString('ascii');
        const fileEntries = fullText.match(/PK\x01\x02[^\x01\x02]+/g);
        metadata.archiveEntriesCount = fileEntries ? fileEntries.length : 0;
        break;
      }
    }
  } catch (err) {
    metadata.extractionError = err.message;
  }

  return metadata;
}

module.exports = { extract };
