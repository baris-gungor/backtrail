# Domain modules

Each business capability lives in its own folder here (`assets`, `market-data`, `analysis`, `signals`, `backtesting`, `trading`, `reporting`, `audit`, `notifications`). `audit` and `notifications` are leaf modules: they import no other module, and any module may import their `AuditService` / `NotificationService`.

## Layout

```
<module>/
  domain/          # Pure TypeScript: entities, value objects, domain services, ports (interfaces). No Nest or TypeORM imports.
  application/     # Use cases. Depend on domain ports, own the transaction boundary.
  infrastructure/  # TypeORM entities and repositories, external API adapters, scheduled jobs.
  presentation/    # REST controllers and DTOs (class-validator).
  <module>.module.ts
```

Dependency direction: `presentation -> application -> domain <- infrastructure`.

## Rules

- A module never imports another module's entities, repositories or infrastructure.
  Exception: an entity may declare a `@ManyToOne` to another module's entity only to get a foreign key. Never query through that relation.
- Cross-module calls go through services the other module exports, or through domain events.
  Exception: `reporting/infrastructure/report.queries.ts` reads other modules' tables with read-only SQL, for report performance. Reporting never writes, and no other module may do this.
- Bind ports to adapters in the module file, for example `{ provide: MARKET_DATA_PROVIDER, useClass: YahooMarketDataProvider }`.
- Shared external clients live in `src/integrations/`. Adapters that implement a module's port live in that module's `infrastructure/`.
- Application code throws `DomainError` subclasses (`src/common/errors`), not HTTP exceptions.
- Schema changes go through migrations only (`npm run migration:generate -- src/database/migrations/<Name>`). `synchronize` stays off.
- Money and prices use `numeric` columns and decimal arithmetic, never `float`.
- Unit tests sit next to the code as `*.spec.ts`. Domain logic must be testable without a database.
