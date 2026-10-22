import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AssetsService } from '../application/assets.service';
import { AssetEntity } from '../infrastructure/asset.entity';
import { COMMODITY_PROXIES } from '../domain/commodity-proxies';
import {
  AssetSuggestionDto,
  CommodityProxyDto,
  CreateAssetDto,
  ListAssetsQuery,
  SearchAssetsQuery,
  UpdateAssetDto,
} from './assets.dto';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /** Registers a symbol for tracking. Historical data backfill starts in the background. */
  @Post()
  create(@Body() dto: CreateAssetDto): Promise<AssetEntity> {
    return this.assets.create(dto.symbol);
  }

  @Get()
  findAll(@Query() query: ListAssetsQuery): Promise<AssetEntity[]> {
    return this.assets.findAll(query);
  }

  /**
   * Searches the data provider by name or ticker. Only symbols the app can track are returned
   * (US-listed equities and ETFs, US indexes, futures); `tracked` marks the ones already added.
   */
  @Get('search')
  search(@Query() query: SearchAssetsQuery): Promise<AssetSuggestionDto[]> {
    return this.assets.search(query.q);
  }

  /** Known commodity ETF proxies: futures symbol → ETF symbol and name. */
  @Get('commodity-proxies')
  commodityProxies(): CommodityProxyDto[] {
    return Object.entries(COMMODITY_PROXIES).map(([futures, p]) => ({ futures, ...p }));
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AssetEntity> {
    return this.assets.findById(id);
  }

  /** Turns tracking on or off, and sets or removes the futures link of an ETF proxy. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
  ): Promise<AssetEntity> {
    return this.assets.update(id, dto);
  }

  /** Deletes the asset and all of its price data. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.assets.remove(id);
  }
}
