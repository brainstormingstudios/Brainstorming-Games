/** Before the suite: set aside whatever is in the local database (accounts, uploaded games). */
export default async function globalSetup(): Promise<void> {
  await fetch('http://localhost:4100/__mock/db/stash', { method: 'POST' }).catch(() => {});
}
