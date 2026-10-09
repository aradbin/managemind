import { prepareTestDatabase } from '@managemind/db/testing';
import { DATABASE } from './support';

export default async function setup(): Promise<void> {
  await prepareTestDatabase(DATABASE);
}
