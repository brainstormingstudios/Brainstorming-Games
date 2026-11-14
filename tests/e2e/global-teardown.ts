/** After the suite: put the local database back exactly as it was. */
export default async function globalTeardown(): Promise<void> {
  await fetch('http://localhost:4100/__mock/db/restore', { method: 'POST' }).catch(() => {});
}
