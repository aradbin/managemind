// One object per store and phone (phase-5a-plan §3.14): the code's hash and
// a verified token's hash, in the object's own storage.
import { DurableObject } from 'cloudflare:workers';
import { OtpState, type VerifyResult } from './state';

export class OtpCodes extends DurableObject {
  private readonly state = new OtpState({
    get: () => this.ctx.storage.get('otp'),
    put: (value) => this.ctx.storage.put('otp', value),
  });

  issue(): Promise<string> {
    return this.state.issue();
  }

  verify(code: string): Promise<VerifyResult> {
    return this.state.verify(code);
  }

  check(token: string): Promise<boolean> {
    return this.state.check(token);
  }
}
