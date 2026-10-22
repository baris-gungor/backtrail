import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

const toSnakeCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

/**
 * Maps camelCase entity properties to snake_case table and column names.
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(className: string, customName?: string): string {
    return customName ?? toSnakeCase(className);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    prefixes: string[],
  ): string {
    return toSnakeCase(prefixes.concat(customName ?? propertyName).join('_'));
  }

  override relationName(propertyName: string): string {
    return toSnakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return toSnakeCase(`${relationName}_${referencedColumnName}`);
  }

  override joinTableName(firstTableName: string, secondTableName: string): string {
    return toSnakeCase(`${firstTableName}_${secondTableName}`);
  }

  override joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return toSnakeCase(`${tableName}_${columnName ?? propertyName}`);
  }
}
