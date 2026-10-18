// Explicit confirmations for the known synthetic records in existing workflows.
export async function closeStatementInBrowser(page) {
  await page.getByRole('button', { name: 'Monatsabrechnung abschließen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.check();
  await dialog.getByRole('button', { name: 'Verbindlich abschließen', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
