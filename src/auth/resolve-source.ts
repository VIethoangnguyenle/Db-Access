import { AppConfig, Source } from "../config/schema.js";
import { getConfig } from "../config/loader.js";

export type SourceIndex = Map<string, Source>;

export function buildSourceIndex(config: AppConfig): SourceIndex {
  const idx: SourceIndex = new Map();
  for (const source of Object.values(config.sources)) {
    if (idx.has(source.apiKey)) {
      throw new Error(`Duplicate apiKey detected for source '${source.name}'`);
    }
    idx.set(source.apiKey, source);
  }
  return idx;
}

export function resolveSourceFrom(idx: SourceIndex, apiKey: string | undefined): Source | undefined {
  if (!apiKey) return undefined;
  return idx.get(apiKey);
}

let _index: SourceIndex | undefined;

export function initSourceIndex(): SourceIndex {
  _index = buildSourceIndex(getConfig());
  return _index;
}

export function resolveSource(apiKey: string | undefined): Source | undefined {
  if (!_index) throw new Error("Source index not initialized — call initSourceIndex() first");
  return resolveSourceFrom(_index, apiKey);
}
