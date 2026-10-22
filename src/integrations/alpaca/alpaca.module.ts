import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { alpacaConfig } from '../../config';
import { ALPACA_CLIENT, type AlpacaClient } from './alpaca-client.port';
import { AlpacaHttpClient } from './alpaca-http.client';

/** Shared Alpaca client (paper environment only, see `alpacaConfig`). */
@Module({
  providers: [
    {
      provide: ALPACA_CLIENT,
      inject: [alpacaConfig.KEY],
      useFactory: (config: ConfigType<typeof alpacaConfig>): AlpacaClient =>
        new AlpacaHttpClient(config),
    },
  ],
  exports: [ALPACA_CLIENT],
})
export class AlpacaModule implements OnApplicationShutdown {
  constructor(@Inject(ALPACA_CLIENT) private readonly client: AlpacaClient) {}

  onApplicationShutdown(): void {
    if (this.client instanceof AlpacaHttpClient) this.client.close();
  }
}
