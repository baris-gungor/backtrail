import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain.error';
import { AuditService } from '../../audit/application/audit.service';
import { findStrategy, STRATEGIES } from '../domain/strategies';
import type { StrategyDefinition, StrategyParams } from '../domain/strategy';
import { SignalEntity } from '../infrastructure/signal.entity';
import { StrategyConfigEntity } from '../infrastructure/strategy-config.entity';
import { StrategyEntity } from '../infrastructure/strategy.entity';

export const DEFAULT_CONFIG_NAME = 'default';

export interface RuntimeConfig {
  config: StrategyConfigEntity;
  strategy: StrategyDefinition;
}

export interface StrategyView {
  code: string;
  name: string;
  version: number;
  description: string;
  isBenchmark: boolean;
  /** Has short rules. */
  canShort: boolean;
  defaultParams: Record<string, unknown>;
  paramsSchema: unknown;
  configs: StrategyConfigEntity[];
}

/**
 * Keeps the `strategies` table in sync with the code registry and manages parameter sets.
 * Runs in onModuleInit, before any bootstrap-time sync can trigger signal generation.
 */
@Injectable()
export class StrategyCatalogService implements OnModuleInit {
  private readonly logger = new Logger(StrategyCatalogService.name);

  constructor(
    @InjectRepository(StrategyEntity) private readonly strategies: Repository<StrategyEntity>,
    @InjectRepository(StrategyConfigEntity)
    private readonly configs: Repository<StrategyConfigEntity>,
    @InjectRepository(SignalEntity) private readonly signals: Repository<SignalEntity>,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const def of STRATEGIES) {
      const fields = {
        code: def.code,
        name: def.name,
        version: def.version,
        description: def.description,
        isBenchmark: def.isBenchmark,
        defaultParams: def.defaultParams,
      };
      const existing = await this.strategies.findOneBy({ code: def.code });
      const row = await this.strategies.save(
        // Object.assign (not merge) so jsonb params are replaced, not deep-merged.
        existing ? Object.assign(existing, fields) : this.strategies.create(fields),
      );
      await this.reconcileConfigs(row, def);
    }
  }

  /** Creates the default config and re-validates stored params against the current schema. */
  private async reconcileConfigs(row: StrategyEntity, def: StrategyDefinition): Promise<void> {
    const existing = await this.configs.findBy({ strategyId: row.id });
    if (!existing.some((c) => c.name === DEFAULT_CONFIG_NAME)) {
      await this.configs.save(
        this.configs.create({
          strategyId: row.id,
          name: DEFAULT_CONFIG_NAME,
          params: def.defaultParams,
          isActive: !def.isBenchmark,
        }),
      );
    }
    for (const config of existing) {
      try {
        config.params = def.validateParams(config.params);
        await this.configs.save(config);
      } catch (error) {
        this.logger.warn({
          msg: `Config ${def.code}/${config.name} is invalid for v${def.version}, deactivated`,
          reason: error instanceof Error ? error.message : String(error),
        });
        await this.configs.update({ id: config.id }, { isActive: false });
      }
    }
  }

  async list(): Promise<StrategyView[]> {
    const rows = await this.strategies.find({
      relations: { configs: true },
      order: { code: 'ASC', configs: { name: 'ASC' } },
    });
    return rows.map((row) => {
      const def = findStrategy(row.code);
      const { configs = [], ...rest } = row;
      return {
        code: rest.code,
        name: rest.name,
        version: rest.version,
        description: rest.description,
        isBenchmark: rest.isBenchmark,
        canShort: def?.canShort ?? false,
        defaultParams: rest.defaultParams,
        paramsSchema: def?.describeParams() ?? null,
        configs,
      };
    });
  }

  /** Active configs whose strategy exists in code. */
  async activeConfigs(): Promise<RuntimeConfig[]> {
    const rows = await this.configs.find({
      where: { isActive: true },
      relations: { strategy: true },
    });
    const result: RuntimeConfig[] = [];
    for (const config of rows) {
      const strategy = config.strategy && findStrategy(config.strategy.code);
      if (strategy) result.push({ config, strategy });
    }
    return result;
  }

  /** A stored config by id, active or not. */
  async configById(id: string): Promise<RuntimeConfig> {
    const config = await this.configs.findOne({ where: { id }, relations: { strategy: true } });
    const strategy = config?.strategy && findStrategy(config.strategy.code);
    if (!config || !strategy) throw new NotFoundError(`Strategy config ${id} not found`);
    return { config, strategy };
  }

  /** A stored config by strategy code and config name, active or not. */
  async findConfig(code: string, name: string): Promise<RuntimeConfig> {
    const strategy = this.definition(code);
    const config = await this.configs.findOne({
      where: { name, strategy: { code } },
      relations: { strategy: true },
    });
    if (!config) throw new NotFoundError(`Strategy config ${code}/${name} not found`);
    return { config, strategy };
  }

  async createConfig(code: string, name: string, params: unknown): Promise<StrategyConfigEntity> {
    const def = this.definition(code);
    const row = await this.strategies.findOneByOrFail({ code });
    if (await this.configs.existsBy({ strategyId: row.id, name })) {
      throw new ConflictError(`Config ${code}/${name} already exists`);
    }
    const saved = await this.configs.save(
      this.configs.create({
        strategyId: row.id,
        name,
        params: def.validateParams(params),
        isActive: true,
      }),
    );
    await this.audit.record({
      action: 'strategy_config.create',
      entityType: 'strategy_config',
      entityId: saved.id,
      after: { code, name, params: saved.params, isActive: true },
    });
    return saved;
  }

  async updateConfig(
    id: string,
    changes: { isActive?: boolean; params?: StrategyParams },
  ): Promise<StrategyConfigEntity> {
    const config = await this.configs.findOne({ where: { id }, relations: { strategy: true } });
    if (!config) throw new NotFoundError(`Strategy config ${id} not found`);
    const before = { params: config.params, isActive: config.isActive };
    if (changes.params !== undefined) {
      if (config.name === DEFAULT_CONFIG_NAME) {
        throw new InvalidInputError(
          'The default config params follow the code; create a new config instead',
        );
      }
      config.params = this.definition(config.strategy!.code).validateParams(changes.params);
    }
    if (changes.isActive !== undefined) config.isActive = changes.isActive;
    const saved = await this.configs.save(config);
    if (changes.params !== undefined) {
      // Stored signals were produced with the old params; they are regenerated on the next sync or rebuild.
      await this.signals.delete({ strategyConfigId: id });
    }
    await this.audit.record({
      action: 'strategy_config.update',
      entityType: 'strategy_config',
      entityId: id,
      before,
      after: { params: saved.params, isActive: saved.isActive },
    });
    return saved;
  }

  definition(code: string): StrategyDefinition {
    const def = findStrategy(code);
    if (!def) throw new NotFoundError(`Strategy ${code} not found`);
    return def;
  }
}
