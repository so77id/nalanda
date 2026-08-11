/**
 * react-router's basename from Vite's BASE_URL. Vite always ends BASE_URL with
 * a slash ('/' in dev, '/nalanda/' on Pages); react-router wants no trailing
 * slash, and an empty string at the domain root.
 */
export function routerBasename(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}
