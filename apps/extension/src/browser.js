// Chrome and Firefox both expose a promise-based extension API; Firefox as
// `browser`, Chrome (MV3) as `chrome`. Normalise to one handle.
export const ext =
  (typeof globalThis.browser !== 'undefined' && globalThis.browser) ||
  globalThis.chrome;

export async function getToken() {
  const { token } = await ext.storage.local.get('token');
  return token || null;
}

export async function setToken(token) {
  await ext.storage.local.set({ token });
}

export async function clearToken() {
  await ext.storage.local.remove('token');
}
