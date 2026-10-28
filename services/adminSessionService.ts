/** One in-memory administrative identity, shared by both API services. No credentials are persisted. */
export type AdminSession =
  | { kind: 'root'; token: string }
  | { kind: 'subadmin'; id: string; token: string }
  | { kind: 'legacyRoot'; password: string };

let session: AdminSession | null = null;

export function clearAdminSession(): void { session = null; }
export function setRootAdminSession(token: string): void {
  if (!token) throw new Error('O servidor não retornou uma sessão administrativa.');
  session = { kind: 'root', token };
}
export function setAdminPassword(password: string): void {
  session = password ? { kind: 'legacyRoot', password } : null;
}
export function getAdminPassword(): string {
  return session?.kind === 'legacyRoot' ? session.password : '';
}
export function setSubAdminCredentials(id: string, token: string): void {
  if (!id || !token) throw new Error('Sessão do sub-admin incompleta. Faça login novamente.');
  session = { kind: 'subadmin', id, token };
}
export function clearSubAdminCredentials(): void {
  if (session?.kind === 'subadmin') session = null;
}
export function isSubAdminSession(): boolean { return session?.kind === 'subadmin'; }
export function getAdminAuthPayload(): Record<string, string> {
  if (!session) throw new Error('Sessão administrativa ausente. Faça login novamente.');
  if (session.kind === 'subadmin') return { adminId: session.id, sessionToken: session.token };
  if (session.kind === 'root') return { rootSessionToken: session.token };
  return { adminPassword: session.password };
}
