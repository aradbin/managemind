import { connect, testUrls } from '@managemind/db/testing';

export { TENANT_A, TENANT_B } from '@managemind/db/testing';
export const { ownerUrl, appUrl } = testUrls('managemind_test_core');
export const connectApp = () => connect(appUrl);
export const connectOwner = () => connect(ownerUrl);
