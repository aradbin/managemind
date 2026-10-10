function url(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value.replace(/\/$/, '');
}

export const API = url('API_URL');
export const STOREFRONT = url('STOREFRONT_URL');
export const ENVIRONMENT = process.env.EXPECT_ENVIRONMENT ?? 'preview';
