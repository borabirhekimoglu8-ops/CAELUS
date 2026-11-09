export type EngineSnapshotNode = {
  id: string;
  type?: string;
  kind?: string;
  state?: number;
  state_fp?: number;
  trust?: number;
  trust_fp?: number;
  reported?: number;
  reported_state_fp?: number;
  friction?: number;
  friction_fp?: number;
  capacity?: number;
  irrecoverable?: boolean;
};

export type EngineSnapshotEdge = {
  from: string;
  to: string;
  weight?: number;
  multiplier_fp?: number;
  lag_ticks?: number;
  active?: boolean;
};

export type EngineSnapshot = {
  type?: string;
  scenario_id?: string;
  tick: number;
  clamped_friction: number;
  throughput_ratio: number;
  outage_active: boolean;
  any_hysteresis_flip?: boolean;
  any_deadline_missed?: boolean;
  nodes: EngineSnapshotNode[];
  edges: EngineSnapshotEdge[];
};

export type EngineLever = {
  id: string;
  label?: string;
  target?: string;
  success_p?: number;
  success_p_fp?: number;
  locked?: boolean;
  cost_ticks?: number;
  lockout_ticks?: number;
};

type CaelusExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  cae_buf(): number;
  cae_buf_cap(): number;
  cae_load(length: number): number;
  cae_tick(count: number): number;
  cae_lever(length: number): number;
  cae_snapshot(): number;
  cae_levers(): number;
};

export class CaelusWasmEngine {
  private exports: CaelusExports | null = null;

  async init(): Promise<void> {
    if (this.exports) return;
    const response = await fetch("/caelus_wasm.wasm", { cache: "force-cache" });
    if (!response.ok) throw new Error("Yerel CAELUS çekirdeği yüklenemedi.");
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    this.exports = instance.exports as CaelusExports;
  }

  get ready(): boolean {
    return this.exports !== null;
  }

  private memory(): Uint8Array {
    if (!this.exports) throw new Error("CAELUS çekirdeği hazır değil.");
    return new Uint8Array(this.exports.memory.buffer);
  }

  private write(value: string): number {
    if (!this.exports) throw new Error("CAELUS çekirdeği hazır değil.");
    const bytes = new TextEncoder().encode(value);
    const length = Math.min(bytes.length, this.exports.cae_buf_cap());
    this.memory().set(bytes.subarray(0, length), this.exports.cae_buf());
    return length;
  }

  private read(length: number): string {
    if (!this.exports) throw new Error("CAELUS çekirdeği hazır değil.");
    const pointer = this.exports.cae_buf();
    return new TextDecoder().decode(this.memory().slice(pointer, pointer + length));
  }

  load(pack: unknown): EngineSnapshot {
    if (!this.exports) throw new Error("CAELUS çekirdeği hazır değil.");
    const result = this.exports.cae_load(this.write(JSON.stringify(pack)));
    if (result !== 0) throw new Error("Kanıt paketi yerel çekirdek doğrulamasından geçemedi.");
    return this.snapshot();
  }

  tick(count = 1): EngineSnapshot {
    if (!this.exports) throw new Error("CAELUS çekirdeği hazır değil.");
    this.exports.cae_tick(Math.max(1, Math.min(10_000, Math.floor(count))));
    return this.snapshot();
  }

  snapshot(): EngineSnapshot {
    if (!this.exports) throw new Error("CAELUS çekirdeği hazır değil.");
    return JSON.parse(this.read(this.exports.cae_snapshot())) as EngineSnapshot;
  }

  levers(): EngineLever[] {
    if (!this.exports) throw new Error("CAELUS çekirdeği hazır değil.");
    const payload = JSON.parse(this.read(this.exports.cae_levers())) as { levers?: EngineLever[] } | EngineLever[];
    return Array.isArray(payload) ? payload : (payload.levers ?? []);
  }

  applyLever(id: string): { accepted: boolean; snapshot: EngineSnapshot } {
    if (!this.exports) throw new Error("CAELUS çekirdeği hazır değil.");
    const accepted = this.exports.cae_lever(this.write(id)) === 1;
    return { accepted, snapshot: this.snapshot() };
  }
}
