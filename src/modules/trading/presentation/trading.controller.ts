import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TradingControlService } from '../application/trading-control.service';
import { AlpacaBroker } from '../infrastructure/alpaca-broker';
import { BrokerStatusDto, HaltDto, TradingStateDto } from './portfolios.dto';

@ApiTags('trading')
@Controller()
export class TradingController {
  constructor(
    private readonly control: TradingControlService,
    private readonly alpaca: AlpacaBroker,
  ) {}

  /** Kill switch state and portfolios halted on their own. */
  @Get('trading/state')
  state(): Promise<TradingStateDto> {
    return this.control.state();
  }

  /**
   * Kill switch: stops automatic orders in every portfolio and rejects manual BUYs. Optionally
   * closes all positions. SELLs and closing positions stay possible.
   */
  @Post('trading/halt')
  @HttpCode(HttpStatus.OK)
  halt(@Body() dto: HaltDto): Promise<TradingStateDto> {
    return this.control.halt(dto.reason, dto.closePositions ?? false);
  }

  @Post('trading/resume')
  @HttpCode(HttpStatus.OK)
  resume(): Promise<TradingStateDto> {
    return this.control.resume();
  }

  /** Alpaca demo (paper) connection. Live trading is not supported. */
  @Get('brokers/status')
  brokerStatus(): Promise<BrokerStatusDto> {
    return this.alpaca.status();
  }
}
