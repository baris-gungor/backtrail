export const ASSET_CREATED = 'asset.created';

export class AssetCreatedEvent {
  constructor(
    readonly assetId: string,
    readonly symbol: string,
  ) {}
}
