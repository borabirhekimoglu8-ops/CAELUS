export type XlsxArchiveSafetyErrorCode =
  | "INVALID_FILE"
  | "MALFORMED_ARCHIVE"
  | "ZIP64_UNSUPPORTED"
  | "ENTRY_LIMIT_EXCEEDED"
  | "UNCOMPRESSED_SIZE_EXCEEDED"
  | "COMPRESSION_RATIO_EXCEEDED"
  | "CENTRAL_DIRECTORY_TOO_LARGE"
  | "UNSUPPORTED_ARCHIVE_FEATURE";

export const XLSX_ARCHIVE_LIMITS: Readonly<{
  maxEntries: 1_000;
  maxUncompressedBytes: number;
  maxCompressionRatio: 30;
  maxCentralDirectoryBytes: number;
}>;

export class XlsxArchiveSafetyError extends Error {
  readonly code: XlsxArchiveSafetyErrorCode;
  constructor(code: XlsxArchiveSafetyErrorCode, message: string);
}

export function assertSafeXlsxFile(file: Blob): Promise<void>;
