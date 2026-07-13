"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import readExcelFile from "read-excel-file/browser";
import {
  mergeEvidenceRecords,
  parseEvidenceFileText,
  spreadsheetSheetsToJson,
  type EvidenceRecord,
} from "../../lib/evidence-vault.mjs";
import { assertSafeXlsxFile } from "../../lib/xlsx-guard.mjs";

const TEXT_EXTENSIONS = ["txt", "md", "csv", "tsv", "json", "jsonl"] as const;
const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, "xlsx"] as const;
const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(",");
const DEFAULT_STORAGE_KEY = "caelus:source-vault:v1";
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BATCH_COUNT = 8;
const MAX_FILE_BATCH_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_RECORDS = 10_000;
const VAULT_DB_NAME = "caelus-evidence-vault-v1";
const VAULT_STORE_NAME = "vaults";

type EvidenceFormat = (typeof TEXT_EXTENSIONS)[number];
type FileFormat = (typeof ACCEPTED_EXTENSIONS)[number];
type DeclaredFileTier = "unknown" | "community" | "institutional" | "official";
type SourceKind = "file" | "url" | "query";
type SourceStatus = "loading" | "ready" | "error";

type SourceEntry = {
  id: string;
  kind: SourceKind;
  label: string;
  detail: string;
  format?: string;
  status: SourceStatus;
  records: unknown[];
  message?: string;
  createdAt: string;
};

type PersistedVault = {
  version: 1;
  query: string;
  entries: SourceEntry[];
};

export type SourceVaultFetchRequest =
  | { kind: "url"; url: string }
  | { kind: "query"; query: string };

export type SourceVaultFetchDocument = {
  title?: string;
  url?: string;
  text?: string;
  content?: string;
  format?: EvidenceFormat | string;
  publisher?: string;
  tier?: 1 | 2 | 3 | 4 | "primary" | "official" | "institutional" | "reputable" | "community" | "unknown";
  publishedAt?: string;
  license?: string;
  promotionEligible?: boolean;
  records?: unknown[];
};

export type SourceVaultFetchResponse =
  | SourceVaultFetchDocument
  | SourceVaultFetchDocument[]
  | {
      label?: string;
      records?: unknown[];
      documents?: SourceVaultFetchDocument[];
    };

export type SourceVaultImportResult = SourceVaultFetchResponse | unknown[];

export type SourceVaultFetchAdapter = (
  request: SourceVaultFetchRequest,
) => Promise<SourceVaultImportResult>;

export type SourceVaultProps = {
  onEvidenceChange?: (payload: { records: unknown[]; queryContext: string; busyCount: number }) => void;
  onSearchOpenSources?: (query: string) => Promise<SourceVaultImportResult>;
  onImportUrl?: (url: string) => Promise<SourceVaultImportResult>;
  fetchAdapter?: SourceVaultFetchAdapter;
  storageKey?: string;
  maxFileBytes?: number;
  className?: string;
};

type Notice = {
  tone: "neutral" | "success" | "warning";
  text: string;
};

type ParseResult = {
  records?: unknown[];
  errors?: unknown[];
};

type MergeResult = {
  records?: unknown[];
};

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return match?.[1] ?? "";
}

function isEvidenceFormat(value: string): value is EvidenceFormat {
  return (TEXT_EXTENSIONS as readonly string[]).includes(value);
}

function isFileFormat(value: string): value is FileFormat {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "şimdi";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (isObject(error) && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikeEvidenceRecord(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.text === "string" &&
    (typeof value.fingerprint === "string" || "provenance" in value || ("source" in value && "locator" in value))
  );
}

function looksLikeFetchDocument(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!isObject(value)) return false;
  return typeof value.text === "string" || typeof value.content === "string" || Array.isArray(value.records);
}

function isSourceEntry(value: unknown): value is SourceEntry {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.kind === "file" || value.kind === "url" || value.kind === "query") &&
    typeof value.label === "string" &&
    typeof value.detail === "string" &&
    (value.status === "loading" || value.status === "ready" || value.status === "error") &&
    Array.isArray(value.records) &&
    typeof value.createdAt === "string"
  );
}

function normalizePersistedVault(parsed: unknown): PersistedVault | null {
  if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) return null;
  const entries = parsed.entries.filter(isSourceEntry).map((entry) =>
    entry.status === "loading"
      ? { ...entry, status: "error" as const, message: "Yarım kalan aktarım yeniden başlatılmalı." }
      : entry,
  );
  return { version: 1, query: typeof parsed.query === "string" ? parsed.query : "", entries };
}

function readPersistedVault(raw: string | null): PersistedVault | null {
  if (!raw) return null;
  try { return normalizePersistedVault(JSON.parse(raw)); } catch { return null; }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function openVaultDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) throw new Error("IndexedDB unavailable");
  const request = window.indexedDB.open(VAULT_DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(VAULT_STORE_NAME)) request.result.createObjectStore(VAULT_STORE_NAME);
  };
  return requestResult(request);
}

async function loadPersistedVault(storageKey: string): Promise<PersistedVault | null> {
  try {
    const database = await openVaultDatabase();
    try {
      const transaction = database.transaction(VAULT_STORE_NAME, "readonly");
      const completed = transactionComplete(transaction);
      const value = await requestResult(transaction.objectStore(VAULT_STORE_NAME).get(storageKey));
      await completed;
      const saved = normalizePersistedVault(value);
      if (saved) return saved;
    } finally {
      database.close();
    }
  } catch {
    // Migrate/fall back to the earlier small-vault localStorage format.
  }
  return readPersistedVault(window.localStorage.getItem(storageKey));
}

async function persistVault(storageKey: string, payload: PersistedVault): Promise<void> {
  try {
    const database = await openVaultDatabase();
    try {
      const transaction = database.transaction(VAULT_STORE_NAME, "readwrite");
      const completed = transactionComplete(transaction);
      transaction.objectStore(VAULT_STORE_NAME).put(payload, storageKey);
      await completed;
      window.localStorage.removeItem(storageKey);
      return;
    } finally {
      database.close();
    }
  } catch {
    // Small vaults still work in browsers where IndexedDB is disabled.
  }
  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}

async function deletePersistedVault(storageKey: string): Promise<void> {
  try {
    const database = await openVaultDatabase();
    try {
      const transaction = database.transaction(VAULT_STORE_NAME, "readwrite");
      const completed = transactionComplete(transaction);
      transaction.objectStore(VAULT_STORE_NAME).delete(storageKey);
      await completed;
    } finally {
      database.close();
    }
  } catch {
    // Clearing in-memory state must still succeed.
  }
  window.localStorage.removeItem(storageKey);
}

function mergeRecordGroups(groups: unknown[][]): unknown[] {
  if (!groups.length) return [];

  try {
    const result = mergeEvidenceRecords(...(groups as EvidenceRecord[][])) as MergeResult;
    return Array.isArray(result?.records) ? result.records : groups.flat();
  } catch {
    return groups.flat();
  }
}

function mergedRecords(entries: SourceEntry[]): unknown[] {
  return mergeRecordGroups(
    entries
      .filter((entry) => entry.status === "ready")
      .map((entry) => entry.records),
  );
}

function sourceStatusLabel(entry: SourceEntry): string {
  if (entry.status === "loading") return "İŞLENİYOR";
  if (entry.status === "error") return "HATA";
  return "AYRIŞTIRILDI";
}

function requestLabel(request: SourceVaultFetchRequest): string {
  if (request.kind === "query") return request.query;
  try {
    return new URL(request.url).hostname.replace(/^www\./, "");
  } catch {
    return request.url;
  }
}

function requestDetail(request: SourceVaultFetchRequest): string {
  return request.kind === "query" ? "Açık kaynak taraması" : request.url;
}

function publisherFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function adapterDocuments(response: SourceVaultImportResult): {
  records: unknown[];
  documents: SourceVaultFetchDocument[];
  label?: string;
} {
  if (Array.isArray(response)) {
    if (response.length && response.every(looksLikeEvidenceRecord)) {
      return { records: response, documents: [] };
    }
    if (response.every(looksLikeFetchDocument)) {
      const documents = response.flatMap((value) => {
        if (typeof value === "string") return [{ text: value }];
        return isObject(value) ? [value as SourceVaultFetchDocument] : [];
      });
      return { records: [], documents };
    }
    return { records: response, documents: [] };
  }
  const objectResponse: Record<string, unknown> = response;
  if (Array.isArray(objectResponse.documents)) {
    return {
      records: Array.isArray(objectResponse.records) ? objectResponse.records : [],
      documents: objectResponse.documents as SourceVaultFetchDocument[],
      label: typeof objectResponse.label === "string" ? objectResponse.label : undefined,
    };
  }
  if (Array.isArray(objectResponse.records) && !("text" in objectResponse) && !("content" in objectResponse)) {
    return {
      records: objectResponse.records,
      documents: [],
      label: typeof objectResponse.label === "string" ? objectResponse.label : undefined,
    };
  }
  return { records: [], documents: [response as SourceVaultFetchDocument] };
}

function parseAdapterResponse(
  response: SourceVaultImportResult,
  request: SourceVaultFetchRequest,
  retrievedAt: string,
): { records: unknown[]; label?: string; errors: string[] } {
  const normalized = adapterDocuments(response);
  const groups: unknown[][] = [normalized.records];
  const errors: string[] = [];

  normalized.documents.forEach((document, index) => {
    if (Array.isArray(document.records)) groups.push(document.records);

    const text = typeof document.text === "string"
      ? document.text
      : typeof document.content === "string"
        ? document.content
        : "";
    if (!text.trim()) {
      if (!document.records?.length) errors.push(`${document.title ?? `Belge ${index + 1}`}: içerik boş.`);
      return;
    }

    const inferred = document.format?.toLowerCase() || extensionOf(document.url ?? "") || "txt";
    const format = isEvidenceFormat(inferred) ? inferred : "txt";
    const sourceUri = document.url ?? (request.kind === "url" ? request.url : undefined);
    try {
      const parsed = parseEvidenceFileText(text, {
        format,
        fileName: document.title ?? sourceUri ?? `açık-kaynak-${index + 1}.${format}`,
        source: {
          name: document.title ?? requestLabel(request),
          kind: "public_source",
          uri: sourceUri,
          publisher: document.publisher ?? publisherFromUrl(sourceUri),
          tier: document.tier ?? "unknown",
          publishedAt: document.publishedAt,
          retrievedAt,
          license: document.license,
          promotionEligible: document.promotionEligible,
        },
        referenceDate: retrievedAt,
      }) as ParseResult;
      if (Array.isArray(parsed.records)) groups.push(parsed.records);
      if (Array.isArray(parsed.errors)) {
        parsed.errors.forEach((error) => errors.push(errorMessage(error, "Belge ayrıştırılamadı.")));
      }
    } catch (error) {
      errors.push(errorMessage(error, `${document.title ?? "Belge"} ayrıştırılamadı.`));
    }
  });

  const records = mergeRecordGroups(groups.filter((group) => group.length));
  if (!records.length && !errors.length) errors.push("Bağdaştırıcı kanıt kaydı döndürmedi.");
  return { records, label: normalized.label, errors };
}

export function SourceVault({
  onEvidenceChange,
  onSearchOpenSources,
  onImportUrl,
  fetchAdapter,
  storageKey = DEFAULT_STORAGE_KEY,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  className = "",
}: SourceVaultProps) {
  const componentId = useId();
  const titleId = `${componentId}-title`;
  const fileHintId = `${componentId}-file-hint`;
  const filePublisherId = `${componentId}-file-publisher`;
  const fileDateId = `${componentId}-file-date`;
  const fileTierId = `${componentId}-file-tier`;
  const urlInputId = `${componentId}-url`;
  const urlErrorId = `${componentId}-url-error`;
  const queryInputId = `${componentId}-query`;
  const queryHintId = `${componentId}-query-hint`;
  const queryErrorId = `${componentId}-query-error`;
  const libraryTitleId = `${componentId}-library-title`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileImportRef = useRef(false);
  const queryRef = useRef("");
  const recordCountRef = useRef(0);
  const mountedRef = useRef(true);
  const onEvidenceChangeRef = useRef(onEvidenceChange);
  const [entries, setEntries] = useState<SourceEntry[]>([]);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [filePublisher, setFilePublisher] = useState("");
  const [filePublishedAt, setFilePublishedAt] = useState("");
  const [fileTier, setFileTier] = useState<DeclaredFileTier>("unknown");
  const [urlError, setUrlError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice>({
    tone: "neutral",
    text: "Dosya yükleyin veya bir açık kaynak sorgusu başlatın.",
  });

  const records = useMemo(() => mergedRecords(entries), [entries]);
  const storedRecordCount = useMemo(
    () => entries.reduce((total, entry) => total + (entry.status === "ready" ? entry.records.length : 0), 0),
    [entries],
  );
  const readyCount = entries.filter((entry) => entry.status === "ready").length;
  const busyCount = entries.filter((entry) => entry.status === "loading").length;

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    recordCountRef.current = storedRecordCount;
  }, [storedRecordCount]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onEvidenceChangeRef.current = onEvidenceChange;
  }, [onEvidenceChange]);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedVault(storageKey)
      .then((saved) => {
        if (cancelled) return;
        setEntries(saved?.entries ?? []);
        setQuery(saved?.query ?? "");
        if (saved?.entries.length) {
          setNotice({
            tone: "success",
            text: `${saved.entries.length} yerel kaynak cihaz hafızasından geri yüklendi.`,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setNotice({ tone: "warning", text: "Cihaz hafızasına erişilemedi; kayıtlar bu oturumda kalacak." });
      })
      .finally(() => {
        if (cancelled) return;
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const payload: PersistedVault = { version: 1, query: queryRef.current, entries };
      void persistVault(storageKey, payload).catch(() => {
        if (mountedRef.current) {
          setNotice({ tone: "warning", text: "Cihaz depolama sınırı aşıldı; son değişiklik kalıcı olmayabilir." });
        }
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [entries, hydrated, query, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    onEvidenceChangeRef.current?.({ records, queryContext: queryRef.current.trim(), busyCount });
  }, [busyCount, hydrated, records]);

  const replaceEntry = useCallback((id: string, next: SourceEntry) => {
    setEntries((current) => current.map((entry) => entry.id === id ? next : entry));
  }, []);

  const importFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (!hydrated) {
      setNotice({ tone: "neutral", text: "Cihazdaki kaynak kasası hazırlanıyor; birkaç saniye sonra tekrar deneyin." });
      return;
    }
    if (busyCount > 0) {
      setNotice({ tone: "warning", text: "Önce devam eden kaynak işleminin bitmesini bekleyin." });
      return;
    }
    if (fileImportRef.current) {
      setNotice({ tone: "warning", text: "Önce devam eden dosya işleminin bitmesini bekleyin." });
      return;
    }
    fileImportRef.current = true;
    try {
      const declaredPublisher = filePublisher.trim();
      const accepted: Array<{ file: File; format: FileFormat; id: string; createdAt: string }> = [];
      const rejected: string[] = [];
      let acceptedBytes = 0;
      let successfulCount = 0;
      let failedCount = 0;

    files.forEach((file) => {
      const format = extensionOf(file.name);
      if (!isFileFormat(format)) {
        rejected.push(`${file.name}: desteklenmeyen dosya türü`);
        return;
      }
      if (file.size > maxFileBytes) {
        rejected.push(`${file.name}: ${formatBytes(maxFileBytes)} sınırını aşıyor`);
        return;
      }
      if (accepted.length >= MAX_FILE_BATCH_COUNT) {
        rejected.push(`${file.name}: tek seferde en fazla ${MAX_FILE_BATCH_COUNT} dosya işlenebilir`);
        return;
      }
      if (acceptedBytes + file.size > MAX_FILE_BATCH_BYTES) {
        rejected.push(`${file.name}: toplam ${formatBytes(MAX_FILE_BATCH_BYTES)} işlem sınırını aşıyor`);
        return;
      }
      acceptedBytes += file.size;
      accepted.push({ file, format, id: makeId("file"), createdAt: new Date().toISOString() });
    });

    if (accepted.length) {
      setEntries((current) => [
        ...accepted.map(({ file, format, id, createdAt }) => ({
          id,
          kind: "file" as const,
          label: file.name,
          detail: `${format.toUpperCase()} · ${formatBytes(file.size)}${declaredPublisher ? ` · ${declaredPublisher}` : ""}`,
          format,
          status: "loading" as const,
          records: [],
          createdAt,
        })),
        ...current,
      ]);
    }

    for (const { file, format, id, createdAt } of accepted) {
      try {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        let text: string;
        let parserFormat: EvidenceFormat;
        if (format === "xlsx") {
          await assertSafeXlsxFile(file);
          const sheets = await readExcelFile(file);
          text = spreadsheetSheetsToJson(sheets);
          parserFormat = "json";
        } else {
          text = await file.text();
          parserFormat = format;
        }
        const parsed = parseEvidenceFileText(text, {
          format: parserFormat,
          fileName: file.name,
          mimeType: file.type || undefined,
          source: {
            name: file.name,
            kind: "user_file",
            publisher: declaredPublisher || "Kullanıcı yüklemesi",
            tier: fileTier,
            publishedAt: filePublishedAt || undefined,
            retrievedAt: createdAt,
            license: "Metadata kullanıcı beyanıdır",
          },
          referenceDate: createdAt,
        }) as ParseResult;
        const nextRecords = Array.isArray(parsed.records) ? parsed.records : [];
        const parseErrors = Array.isArray(parsed.errors) ? parsed.errors : [];
        if (!mountedRef.current) return;
        const totalIfAdded = recordCountRef.current + nextRecords.length;
        if (nextRecords.length && totalIfAdded > MAX_TOTAL_RECORDS) {
          replaceEntry(id, {
            id,
            kind: "file",
            label: file.name,
            detail: `${format.toUpperCase()} · ${formatBytes(file.size)}${declaredPublisher ? ` · ${declaredPublisher}` : ""}`,
            format,
            status: "error",
            records: [],
            message: `Kasa en fazla ${MAX_TOTAL_RECORDS.toLocaleString("tr-TR")} kayıt tutar. Önce bazı kaynakları kaldırın.`,
            createdAt,
          });
          failedCount += 1;
          continue;
        }
        recordCountRef.current = totalIfAdded;
        replaceEntry(id, {
          id,
          kind: "file",
          label: file.name,
          detail: `${format.toUpperCase()} · ${formatBytes(file.size)}${declaredPublisher ? ` · ${declaredPublisher}` : ""}`,
          format,
          status: nextRecords.length ? "ready" : "error",
          records: nextRecords,
          message: nextRecords.length
            ? parseErrors.length ? errorMessage(parseErrors[0], `${parseErrors.length} ayrıştırma uyarısı.`) : undefined
            : parseErrors.length ? errorMessage(parseErrors[0], "Dosya ayrıştırılamadı.") : "Dosyada kanıt kaydı bulunamadı.",
          createdAt,
        });
        if (nextRecords.length) successfulCount += 1;
        else failedCount += 1;
      } catch (error) {
        if (!mountedRef.current) return;
        replaceEntry(id, {
          id,
          kind: "file",
          label: file.name,
          detail: `${format.toUpperCase()} · ${formatBytes(file.size)}${declaredPublisher ? ` · ${declaredPublisher}` : ""}`,
          format,
          status: "error",
          records: [],
          message: errorMessage(error, "Dosya okunamadı."),
          createdAt,
        });
        failedCount += 1;
      }
    }

    if (!mountedRef.current) return;
      if (rejected.length || failedCount) {
        const summary = `${successfulCount} dosya işlendi · ${failedCount + rejected.length} dosya alınamadı.`;
        setNotice({ tone: "warning", text: rejected.length ? `${summary} ${rejected.slice(0, 2).join(" · ")}` : summary });
      } else if (successfulCount) {
        setNotice({ tone: "success", text: `${successfulCount} dosya kanıt defterine işlendi.` });
      }
    } finally {
      fileImportRef.current = false;
    }
  }, [busyCount, filePublishedAt, filePublisher, fileTier, hydrated, maxFileBytes, replaceEntry]);

  const onFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    void importFiles(selected);
  }, [importFiles]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void importFiles(Array.from(event.dataTransfer.files));
  }, [importFiles]);

  const fetchSource = useCallback(async (request: SourceVaultFetchRequest) => {
    if (!hydrated) {
      setNotice({ tone: "neutral", text: "Cihazdaki kaynak kasası hazırlanıyor; birkaç saniye sonra tekrar deneyin." });
      return false;
    }
    if (busyCount > 0) {
      setNotice({ tone: "warning", text: "Önce devam eden kaynak işleminin bitmesini bekleyin." });
      return false;
    }
    const dedicatedAdapter = request.kind === "query"
      ? onSearchOpenSources
        ? () => onSearchOpenSources(request.query)
        : undefined
      : onImportUrl
        ? () => onImportUrl(request.url)
        : undefined;
    const load = dedicatedAdapter ?? (fetchAdapter ? () => fetchAdapter(request) : undefined);

    if (!load) {
      setNotice({
        tone: "warning",
        text: request.kind === "query"
          ? "Açık kaynak bağdaştırıcısı yapılandırılmadı. Sorgu yine de analiz bağlamına eklendi."
          : "URL içe aktarma bağdaştırıcısı yapılandırılmadı; onImportUrl veya fetchAdapter bağlayın.",
      });
      return false;
    }

    const id = makeId(request.kind);
    const createdAt = new Date().toISOString();
    const loadingEntry: SourceEntry = {
      id,
      kind: request.kind,
      label: requestLabel(request),
      detail: requestDetail(request),
      status: "loading",
      records: [],
      createdAt,
    };
    setEntries((current) => [loadingEntry, ...current]);
    setNotice({ tone: "neutral", text: "Kaynaklar alınıyor ve kanıt kayıtları ayrıştırılıyor…" });

    try {
      const response = await load();
      const parsed = parseAdapterResponse(response, request, createdAt);
      if (!mountedRef.current) return false;
      const totalIfAdded = recordCountRef.current + parsed.records.length;
      if (parsed.records.length && totalIfAdded > MAX_TOTAL_RECORDS) {
        const message = `Kasa en fazla ${MAX_TOTAL_RECORDS.toLocaleString("tr-TR")} kayıt tutar. Önce bazı kaynakları kaldırın.`;
        replaceEntry(id, { ...loadingEntry, status: "error", message });
        setNotice({ tone: "warning", text: message });
        return false;
      }
      recordCountRef.current = totalIfAdded;
      replaceEntry(id, {
        ...loadingEntry,
        label: parsed.label?.trim() || loadingEntry.label,
        status: parsed.records.length ? "ready" : "error",
        records: parsed.records,
        message: parsed.errors.length ? parsed.errors.slice(0, 2).join(" · ") : undefined,
      });
      setNotice(parsed.records.length
        ? { tone: "success", text: `${parsed.records.length} açık kaynak kanıtı eklendi.` }
        : { tone: "warning", text: parsed.errors[0] ?? "Kaynak kanıt döndürmedi." });
      return parsed.records.length > 0;
    } catch (error) {
      if (!mountedRef.current) return false;
      const message = errorMessage(error, "Kaynak alınamadı.");
      replaceEntry(id, { ...loadingEntry, status: "error", message });
      setNotice({ tone: "warning", text: message });
      return false;
    }
  }, [busyCount, fetchAdapter, hydrated, onImportUrl, onSearchOpenSources, replaceEntry]);

  const submitUrl = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = url.trim();
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
      setUrlError("");
      void fetchSource({ kind: "url", url: parsed.toString() }).then((imported) => {
        if (imported && mountedRef.current) setUrl("");
      });
    } catch {
      const message = "Geçerli bir http veya https adresi girin.";
      setUrlError(message);
      setNotice({ tone: "warning", text: message });
    }
  }, [fetchSource, url]);

  const submitQuery = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 3) {
      const message = "Açık kaynak sorgusu en az 3 karakter olmalı.";
      setQueryError(message);
      setNotice({ tone: "warning", text: message });
      return;
    }
    setQueryError("");
    setQuery(normalized);
    void fetchSource({ kind: "query", query: normalized });
  }, [fetchSource, query]);

  const removeEntry = useCallback((id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setNotice({ tone: "neutral", text: "Kaynak kanıt defterinden kaldırıldı." });
  }, []);

  const clearVault = useCallback(() => {
    if (entries.length && !window.confirm("Bütün yerel kaynaklar ve açık kaynak sonuçları silinsin mi?")) return;
    setEntries([]);
    recordCountRef.current = 0;
    setQuery("");
    setUrl("");
    setQueryError("");
    setUrlError("");
    void deletePersistedVault(storageKey);
    setNotice({ tone: "neutral", text: "Kaynak kasası temizlendi." });
  }, [entries.length, storageKey]);

  return (
    <section className={`source-vault ${className}`.trim()} aria-labelledby={titleId}>
      <header className="source-vault__header">
        <div>
          <span className="source-vault__eyebrow">YEREL KAYNAK KASASI</span>
          <h2 id={titleId}>Veriyi kanıta dönüştür</h2>
          <p>Dosyaları cihazda ayrıştır; URL ve açık kaynak sonuçlarını aynı kanıt defterinde birleştir.</p>
        </div>
        <span className="source-vault__privacy">DOSYALAR YEREL</span>
      </header>

      <dl className="source-vault__stats" aria-label="Kaynak kasası özeti">
        <div>
          <dt>HAZIR KAYNAK</dt>
          <dd>{readyCount}</dd>
        </div>
        <div>
          <dt>KANIT KAYDI</dt>
          <dd>{records.length}</dd>
        </div>
        <div>
          <dt>İŞLENEN</dt>
          <dd>{busyCount}</dd>
        </div>
      </dl>

      <div
        className={`source-vault__dropzone${dragging ? " source-vault__dropzone--active" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          className="source-vault__file-input"
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          onChange={onFileChange}
          disabled={!hydrated || busyCount > 0}
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className="source-vault__drop-icon" aria-hidden="true">＋</div>
        <div>
          <strong>Dosya veya veri seti ekle</strong>
          <p id={fileHintId}>XLSX, CSV, TSV, JSON, JSONL, TXT veya MD · dosya başına {formatBytes(maxFileBytes)} · tek seferde {MAX_FILE_BATCH_COUNT} dosya/{formatBytes(MAX_FILE_BATCH_BYTES)}</p>
        </div>
        <button
          type="button"
          className="source-vault__pick-button"
          onClick={() => inputRef.current?.click()}
          disabled={!hydrated || busyCount > 0}
          aria-describedby={fileHintId}
        >
          Dosya seç
        </button>
      </div>

      <fieldset className="source-vault__metadata">
        <legend>Dosya kaynak bilgisi · bu seçim için</legend>
        <div>
          <label htmlFor={filePublisherId}>
            Yayıncı / kurum
            <input
              id={filePublisherId}
              type="text"
              inputMode="text"
              placeholder="Örn. Liman Başkanlığı"
              value={filePublisher}
              onChange={(event) => setFilePublisher(event.target.value.slice(0, 160))}
              disabled={!hydrated || busyCount > 0}
            />
          </label>
          <label htmlFor={fileDateId}>
            Belge tarihi
            <input
              id={fileDateId}
              type="date"
              value={filePublishedAt}
              onChange={(event) => setFilePublishedAt(event.target.value)}
              disabled={!hydrated || busyCount > 0}
            />
          </label>
          <label htmlFor={fileTierId}>
            Kaynak niteliği
            <select
              id={fileTierId}
              value={fileTier}
              onChange={(event) => setFileTier(event.target.value as DeclaredFileTier)}
              disabled={!hydrated || busyCount > 0}
            >
              <option value="unknown">Bilinmeyen / kişisel</option>
              <option value="community">Topluluk / editoryal</option>
              <option value="institutional">Kurumsal / akademik</option>
              <option value="official">Birincil / resmi</option>
            </select>
          </label>
        </div>
        <small>İsteğe bağlıdır. Beyan ettiğiniz yayıncı, tarih ve nitelik kaynak izinde görünür; çelişkiler yine taraf seçmeden gösterilir.</small>
      </fieldset>

      <form className="source-vault__source-form" onSubmit={submitUrl}>
        <label htmlFor={urlInputId}>Kaynak adresi</label>
        <div className="source-vault__input-row">
          <input
            id={urlInputId}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="https://kaynak.example/veri"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (urlError) setUrlError("");
            }}
            disabled={!hydrated || busyCount > 0}
            aria-invalid={Boolean(urlError)}
            aria-describedby={urlError ? urlErrorId : undefined}
          />
          <button type="submit" disabled={!hydrated || !url.trim() || busyCount > 0}>URL ekle</button>
        </div>
        {urlError ? <span className="visually-hidden" id={urlErrorId}>{urlError}</span> : null}
      </form>

      <form className="source-vault__source-form source-vault__source-form--query" onSubmit={submitQuery}>
        <label htmlFor={queryInputId}>Açık kaynak sorgusu</label>
        <p id={queryHintId}>Olayı, yeri ve zamanı yazın. Sorgu metni seçili açık kaynak sağlayıcısına gönderilebilir.</p>
        <div className="source-vault__input-row">
          <input
            id={queryInputId}
            type="search"
            enterKeyHint="search"
            placeholder="Örn. Samos feribot iptalleri son 48 saat"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (queryError) setQueryError("");
            }}
            aria-invalid={Boolean(queryError)}
            aria-describedby={`${queryHintId}${queryError ? ` ${queryErrorId}` : ""}`}
            disabled={!hydrated || busyCount > 0}
          />
          <button type="submit" disabled={!hydrated || query.trim().length < 3 || busyCount > 0}>Kaynakları tara</button>
        </div>
        {queryError ? <span className="visually-hidden" id={queryErrorId}>{queryError}</span> : null}
      </form>

      <div className={`source-vault__notice source-vault__notice--${notice.tone}`} role="status" aria-live="polite">
        <span aria-hidden="true" />
        <p>{notice.text}</p>
      </div>

      <section
        className="source-vault__library"
        aria-labelledby={libraryTitleId}
        aria-busy={!hydrated || busyCount > 0}
      >
        <div className="source-vault__library-heading">
          <div>
            <span>KAYNAK DURUMU</span>
            <h3 id={libraryTitleId}>Kanıt defteri</h3>
          </div>
          <button type="button" onClick={clearVault} disabled={!hydrated || busyCount > 0 || (!entries.length && !query)}>Tümünü temizle</button>
        </div>

        {entries.length ? (
          <ul className="source-vault__source-list">
            {entries.map((entry) => (
              <li
                className={`source-vault__source-card source-vault__source-card--${entry.status}`}
                key={entry.id}
              >
                <div className="source-vault__source-mark" aria-hidden="true">
                  {entry.kind === "file" ? "D" : entry.kind === "url" ? "U" : "A"}
                </div>
                <div className="source-vault__source-body">
                  <div>
                    <strong>{entry.label}</strong>
                    <span>{sourceStatusLabel(entry)}</span>
                  </div>
                  <p>{entry.detail}</p>
                  <small>
                    {entry.status === "ready" ? `${entry.records.length} kayıt` : entry.message ?? "Kaynak işleniyor…"}
                    {entry.status === "ready" && entry.message ? ` · ${entry.message}` : ""}
                    {` · ${formatTime(entry.createdAt)}`}
                  </small>
                </div>
                <button
                  type="button"
                  className="source-vault__remove-button"
                  onClick={() => removeEntry(entry.id)}
                  disabled={busyCount > 0}
                  aria-label={`${entry.label} kaynağını kaldır`}
                >
                  Kaldır
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="source-vault__empty">
            <strong>Henüz kaynak yok</strong>
            <p>Eklediğiniz belgeler ve açık kaynak sonuçları burada, kaynak iziyle birlikte görünür.</p>
          </div>
        )}
      </section>

      <footer className="source-vault__footer">
        <span>Birleştirme sırasında tekrar eden kayıtlar ayıklanır.</span>
        <span>Kaynak izi cevapla birlikte korunur.</span>
        <span>Yerel kasa üst sınırı: {MAX_TOTAL_RECORDS.toLocaleString("tr-TR")} kayıt.</span>
      </footer>
    </section>
  );
}
