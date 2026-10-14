import { getApp, type Credential } from 'firebase-admin/app';
import { OAuth2Client } from 'google-auth-library';

interface TokenIdentity { sub?: string; user_id?: string; email?: string; expiry_date: number }
interface Dependencies {
  getCredential?: () => Pick<Credential, 'getAccessToken'> | undefined;
  getTokenInfo?: (token: string) => Promise<TokenIdentity>;
  now?: () => number;
}
// Google verifies the token issued to this server's credential. No request or
// tool argument chooses a Firebase human identity for the machine integration.
export const createGooglePrincipalResolver = ({ getCredential = () => getApp().options.credential,
  getTokenInfo = token => new OAuth2Client().getTokenInfo(token), now = Date.now }: Dependencies = {}) => async () => {
  try {
    const credential = getCredential();
    if (!credential) throw Error('missing credential');
    const token = await credential.getAccessToken();
    if (!token || typeof token.access_token !== 'string' || !token.access_token) throw Error('missing token');
    const info = await getTokenInfo(token.access_token);
    const subject = info.sub || info.user_id;
    if (typeof subject !== 'string' || !subject || subject.length > 256 || /[\x00-\x20]/.test(subject)
      || !Number.isFinite(info.expiry_date) || info.expiry_date <= now()) throw Error('unidentifiable token');
    return { id: `google:${subject}`, ...(typeof info.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email) ? { email: info.email.toLowerCase() } : {}) };
  } catch {
    // Do not echo provider errors that may contain credential/token material.
    throw Error('mcp_principal_unavailable');
  }
};
export const resolveGooglePrincipal = createGooglePrincipalResolver();
