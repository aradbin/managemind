import { prepareTestDatabase } from '@managemind/db/testing';

export default async function setup(): Promise<void> {
  await prepareTestDatabase('managemind_test_core');
}
