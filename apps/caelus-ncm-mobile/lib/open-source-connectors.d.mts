export type OpenSourceHit = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceClass: "public_source";
  publisher: string;
  independenceGroup: string;
  uri: string;
  title: string;
  content: string;
  retrievedAt: string;
  publishedAt: string | null;
  license: string;
  trustTier: string;
  promotionEligible: boolean;
  locator: string;
};

export type OpenSourceReport = {
  sourceId: string;
  sourceName: string;
  ok: boolean;
  skipped: boolean;
  count: number;
  queryUsed: string | null;
  error: string | null;
};

export type OpenSourceAdapterMetadata = {
  id: string;
  label: string;
  publisher: string;
  independenceGroup: string;
  license: string;
  trustTier: string;
  queryKind: string;
  promotionEligible: boolean;
};

export const OPEN_SOURCE_ADAPTERS: ReadonlyArray<Readonly<OpenSourceAdapterMetadata>>;
export function textFromMarkup(value: string): string;
export function planOpenSourceQuery(value: string): {
  original: string;
  entity: string;
  knowledgeTr: string;
  global: string;
  news: string;
  scholarly: string | null;
  medical: string | null;
};
export function searchOpenSources(query: string, options?: {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  limit?: number;
  timeoutMs?: number;
  retrievedAt?: string;
}): Promise<{
  query: string;
  plan: ReturnType<typeof planOpenSourceQuery>;
  retrievedAt: string;
  hits: OpenSourceHit[];
  reports: OpenSourceReport[];
  attemptedSources: number;
  successfulSources: number;
  failedSources: number;
  skippedSources: number;
}>;
export function importOpenUrl(url: string, options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retrievedAt?: string;
  title?: string;
}): Promise<OpenSourceHit>;
