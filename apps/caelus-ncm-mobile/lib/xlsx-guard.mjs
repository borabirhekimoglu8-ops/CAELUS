const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const MAX_EOCD_SIZE = 22 + 0xffff;

export const XLSX_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 1_000,
  maxUncompressedBytes: 20 * 1024 * 1024,
  maxCompressionRatio: 30,
  maxCentralDirectoryBytes: 2 * 1024 * 1024,
});

export class XlsxArchiveSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "XlsxArchiveSafetyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new XlsxArchiveSafetyError(code, message);
}

function isBlobLike(value) {
  return value
    && Number.isSafeInteger(value.size)
    && value.size >= 0
    && typeof value.slice === "function";
}

async function readBytes(blob, start, end) {
  const part = blob.slice(start, end);
  if (!part || typeof part.arrayBuffer !== "function") {
    fail("INVALID_FILE", "XLSX girdisi okunabilir bir File veya Blob olmalıdır.");
  }
  const bytes = new Uint8Array(await part.arrayBuffer());
  if (bytes.byteLength !== end - start) {
    fail("MALFORMED_ARCHIVE", "XLSX arşivi beklenen byte aralığını sağlamıyor.");
  }
  return bytes;
}

function findEndOfCentralDirectory(bytes, absoluteStart, fileSize) {
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    if (view.getUint32(0, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(20, true);
    const absoluteOffset = absoluteStart + offset;
    if (absoluteOffset + 22 + commentLength === fileSize) {
      return { absoluteOffset, view };
    }
  }
  fail("MALFORMED_ARCHIVE", "XLSX ZIP merkez dizini sonlandırıcısı bulunamadı.");
}

function containsZip64ExtraField(bytes, start, length) {
  const end = start + length;
  let cursor = start;
  while (cursor < end) {
    if (cursor + 4 > end) {
      fail("MALFORMED_ARCHIVE", "XLSX ZIP ek alanı eksik veya bozuk.");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + cursor, end - cursor);
    const fieldId = view.getUint16(0, true);
    const fieldSize = view.getUint16(2, true);
    cursor += 4;
    if (cursor + fieldSize > end) {
      fail("MALFORMED_ARCHIVE", "XLSX ZIP ek alanı merkez dizini sınırını aşıyor.");
    }
    if (fieldId === ZIP64_EXTRA_FIELD_ID) return true;
    cursor += fieldSize;
  }
  return false;
}

function inspectCentralDirectory(bytes, expectedEntries, centralDirectoryOffset) {
  let cursor = 0;
  let entries = 0;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  while (cursor < bytes.byteLength) {
    if (cursor + 46 > bytes.byteLength) {
      fail("MALFORMED_ARCHIVE", "XLSX ZIP merkez dizini kaydı yarım kalmış.");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset + cursor, bytes.byteLength - cursor);
    if (view.getUint32(0, true) !== CENTRAL_FILE_HEADER_SIGNATURE) {
      fail("MALFORMED_ARCHIVE", "XLSX ZIP merkez dizini geçersiz bir kayıt içeriyor.");
    }

    entries += 1;
    if (entries > XLSX_ARCHIVE_LIMITS.maxEntries) {
      fail("ENTRY_LIMIT_EXCEEDED", `XLSX arşivi ${XLSX_ARCHIVE_LIMITS.maxEntries} kayıt sınırını aşıyor.`);
    }

    const flags = view.getUint16(8, true);
    const compressedBytes = view.getUint32(20, true);
    const uncompressedBytes = view.getUint32(24, true);
    const fileNameLength = view.getUint16(28, true);
    const extraFieldLength = view.getUint16(30, true);
    const commentLength = view.getUint16(32, true);
    const diskStart = view.getUint16(34, true);
    const localHeaderOffset = view.getUint32(42, true);
    const recordLength = 46 + fileNameLength + extraFieldLength + commentLength;

    if (cursor + recordLength > bytes.byteLength) {
      fail("MALFORMED_ARCHIVE", "XLSX ZIP merkez dizini kayıt sınırları geçersiz.");
    }

    const hasZip64Sentinel = compressedBytes === 0xffffffff
      || uncompressedBytes === 0xffffffff
      || localHeaderOffset === 0xffffffff
      || diskStart === 0xffff;
    const hasZip64Extra = containsZip64ExtraField(bytes, cursor + 46 + fileNameLength, extraFieldLength);
    if (hasZip64Sentinel || hasZip64Extra) {
      fail("ZIP64_UNSUPPORTED", "ZIP64 biçimindeki XLSX arşivleri güvenlik nedeniyle kabul edilmiyor.");
    }
    if (diskStart !== 0) {
      fail("MALFORMED_ARCHIVE", "Çok diskli XLSX ZIP arşivleri desteklenmiyor.");
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      fail("UNSUPPORTED_ARCHIVE_FEATURE", "Şifreli XLSX ZIP kayıtları desteklenmiyor.");
    }
    if (localHeaderOffset >= centralDirectoryOffset) {
      fail("MALFORMED_ARCHIVE", "XLSX ZIP yerel kayıt konumu geçersiz.");
    }

    totalCompressedBytes += compressedBytes;
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > XLSX_ARCHIVE_LIMITS.maxUncompressedBytes) {
      fail(
        "UNCOMPRESSED_SIZE_EXCEEDED",
        `XLSX açılmış veri boyutu ${XLSX_ARCHIVE_LIMITS.maxUncompressedBytes} byte sınırını aşıyor.`,
      );
    }
    cursor += recordLength;
  }

  if (cursor !== bytes.byteLength || entries !== expectedEntries) {
    fail("MALFORMED_ARCHIVE", "XLSX ZIP merkez dizini kayıt sayısı doğrulanamadı.");
  }
  if (totalUncompressedBytes > 0 && totalCompressedBytes === 0) {
    fail("COMPRESSION_RATIO_EXCEEDED", "XLSX sıkıştırma oranı güvenli sınırı aşıyor.");
  }
  if (
    totalCompressedBytes > 0
    && totalUncompressedBytes > totalCompressedBytes * XLSX_ARCHIVE_LIMITS.maxCompressionRatio
  ) {
    fail(
      "COMPRESSION_RATIO_EXCEEDED",
      `XLSX sıkıştırma oranı ${XLSX_ARCHIVE_LIMITS.maxCompressionRatio}x sınırını aşıyor.`,
    );
  }
}

/**
 * Validates the ZIP metadata of an XLSX File/Blob before a spreadsheet parser
 * is allowed to expand it. It reads only the EOCD tail and central directory.
 */
export async function assertSafeXlsxFile(file) {
  if (!isBlobLike(file)) {
    fail("INVALID_FILE", "XLSX girdisi okunabilir bir File veya Blob olmalıdır.");
  }
  if (file.size < 22) {
    fail("MALFORMED_ARCHIVE", "XLSX dosyası geçerli bir ZIP arşivi değil.");
  }

  const tailStart = Math.max(0, file.size - MAX_EOCD_SIZE);
  const tail = await readBytes(file, tailStart, file.size);
  const { absoluteOffset: eocdOffset, view: eocd } = findEndOfCentralDirectory(tail, tailStart, file.size);
  const diskNumber = eocd.getUint16(4, true);
  const centralDirectoryDisk = eocd.getUint16(6, true);
  const entriesOnDisk = eocd.getUint16(8, true);
  const totalEntries = eocd.getUint16(10, true);
  const centralDirectoryBytes = eocd.getUint32(12, true);
  const centralDirectoryOffset = eocd.getUint32(16, true);

  if (
    entriesOnDisk === 0xffff
    || totalEntries === 0xffff
    || centralDirectoryBytes === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
  ) {
    fail("ZIP64_UNSUPPORTED", "ZIP64 biçimindeki XLSX arşivleri güvenlik nedeniyle kabul edilmiyor.");
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    fail("MALFORMED_ARCHIVE", "Çok diskli veya tutarsız XLSX ZIP arşivi desteklenmiyor.");
  }
  if (totalEntries > XLSX_ARCHIVE_LIMITS.maxEntries) {
    fail("ENTRY_LIMIT_EXCEEDED", `XLSX arşivi ${XLSX_ARCHIVE_LIMITS.maxEntries} kayıt sınırını aşıyor.`);
  }
  if (centralDirectoryBytes > XLSX_ARCHIVE_LIMITS.maxCentralDirectoryBytes) {
    fail(
      "CENTRAL_DIRECTORY_TOO_LARGE",
      `XLSX merkez dizini ${XLSX_ARCHIVE_LIMITS.maxCentralDirectoryBytes} byte sınırını aşıyor.`,
    );
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectoryBytes;
  if (
    !Number.isSafeInteger(centralDirectoryEnd)
    || centralDirectoryOffset > eocdOffset
    || centralDirectoryEnd !== eocdOffset
  ) {
    fail("MALFORMED_ARCHIVE", "XLSX ZIP merkez dizini konumu veya boyutu geçersiz.");
  }

  const centralDirectory = await readBytes(file, centralDirectoryOffset, centralDirectoryEnd);
  inspectCentralDirectory(centralDirectory, totalEntries, centralDirectoryOffset);
}
