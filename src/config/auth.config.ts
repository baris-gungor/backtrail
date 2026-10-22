import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  username: string;
  password: string;
  /** Both values are set. Without them the API is open (a warning is logged at startup). */
  enabled: boolean;
}

export const authConfig = registerAs('auth', (): AuthConfig => {
  const username = process.env.AUTH_USERNAME ?? '';
  const password = process.env.AUTH_PASSWORD ?? '';
  return { username, password, enabled: username !== '' && password !== '' };
});
