import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain.error';
import { ASSET_CREATED, AssetCreatedEvent } from '../domain/asset.events';
import { AssetClass } from '../domain/asset.types';
import { COMMODITY_PROXIES, futuresForEtf } from '../domain/commodity-proxies';
import {
  SYMBOL_RESOLVER,
  type SymbolResolver,
  type SymbolSuggestion,
} from '../domain/symbol-resolver.port';
import { AssetEntity } from '../infrastructure/asset.entity';

export interface AssetFilter {
  isActive?: boolean;
}

export interface AssetUpdate {
  isActive?: boolean;
  /** Futures symbol this asset stands in for; null removes the link. */
  proxyFor?: string | null;
}

/**
 * Public API of the assets module. Other modules use this service, never the repository.
 */
@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(AssetEntity) private readonly assets: Repository<AssetEntity>,
    @Inject(SYMBOL_RESOLVER) private readonly resolver: SymbolResolver,
    private readonly events: EventEmitter2,
  ) {}

  async create(rawSymbol: string): Promise<AssetEntity> {
    const symbol = rawSymbol.trim().toUpperCase();
    if (await this.assets.existsBy({ symbol })) {
      throw new ConflictError(`Asset ${symbol} already exists`);
    }

    const metadata = await this.resolver.resolve(symbol);
    if (!metadata) {
      throw new InvalidInputError(`Symbol ${symbol} was not found at the data provider`);
    }

    const asset = await this.assets.save(this.assets.create({ ...metadata, isActive: true }));
    await this.linkKnownProxy(asset);
    this.events.emit(ASSET_CREATED, new AssetCreatedEvent(asset.id, asset.symbol));
    return asset;
  }

  /** Provider search for the add-asset box; each hit says whether it is already tracked. */
  async search(query: string, limit = 10): Promise<(SymbolSuggestion & { tracked: boolean })[]> {
    const hits = await this.resolver.search(query.trim(), limit);
    if (!hits.length) return [];
    const tracked = new Set(
      (await this.assets.find({ select: { symbol: true } })).map((a) => a.symbol),
    );
    return hits.map((hit) => ({ ...hit, tracked: tracked.has(hit.symbol.toUpperCase()) }));
  }

  findAll(filter: AssetFilter = {}): Promise<AssetEntity[]> {
    // TypeORM 1.x rejects undefined values in `where`, so add filters only when set.
    const where: FindOptionsWhere<AssetEntity> = {};
    if (filter.isActive !== undefined) where.isActive = filter.isActive;
    return this.assets.find({ where, order: { symbol: 'ASC' } });
  }

  async findById(id: string): Promise<AssetEntity> {
    const asset = await this.assets.findOneBy({ id });
    if (!asset) throw new NotFoundError(`Asset ${id} not found`);
    return asset;
  }

  async findBySymbol(symbol: string): Promise<AssetEntity> {
    const normalized = symbol.trim().toUpperCase();
    const asset = await this.assets.findOneBy({ symbol: normalized });
    if (!asset) throw new NotFoundError(`Asset ${normalized} not found`);
    return asset;
  }

  async update(id: string, change: AssetUpdate): Promise<AssetEntity> {
    const asset = await this.findById(id);
    if (change.isActive !== undefined) asset.isActive = change.isActive;
    if (change.proxyFor !== undefined) {
      asset.proxyForId = change.proxyFor
        ? (await this.proxyTarget(asset, change.proxyFor)).id
        : null;
    }
    return this.assets.save(asset);
  }

  /** Links a newly registered asset with its known ETF or futures counterpart, if registered. */
  private async linkKnownProxy(asset: AssetEntity): Promise<void> {
    const futures = futuresForEtf(asset.symbol);
    if (futures) {
      const target = await this.assets.findOneBy({ symbol: futures });
      if (target) await this.assets.update({ id: asset.id }, { proxyForId: target.id });
      asset.proxyForId = target?.id ?? null;
    }
    const etf = COMMODITY_PROXIES[asset.symbol]?.etf;
    if (etf)
      await this.assets.update({ symbol: etf, proxyForId: IsNull() }, { proxyForId: asset.id });
  }

  private async proxyTarget(asset: AssetEntity, symbol: string): Promise<AssetEntity> {
    const target = await this.findBySymbol(symbol);
    if (target.id === asset.id) throw new InvalidInputError('An asset cannot be its own proxy');
    if (target.assetClass !== AssetClass.Future) {
      throw new InvalidInputError(`${target.symbol} is not a futures asset`);
    }
    return target;
  }

  async markSynced(id: string, at: Date): Promise<void> {
    await this.assets.update({ id }, { lastSyncedAt: at });
  }

  async remove(id: string): Promise<void> {
    const result = await this.assets.delete({ id });
    if (!result.affected) throw new NotFoundError(`Asset ${id} not found`);
  }
}
