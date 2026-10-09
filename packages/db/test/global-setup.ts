import { prepareTestDatabase } from '../src/testing';

export default async function setup(): Promise<void> {
  await prepareTestDatabase('managemind_test');
}
