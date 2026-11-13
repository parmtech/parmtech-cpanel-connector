import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import ipaddr from "ipaddr.js";
import type { FetchLike } from "../uapi.js";

type ResolvedAddress = { address: string; family: number };

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch { return false; }
}

export async function resolvePublicHost(hostname: string): Promise<ResolvedAddress[]> {
  let addresses: ResolvedAddress[];
  try {
    if (ipaddr.isValid(hostname)) {
      const parsed = ipaddr.process(hostname);
      addresses = [{ address: parsed.toString(), family: parsed.kind() === "ipv4" ? 4 : 6 }];
    } else {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    }
  } catch {
    throw new Error("The hosting server name could not be resolved.");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Private, reserved, and loopback server addresses cannot be connected from the hosted service.");
  }
  return addresses;
}

/** Resolve immediately before connect and pin the TCP lookup to a public result. */
export const publicEgressFetch: FetchLike = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  if (url.protocol !== "https:") throw new Error("Hosted outbound requests must use HTTPS.");
  const addresses = await resolvePublicHost(url.hostname.replace(/^\[|\]$/g, ""));
  const target = addresses[0]!;
  const dispatcher = new Agent({ connect: { lookup: ((hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) => {
    if (options?.all) callback(null, [target]);
    else callback(null, target.address, target.family);
  }) as never } });
  let handedOff = false;
  try {
    const send = undiciFetch as unknown as (request: unknown, requestInit: unknown) => Promise<any>;
    const response = await send(input, { ...init, dispatcher });
    if (!response.body) {
      await dispatcher.close();
      return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) { controller.close(); void dispatcher.close(); }
          else controller.enqueue(part.value);
        } catch (error) { controller.error(error); void dispatcher.destroy(error as Error); }
      },
      async cancel(reason) { await reader.cancel(reason); await dispatcher.close(); },
    });
    handedOff = true;
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    if (!handedOff && !dispatcher.closed) await dispatcher.close();
  }
};
