export interface AccountMetadata {
  id: string;
  label: string;
  host: string;
  username: string;
  tokenName?: string;
  createdAt: string;
  kind?: "cpanel" | "whm";
  authType?: "token" | "password";
}

export interface AccountCredentials {
  host: string;
  username: string;
  apiToken?: string;
  password?: string;
  tokenName?: string;
  kind?: "cpanel" | "whm";
  authType?: "token" | "password";
}

export interface AccountStore {
  list(): Promise<AccountMetadata[]>;
  get(id: string): Promise<{ metadata: AccountMetadata; credentials: AccountCredentials }>;
  add(input: {
    label: string;
    host: string;
    username: string;
    apiToken: string;
    tokenName?: string;
  }): Promise<AccountMetadata>;
  remove(id: string): Promise<AccountMetadata>;
}

export type UapiParameters = Record<string, string | number | boolean | Array<string | number | boolean> | null | undefined>;

export interface UapiEnvelope {
  apiversion?: number;
  func?: string;
  module?: string;
  result?: {
    data?: unknown;
    errors?: unknown;
    messages?: unknown;
    metadata?: unknown;
    status?: number;
    warnings?: unknown;
  };
  [key: string]: unknown;
}
