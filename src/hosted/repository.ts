import { Pool } from "pg";
import {randomInt,timingSafeEqual} from 'node:crypto';
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AccountCredentials, AccountMetadata, AccountStore } from "../types.js";
import { decryptSecret, encryptSecret, hashPassword, hashToken, opaqueToken, verifyPassword, createId } from "./crypto.js";

export interface HostedUser { id: string; email: string; passwordHash: string; }
export interface HostedAuthorization { id: string; userId: string; clientId: string; redirectUri: string; codeChallenge: string; resource: string; scopes: string[]; state?: string; }

export class HostedRepository {
  constructor(readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id text PRIMARY KEY,
        client_data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        email_verified boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
      CREATE TABLE IF NOT EXISTS setup_challenges (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        code_hash text NOT NULL,
        binding_hash text NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS setup_challenges_email_created ON setup_challenges(email,created_at);
      CREATE TABLE IF NOT EXISTS cpanel_accounts (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label text NOT NULL,
        host text NOT NULL,
        username text NOT NULL,
        kind text NOT NULL DEFAULT 'cpanel' CHECK (kind IN ('cpanel','whm')),
        auth_type text NOT NULL DEFAULT 'token' CHECK (auth_type IN ('token','password')),
        token_name text,
        encrypted_credentials text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, label)
      );
      ALTER TABLE cpanel_accounts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cpanel';
      ALTER TABLE cpanel_accounts ADD COLUMN IF NOT EXISTS auth_type text NOT NULL DEFAULT 'token';
      CREATE INDEX IF NOT EXISTS cpanel_accounts_user_id_idx ON cpanel_accounts(user_id);
      CREATE TABLE IF NOT EXISTS web_sessions (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token text NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS oauth_transactions (
        id text PRIMARY KEY,
        client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        transaction_data jsonb NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code_hash text PRIMARY KEY,
        client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        redirect_uri text NOT NULL,
        code_challenge text NOT NULL,
        resource text NOT NULL,
        scopes text[] NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash text PRIMARY KEY,
        client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_type text NOT NULL CHECK (token_type IN ('access', 'refresh')),
        resource text NOT NULL,
        scopes text[] NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS oauth_tokens_user_id_idx ON oauth_tokens(user_id);
      CREATE TABLE IF NOT EXISTS email_verifications (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL
      );
    `);
  }

  async adminConfigured():Promise<boolean> {
    return Boolean((await this.pool.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1")).rows.length);
  }

  async requestAdminSetup(email:string,binding:string):Promise<{id:string;code:string}> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('parmtech-first-admin'))");
      if((await client.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1")).rows.length)throw Error('Initial setup is complete.');
      const recent=await client.query("SELECT COUNT(*) AS total FROM setup_challenges WHERE email=$1 AND created_at>now()-interval '15 minutes'",[email]);
      if(Number(recent.rows[0].total)>=3)throw Error('Wait fifteen minutes before requesting another setup code.');
      const id=createId(),code=String(randomInt(100000000)).padStart(8,'0');
      await client.query("INSERT INTO setup_challenges(id,email,code_hash,binding_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes')",[id,email,hashToken(code),hashToken(binding)]);
      await client.query('COMMIT');return {id,code};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }

  async finishAdminSetup(id:string,code:string,binding:string,password:string):Promise<HostedUser|null> {
    if(password.length<12||password.length>256)throw Error('Password must contain12–256 characters.');
    const passwordHash=await hashPassword(password);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('parmtech-first-admin'))");
      if((await client.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1")).rows.length){await client.query('COMMIT');return null;}
      const found=await client.query("SELECT * FROM setup_challenges WHERE id=$1 AND binding_hash=$2 AND consumed_at IS NULL AND expires_at>now() AND attempts<5 FOR UPDATE",[id,hashToken(binding)]);
      const challenge=found.rows[0];
      if(!challenge){await client.query('COMMIT');return null;}
      await client.query('UPDATE setup_challenges SET attempts=attempts+1 WHERE id=$1',[id]);
      if(!timingSafeEqual(Buffer.from(challenge.code_hash,'hex'),Buffer.from(hashToken(code),'hex'))){await client.query('COMMIT');return null;}
      const result=await client.query<HostedUser>(`INSERT INTO users(id,email,password_hash,email_verified,role) VALUES($1,$2,$3,true,'admin')
        ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,email_verified=true,role='admin'
        RETURNING id,email,password_hash AS "passwordHash"`,[createId(),challenge.email,passwordHash]);
      await client.query('UPDATE setup_challenges SET consumed_at=now() WHERE id=$1',[id]);
      await client.query('COMMIT');return result.rows[0]!;
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const { rows } = await this.pool.query<{ client_data: OAuthClientInformationFull }>("SELECT client_data FROM oauth_clients WHERE client_id=$1", [clientId]);
    return rows[0]?.client_data;
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    if (client.token_endpoint_auth_method !== "none" || client.client_secret) throw new InvalidClientMetadataError("PARMTECH accepts public OAuth clients using PKCE only.");
    await this.pool.query("INSERT INTO oauth_clients(client_id, client_data) VALUES($1,$2::jsonb) ON CONFLICT(client_id) DO NOTHING", [client.client_id, JSON.stringify(client)]);
    const saved = await this.getClient(client.client_id);
    if (!saved) throw new Error("OAuth client registration could not be saved.");
    return saved;
  }

  async createUser(email: string, password: string): Promise<HostedUser> {
    const id = createId();
    const passwordHash = await hashPassword(password);
    const normalizedEmail = email.trim().toLowerCase();
    const { rows } = await this.pool.query<HostedUser>("INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING id,email,password_hash AS \"passwordHash\"", [id, normalizedEmail, passwordHash]);
    return rows[0]!;
  }

  async authenticate(email: string, password: string): Promise<HostedUser | null> {
    const { rows } = await this.pool.query<HostedUser>("SELECT id,email,password_hash AS \"passwordHash\" FROM users WHERE email=$1", [email.trim().toLowerCase()]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
    return user;
  }

  async getUser(userId: string): Promise<HostedUser | null> {
    const { rows } = await this.pool.query<HostedUser>("SELECT id,email,password_hash AS \"passwordHash\" FROM users WHERE id=$1 AND email_verified=true", [userId]);
    return rows[0] ?? null;
  }

  async isEmailVerified(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ email_verified: boolean }>("SELECT email_verified FROM users WHERE id=$1", [userId]);
    return rows[0]?.email_verified ?? false;
  }

  async createVerification(userId: string): Promise<string> {
    const token = opaqueToken();
    await this.pool.query("INSERT INTO email_verifications(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')", [hashToken(token), userId]);
    return token;
  }

  async verifyEmail(token: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ user_id: string }>("DELETE FROM email_verifications WHERE token_hash=$1 AND expires_at>now() RETURNING user_id", [hashToken(token)]);
      if (!found.rows[0]) { await client.query("ROLLBACK"); return null; }
      const userId = found.rows[0].user_id;
      await client.query("UPDATE users SET email_verified=true WHERE id=$1", [userId]);
      await client.query("COMMIT");
      return userId;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async createSession(userId: string): Promise<{ cookie: string; csrf: string }> {
    const cookie = opaqueToken();
    const csrf = opaqueToken();
    await this.pool.query("INSERT INTO web_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '30 days')", [hashToken(cookie), userId, csrf]);
    return { cookie, csrf };
  }

  async getSession(cookie: string): Promise<{ userId: string; email: string; csrf: string } | null> {
    const { rows } = await this.pool.query<{ user_id: string; email: string; csrf_token: string }>(`SELECT s.user_id,u.email,s.csrf_token FROM web_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.email_verified=true`, [hashToken(cookie)]);
    const row = rows[0];
    return row ? { userId: row.user_id, email: row.email, csrf: row.csrf_token } : null;
  }

  async deleteSession(cookie: string): Promise<void> { await this.pool.query("DELETE FROM web_sessions WHERE token_hash=$1", [hashToken(cookie)]); }

  async listAccounts(userId: string): Promise<AccountMetadata[]> {
    const { rows } = await this.pool.query<{ id: string; label: string; host: string; username: string; token_name: string | null; created_at: Date; kind: "cpanel" | "whm"; auth_type: "token" | "password" }>("SELECT id,label,host,username,token_name,created_at,kind,auth_type FROM cpanel_accounts WHERE user_id=$1 ORDER BY created_at", [userId]);
    return rows.map((row) => ({ id: row.id, label: row.label, host: row.host, username: row.username, ...(row.token_name ? { tokenName: row.token_name } : {}), kind: row.kind, authType: row.auth_type, createdAt: row.created_at.toISOString() }));
  }

  async getAccount(userId: string, id: string): Promise<{ metadata: AccountMetadata; credentials: AccountCredentials }> {
    const { rows } = await this.pool.query<{ id: string; label: string; host: string; username: string; token_name: string | null; created_at: Date; encrypted_credentials: string; kind: "cpanel" | "whm"; auth_type: "token" | "password" }>("SELECT * FROM cpanel_accounts WHERE user_id=$1 AND id=$2", [userId, id]);
    const row = rows[0];
    if (!row) throw new Error("That cPanel account is not connected to your profile.");
    const metadata: AccountMetadata = { id: row.id, label: row.label, host: row.host, username: row.username, ...(row.token_name ? { tokenName: row.token_name } : {}), kind: row.kind, authType: row.auth_type, createdAt: row.created_at.toISOString() };
    return { metadata, credentials: JSON.parse(decryptSecret(row.encrypted_credentials, `account:${userId}:${id}`)) as AccountCredentials };
  }

  async addAccount(userId: string, input: { label: string; host: string; username: string; kind: "cpanel" | "whm"; authType: "token" | "password"; apiToken?: string; password?: string; tokenName?: string }): Promise<AccountMetadata> {
    const id = createId();
    const creds: AccountCredentials = { host: input.host, username: input.username, kind: input.kind, authType: input.authType, ...(input.apiToken ? { apiToken: input.apiToken } : {}), ...(input.password ? { password: input.password } : {}), ...(input.tokenName ? { tokenName: input.tokenName } : {}) };
    const encrypted = encryptSecret(JSON.stringify(creds), `account:${userId}:${id}`);
    const { rows } = await this.pool.query<{ id: string; label: string; host: string; username: string; token_name: string | null; created_at: Date }>("INSERT INTO cpanel_accounts(id,user_id,label,host,username,kind,auth_type,token_name,encrypted_credentials) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,label,host,username,token_name,created_at", [id, userId, input.label, input.host, input.username, input.kind, input.authType, input.tokenName ?? null, encrypted]);
    const row = rows[0]!;
    return { id: row.id, label: row.label, host: row.host, username: row.username, kind: input.kind, authType: input.authType, ...(row.token_name ? { tokenName: row.token_name } : {}), createdAt: row.created_at.toISOString() };
  }

  async removeAccount(userId: string, id: string): Promise<AccountMetadata> {
    const { rows } = await this.pool.query<{ id: string; label: string; host: string; username: string; token_name: string | null; created_at: Date; kind: "cpanel" | "whm"; auth_type: "token" | "password" }>("DELETE FROM cpanel_accounts WHERE user_id=$1 AND id=$2 RETURNING id,label,host,username,token_name,created_at,kind,auth_type", [userId, id]);
    const row = rows[0];
    if (!row) throw new Error("That cPanel account is not connected to your profile.");
    return { id: row.id, label: row.label, host: row.host, username: row.username, kind: row.kind, authType: row.auth_type, ...(row.token_name ? { tokenName: row.token_name } : {}), createdAt: row.created_at.toISOString() };
  }

  async accountStore(userId: string): Promise<AccountStore> {
    return {
      list: () => this.listAccounts(userId),
      get: (id) => this.getAccount(userId, id),
      add: async () => { throw new Error("Use the secure account settings page to connect a cPanel account. Secrets must not be sent through MCP tool arguments."); },
      remove: (id) => this.removeAccount(userId, id),
    };
  }

  async saveAuthorizationTransaction(data: HostedAuthorization): Promise<void> {
    await this.pool.query("INSERT INTO oauth_transactions(id,client_id,transaction_data,expires_at) VALUES($1,$2,$3::jsonb,now()+interval '10 minutes')", [data.id, data.clientId, JSON.stringify(data)]);
  }

  async getAuthorizationTransaction(id: string): Promise<HostedAuthorization | null> {
    const { rows } = await this.pool.query<{ transaction_data: HostedAuthorization }>("SELECT transaction_data FROM oauth_transactions WHERE id=$1 AND expires_at>now()", [id]);
    return rows[0]?.transaction_data ?? null;
  }

  async findAuthorizationCode(code: string, clientId: string): Promise<{ codeChallenge: string } | null> {
    const { rows } = await this.pool.query<{ code_challenge: string }>("SELECT code_challenge FROM oauth_codes WHERE code_hash=$1 AND client_id=$2 AND expires_at>now()", [hashToken(code), clientId]);
    return rows[0] ? { codeChallenge: rows[0].code_challenge } : null;
  }

  async createAccessTokens(input: { clientId: string; userId: string; resource: string; scopes: string[] }): Promise<{ access: string; refresh?: string }> {
    const access = opaqueToken();
    await this.issueToken({ raw: access, clientId: input.clientId, userId: input.userId, type: "access", resource: input.resource, scopes: input.scopes, lifetimeSeconds: 3600 });
    if (!input.scopes.includes("offline_access")) return { access };
    const refresh = opaqueToken();
    await this.issueToken({ raw: refresh, clientId: input.clientId, userId: input.userId, type: "refresh", resource: input.resource, scopes: input.scopes, lifetimeSeconds: 30 * 24 * 3600 });
    return { access, refresh };
  }

  async rotateRefreshToken(oldRefresh: string, input: { clientId: string; userId: string; resource: string; scopes: string[] }): Promise<{ access: string; refresh?: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ user_id: string }>("DELETE FROM oauth_tokens WHERE token_hash=$1 AND token_type='refresh' AND client_id=$2 AND expires_at>now() RETURNING user_id", [hashToken(oldRefresh), input.clientId]);
      if (!rows[0] || rows[0].user_id !== input.userId) throw new Error("Refresh token is invalid or expired.");
      const access = opaqueToken();
      if (input.scopes.includes("offline_access")) {
        const refresh = opaqueToken();
        await client.query("INSERT INTO oauth_tokens(token_hash,client_id,user_id,token_type,resource,scopes,expires_at) VALUES($1,$2,$3,'access',$4,$5,now()+interval '1 hour'),($6,$2,$3,'refresh',$4,$5,now()+interval '30 days')", [hashToken(access), input.clientId, input.userId, input.resource, input.scopes, hashToken(refresh)]);
        await client.query("COMMIT"); return { access, refresh };
      }
      await client.query("INSERT INTO oauth_tokens(token_hash,client_id,user_id,token_type,resource,scopes,expires_at) VALUES($1,$2,$3,'access',$4,$5,now()+interval '1 hour')", [hashToken(access), input.clientId, input.userId, input.resource, input.scopes]);
      await client.query("COMMIT"); return { access };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async deleteAuthorizationTransaction(id: string): Promise<void> { await this.pool.query("DELETE FROM oauth_transactions WHERE id=$1", [id]); }

  async createAuthorizationCode(input: { code: string; clientId: string; userId: string; redirectUri: string; challenge: string; resource: string; scopes: string[] }): Promise<void> {
    await this.pool.query("INSERT INTO oauth_codes(code_hash,client_id,user_id,redirect_uri,code_challenge,resource,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '2 minutes')", [hashToken(input.code), input.clientId, input.userId, input.redirectUri, input.challenge, input.resource, input.scopes]);
  }

  async consumeAuthorizationCode(input: { code: string; clientId: string; redirectUri: string; challenge: string; resource: string }): Promise<{ userId: string; scopes: string[] } | null> {
    const { rows } = await this.pool.query<{ user_id: string; scopes: string[] }>(`DELETE FROM oauth_codes WHERE code_hash=$1 AND client_id=$2 AND redirect_uri=$3 AND code_challenge=$4 AND resource=$5 AND expires_at>now() RETURNING user_id,scopes`, [hashToken(input.code), input.clientId, input.redirectUri, input.challenge, input.resource]);
    return rows[0] ? { userId: rows[0].user_id, scopes: rows[0].scopes } : null;
  }

  async issueToken(input: { raw: string; clientId: string; userId: string; type: "access" | "refresh"; resource: string; scopes: string[]; lifetimeSeconds: number }): Promise<void> {
    await this.pool.query("INSERT INTO oauth_tokens(token_hash,client_id,user_id,token_type,resource,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+($7 * interval '1 second'))", [hashToken(input.raw), input.clientId, input.userId, input.type, input.resource, input.scopes, input.lifetimeSeconds]);
  }

  async findToken(raw: string, type: "access" | "refresh", clientId?: string): Promise<{ clientId: string; userId: string; resource: string; scopes: string[]; expiresAt: Date } | null> {
    const { rows } = await this.pool.query<{ client_id: string; user_id: string; resource: string; scopes: string[]; expires_at: Date }>(`SELECT client_id,user_id,resource,scopes,expires_at FROM oauth_tokens WHERE token_hash=$1 AND token_type=$2 AND expires_at>now() AND ($3::text IS NULL OR client_id=$3)`, [hashToken(raw), type, clientId ?? null]);
    return rows[0] ? { clientId: rows[0].client_id, userId: rows[0].user_id, resource: rows[0].resource, scopes: rows[0].scopes, expiresAt: rows[0].expires_at } : null;
  }

  async revokeToken(raw: string): Promise<void> {
    const { rows } = await this.pool.query<{ client_id: string; user_id: string }>("DELETE FROM oauth_tokens WHERE token_hash=$1 RETURNING client_id,user_id", [hashToken(raw)]);
    const grant = rows[0];
    if (grant) await this.pool.query("DELETE FROM oauth_tokens WHERE client_id=$1 AND user_id=$2", [grant.client_id, grant.user_id]);
  }
}
