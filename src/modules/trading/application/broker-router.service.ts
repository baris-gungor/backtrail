import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundError } from '../../../common/errors/domain.error';
import { BROKER, type BrokerPort } from '../domain/broker.port';
import { AlpacaBroker } from '../infrastructure/alpaca-broker';
import { PortfolioEntity, type PortfolioMode } from '../infrastructure/portfolio.entity';

/** Picks the broker of a portfolio: simulated fills (`paper`) or the Alpaca demo account. */
@Injectable()
export class BrokerRouter {
  constructor(
    @InjectRepository(PortfolioEntity) private readonly portfolios: Repository<PortfolioEntity>,
    @Inject(BROKER) private readonly paper: BrokerPort,
    private readonly alpaca: AlpacaBroker,
  ) {}

  forMode(mode: PortfolioMode): BrokerPort {
    return mode === 'alpaca_paper' ? this.alpaca : this.paper;
  }

  async forPortfolio(portfolioId: string): Promise<BrokerPort> {
    const portfolio = await this.portfolios.findOneBy({ id: portfolioId });
    if (!portfolio) throw new NotFoundError(`Portfolio ${portfolioId} not found`);
    return this.forMode(portfolio.mode);
  }

  /** Every broker, for work that spans all portfolios (bar processing, waiting until idle). */
  all(): BrokerPort[] {
    return [this.paper, this.alpaca];
  }
}
