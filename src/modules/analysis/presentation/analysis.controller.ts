import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotFoundError } from '../../../common/errors/domain.error';
import { AnalysisQueryService } from '../application/analysis-query.service';
import { SignalGenerationService } from '../application/signal-generation.service';
import { StrategyCatalogService } from '../application/strategy-catalog.service';
import { StrategyConfigEntity } from '../infrastructure/strategy-config.entity';
import {
  AssetSummaryDto,
  CreateStrategyConfigDto,
  GenerationResultDto,
  IndicatorSeriesDto,
  IndicatorsQuery,
  ListSignalsQuery,
  RebuildSignalsDto,
  SignalDto,
  StrategyDto,
  UpdateStrategyConfigDto,
} from './analysis.dto';

@ApiTags('analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly catalog: StrategyCatalogService,
    private readonly generation: SignalGenerationService,
    private readonly query: AnalysisQueryService,
  ) {}

  /** Strategies with their parameter schema and configs. */
  @Get('strategies')
  listStrategies(): Promise<StrategyDto[]> {
    return this.catalog.list() as Promise<StrategyDto[]>;
  }

  /** Adds a named parameter set for a strategy. Signals for it are generated on the next sync or rebuild. */
  @Post('strategies/:code/configs')
  createConfig(
    @Param('code') code: string,
    @Body() dto: CreateStrategyConfigDto,
  ): Promise<StrategyConfigEntity> {
    return this.catalog.createConfig(code, dto.name, dto.params);
  }

  @Patch('configs/:id')
  updateConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStrategyConfigDto,
  ): Promise<StrategyConfigEntity> {
    return this.catalog.updateConfig(id, dto);
  }

  /** Signal history, newest first. */
  @Get('signals')
  listSignals(@Query() q: ListSignalsQuery): Promise<SignalDto[]> {
    return this.query.listSignals(q);
  }

  /** Deletes and regenerates signals. Use after changing configs or strategy code. */
  @Post('signals/rebuild')
  @HttpCode(HttpStatus.OK)
  rebuild(@Body() dto: RebuildSignalsDto): Promise<GenerationResultDto[]> {
    return this.generation.rebuild(dto);
  }

  /** Standard indicator set on closed 4h bars, for charts. */
  @Get('assets/:symbol/indicators')
  indicators(
    @Param('symbol') symbol: string,
    @Query() q: IndicatorsQuery,
  ): Promise<IndicatorSeriesDto> {
    return this.query.indicators(symbol, q.limit);
  }

  /** Trend, momentum and volatility of the latest closed 4h bar, plus every strategy's current position. */
  @Get('assets/:symbol/summary')
  async summary(@Param('symbol') symbol: string): Promise<AssetSummaryDto> {
    const summary = await this.query.summary(symbol);
    if (!summary) throw new NotFoundError(`No closed bars for ${symbol} yet`);
    return summary;
  }
}
