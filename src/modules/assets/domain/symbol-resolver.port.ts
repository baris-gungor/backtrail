import { AssetClass, SymbolMetadata } from './asset.types';

export const SYMBOL_RESOLVER = Symbol('SYMBOL_RESOLVER');

/**
 * Looks up a symbol at the data provider and returns its metadata.
 * Returns null when the provider does not know the symbol.
 * Throws InvalidInputError when the symbol exists but is not supported.
 */
export interface SymbolResolver {
  resolve(symbol: string): Promise<SymbolMetadata | null>;
  /** Symbols matching a name or ticker fragment, limited to what the app can track. */
  search(query: string, limit: number): Promise<SymbolSuggestion[]>;
}

/** One search hit; `resolve()` later decides whether the symbol can really be tracked. */
export interface SymbolSuggestion {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string | null;
}
