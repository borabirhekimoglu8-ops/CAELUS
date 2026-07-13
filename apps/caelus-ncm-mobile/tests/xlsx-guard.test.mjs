import assert from "node:assert/strict";
import test from "node:test";
import {
  XLSX_ARCHIVE_LIMITS,
  XlsxArchiveSafetyError,
  assertSafeXlsxFile,
} from "../lib/xlsx-guard.mjs";

function makeCentralRecord({
  name = "xl/worksheets/sheet1.xml",
  compressedBytes = 1_000,
  uncompressedBytes = 5_000,
  extra = Buffer.alloc(0),
  flags = 0,
  diskStart = 0,
  localHeaderOffset = 0,
} = {}) {
  const fileName = Buffer.from(name);
  const record = Buffer.alloc(46 + fileName.length + extra.length);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(flags, 8);
  record.writeUInt16LE(8, 10);
  record.writeUInt32LE(compressedBytes, 20);
  record.writeUInt32LE(uncompressedBytes, 24);
  record.writeUInt16LE(fileName.length, 28);
  record.writeUInt16LE(extra.length, 30);
  record.writeUInt16LE(0, 32);
  record.writeUInt16LE(diskStart, 34);
  record.writeUInt32LE(localHeaderOffset, 42);
  fileName.copy(record, 46);
  extra.copy(record, 46 + fileName.length);
  return record;
}

function makeArchive(records, options = {}) {
  const prefix = Buffer.alloc(options.centralDirectoryOffset ?? 64, 0x41);
  const centralDirectory = options.centralDirectory || Buffer.concat(records);
  const eocd = Buffer.alloc(22);
  const entryCount = options.entryCount ?? records.length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.diskNumber ?? 0, 4);
  eocd.writeUInt16LE(options.centralDirectoryDisk ?? 0, 6);
  eocd.writeUInt16LE(options.entriesOnDisk ?? entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(options.centralDirectoryBytes ?? centralDirectory.length, 12);
  eocd.writeUInt32LE(options.centralDirectoryOffset ?? prefix.length, 16);
  return new Blob([prefix, centralDirectory, eocd]);
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof XlsxArchiveSafetyError);
    assert.equal(error.code, code);
    return true;
  });
}

test("güvenli XLSX ZIP merkez dizini kabul edilir", async () => {
  const archive = makeArchive([
    makeCentralRecord({ name: "[Content_Types].xml", compressedBytes: 500, uncompressedBytes: 2_000 }),
    makeCentralRecord({ name: "xl/workbook.xml", compressedBytes: 900, uncompressedBytes: 4_000 }),
  ]);
  await assert.doesNotReject(assertSafeXlsxFile(archive));
});

test("ZIP64 işaretleri EOCD ve kayıt ek alanında reddedilir", async () => {
  const saturated = makeArchive([], { entryCount: 0xffff, entriesOnDisk: 0xffff });
  await expectCode(assertSafeXlsxFile(saturated), "ZIP64_UNSUPPORTED");

  const zip64Extra = Buffer.from([0x01, 0x00, 0x00, 0x00]);
  const withExtra = makeArchive([makeCentralRecord({ extra: zip64Extra })]);
  await expectCode(assertSafeXlsxFile(withExtra), "ZIP64_UNSUPPORTED");
});

test("1000 kayıt sınırının üzerindeki arşiv reddedilir", async () => {
  const records = Array.from(
    { length: XLSX_ARCHIVE_LIMITS.maxEntries + 1 },
    (_, index) => makeCentralRecord({ name: `xl/a${index}`, compressedBytes: 1, uncompressedBytes: 1 }),
  );
  await expectCode(assertSafeXlsxFile(makeArchive(records)), "ENTRY_LIMIT_EXCEEDED");
});

test("20 MB açılmış boyut sınırının üzerindeki arşiv reddedilir", async () => {
  const record = makeCentralRecord({
    compressedBytes: 1024 * 1024,
    uncompressedBytes: XLSX_ARCHIVE_LIMITS.maxUncompressedBytes + 1,
  });
  await expectCode(assertSafeXlsxFile(makeArchive([record])), "UNCOMPRESSED_SIZE_EXCEEDED");
});

test("30x üzerindeki toplam sıkıştırma oranı reddedilir", async () => {
  const record = makeCentralRecord({
    compressedBytes: 100_000,
    uncompressedBytes: (100_000 * XLSX_ARCHIVE_LIMITS.maxCompressionRatio) + 1,
  });
  await expectCode(assertSafeXlsxFile(makeArchive([record])), "COMPRESSION_RATIO_EXCEEDED");
});

test("2 MB üzerindeki merkez dizini okunmadan reddedilir", async () => {
  const oversized = Buffer.alloc(XLSX_ARCHIVE_LIMITS.maxCentralDirectoryBytes + 1);
  const archive = makeArchive([], {
    centralDirectory: oversized,
    centralDirectoryBytes: oversized.length,
  });
  await expectCode(assertSafeXlsxFile(archive), "CENTRAL_DIRECTORY_TOO_LARGE");
});

test("eksik veya tutarsız merkez dizinleri fail-closed reddedilir", async () => {
  await expectCode(assertSafeXlsxFile(new Blob(["not-a-zip"])), "MALFORMED_ARCHIVE");

  const truncated = makeCentralRecord();
  const archive = makeArchive([], {
    centralDirectory: truncated.subarray(0, truncated.length - 2),
    entryCount: 1,
  });
  await expectCode(assertSafeXlsxFile(archive), "MALFORMED_ARCHIVE");
});
