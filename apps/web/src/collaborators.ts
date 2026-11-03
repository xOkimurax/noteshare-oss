/**
 * Collaboration helpers. These used to talk straight to Firestore; now they
 * go through the REST API. The old `sharedMemoIds` denormalised index is
 * gone — the backend resolves "shared with me" with a plain join.
 */
import { api } from './api';

export async function checkUserExistsByEmail(email: string): Promise<boolean> {
  const { exists } = await api.lookupUser(email.trim().toLowerCase());
  return exists;
}

export async function getUserByEmail(
  email: string,
): Promise<{ id: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  const { exists, id } = await api.lookupUser(normalized);
  return exists && id ? { id, email: normalized } : null;
}
