import express, { type Express, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { rateLimit } from "express-rate-limit";
import { StagedUploadStore } from "./staged-upload.js";
import { UapiClient } from "../uapi.js";
import { publicEgressFetch } from "./outbound.js";
import { renderPage } from "./presentation.js";
import type { HostedRepository } from "./repository.js";
const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uploadIdPattern = accountIdPattern;

export interface LocalDownloadConfig {
    root: string;
    hostname: string;
    username: string;
}
type UploadUser = { userId: string; csrf: string };
type UploadRepository = Pick<HostedRepository, "listAccounts" | "getAccount">;
export interface UploadRouteOptions {
    client?: Pick<UapiClient, "call" | "uploadStagedFile">;
    stagingRoot?: string;
    localDownload?: LocalDownloadConfig | null;
}
/** Enable only when the connector shares the selected cPanel account's filesystem. */
export function readLocalDownloadConfig(env: NodeJS.ProcessEnv = process.env): LocalDownloadConfig | null {
    const root = env.LOCAL_DOWNLOAD_ROOT;
    const hostname = env.LOCAL_DOWNLOAD_CPANEL_HOST;
    const username = env.LOCAL_DOWNLOAD_CPANEL_USERNAME;
    if (!root && !hostname && !username) return null;
    if (!root || !hostname || !username) throw new Error("Direct downloads require LOCAL_DOWNLOAD_ROOT, LOCAL_DOWNLOAD_CPANEL_HOST and LOCAL_DOWNLOAD_CPANEL_USERNAME together.");
    if (!isAbsolute(root) || root === "/" || /[\r\n\0]/.test(root)) throw new Error("LOCAL_DOWNLOAD_ROOT must be an absolute, dedicated download directory.");
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname) || hostname.includes("..") || !/^[a-z0-9_][a-z0-9_.-]{0,63}$/i.test(username)) throw new Error("Direct-download cPanel host and username are invalid.");
    return { root, hostname: hostname.toLowerCase(), username };
}

const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function installUploadRoutes(
    app: Express,
    repository: UploadRepository,
    baseUrl: URL,
    getUser: (req: Request) => Promise<UploadUser | null>,
    options: UploadRouteOptions = {},
): void {
    const localDownload = options.localDownload === undefined ? readLocalDownloadConfig() : options.localDownload;
    const client = options.client ?? new UapiClient(publicEgressFetch);
    const storeFor = (userId: string) => new StagedUploadStore(userId, options.stagingRoot);
    const limit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
    const authorised = async (req: Request, mutate: boolean): Promise<UploadUser | null> => {
        const user = await getUser(req);
        if (!user)
            return null;
        if (mutate && (req.headers.origin !== baseUrl.origin || req.headers["x-parmtech-csrf"] !== user.csrf))
            return null;
        return user;
    };
    const failure = (res: Response, error: unknown, status = 400): void => {
        const message = error instanceof Error ? error.message : "Upload failed.";
        res.status(status).json({ error: message.slice(0, 300) });
    };
    app.get("/mani_admin/uploads", async (req, res) => {
        const user = await getUser(req);
        if (!user)
            return res.redirect(302, "/mani_admin");
        const accounts = (await repository.listAccounts(user.userId)).filter(account => account.kind === "cpanel");
        const options = accounts.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.label)} — ${escapeHtml(account.username)}</option>`).join("");
        const nonce = randomBytes(18).toString("base64");
        res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
        const body = `<p class="eyebrow">FILE TRANSFER</p><h1>Upload a large file</h1><p class="page-intro">Send a ZIP or other file up to 1 GB to a saved cPanel account. If the connection stops, choose the same file and press Upload again to resume.</p><form id="large-upload-form"><label for="account">Hosting account</label><select id="account" required>${options}</select><label for="directory">Destination folder</label><input id="directory" value="public_html" required><label for="file">File</label><input id="file" type="file" required><button id="submit" type="submit">Upload file</button></form><p id="progress" role="status" aria-live="polite" class="notice">Ready.</p><p class="helper">Your browser sends 8 MB pieces. The temporary copy stays private and expires after six hours. Uploading uses temporary disk space as well as the destination space.</p><p><a href="/mani_admin">Back to connection settings</a></p><script nonce="${nonce}">(()=>{const csrf=${JSON.stringify(user.csrf)},key='parmtech-large-upload-v1',form=document.getElementById('large-upload-form'),status=document.getElementById('progress'),button=document.getElementById('submit');const call=async(url,options)=>{const response=await fetch(url,{credentials:'same-origin',...options,headers:{'X-PARMTECH-CSRF':csrf,...options?.headers}});const value=await response.json();if(!response.ok)throw Error(value.error||'Upload request failed');return value};form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;const file=document.getElementById('file').files[0],accountId=document.getElementById('account').value,directory=document.getElementById('directory').value.trim();if(!file){button.disabled=false;return}try{let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{}const fingerprint=[accountId,directory,file.name,file.size,file.lastModified].join('|');let uploadId,offset=0,chunkSize=8*1024*1024;if(saved?.fingerprint===fingerprint){try{const current=await call('/mani_admin/uploads/'+encodeURIComponent(saved.uploadId)+'/status',{});if(current.accountId===accountId&&current.directory===directory&&current.filename===file.name&&current.totalBytes===file.size){uploadId=saved.uploadId;offset=current.receivedBytes}}catch{localStorage.removeItem(key)}}if(!uploadId){const started=await call('/mani_admin/uploads/begin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId,directory,filename:file.name,totalBytes:file.size})});uploadId=started.uploadId;chunkSize=started.maxBrowserChunkBytes||chunkSize;localStorage.setItem(key,JSON.stringify({uploadId,fingerprint}))}while(offset<file.size){status.textContent='Uploading '+Math.floor(offset/file.size*100)+'%';const end=Math.min(offset+chunkSize,file.size);const result=await call('/mani_admin/uploads/'+encodeURIComponent(uploadId)+'/chunk?offset='+offset,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file.slice(offset,end)});offset=result.receivedBytes}status.textContent='Transfer complete. Saving to cPanel…';const finished=await call('/mani_admin/uploads/'+encodeURIComponent(uploadId)+'/finish',{method:'POST'});localStorage.removeItem(key);status.textContent='Uploaded '+finished.filename+' ('+finished.bytes+' bytes) to '+finished.directory+'.'}catch(error){status.textContent='Upload paused: '+String(error.message||error)+'. Select the same file and press Upload to resume.'}finally{button.disabled=false}})})();</script>`;
        const discard = `<p><button id="discard-upload" type="button" class="button-secondary">Discard paused upload</button></p><script nonce="${nonce}">document.getElementById('discard-upload').addEventListener('click',async()=>{const key='parmtech-large-upload-v1',status=document.getElementById('progress');let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{}if(!saved?.uploadId){status.textContent='No paused upload is saved in this browser.';return}try{const response=await fetch('/mani_admin/uploads/'+encodeURIComponent(saved.uploadId)+'/cancel',{method:'POST',credentials:'same-origin',headers:{'X-PARMTECH-CSRF':${JSON.stringify(user.csrf)}}});if(!response.ok)throw Error('Could not discard the upload');localStorage.removeItem(key);status.textContent='Paused upload discarded.'}catch(error){status.textContent=String(error.message||error)}});</script>`;
        const download = localDownload ? `<h2>Download a large file</h2><p>Download a file from the configured directory on this server. Choose the matching cPanel account. Large downloads can resume if the browser supports it.</p><form method="get" action="/mani_admin/download"><label for="download-account">Hosting account</label><select id="download-account" name="accountId" required>${options}</select><label for="download-path">File path inside the configured directory</label><input id="download-path" name="path" placeholder="backups/example.zip" required><button type="submit">Download file</button></form>` : "";
        res.type("html").send(renderPage("Large file transfer", body + discard + download));
    });
    app.get("/mani_admin/download", limit, async (req, res) => {
        if (!localDownload) return res.status(404).send("Direct downloads are not configured.");
        const user = await authorised(req, false);
        if (!user)
            return res.status(401).send("Sign in to the connector first.");
        const accountId = String(req.query.accountId ?? "");
        const requested = String(req.query.path ?? "");
        if (!accountIdPattern.test(accountId) || !requested || requested.length > 1024 || requested.includes("\0") || requested.includes("\\") || isAbsolute(requested))
            return res.status(400).send("Invalid file selection.");
        const parts = requested.split("/");
        if (parts.some(part => !part || part === "." || part === ".."))
            return res.status(400).send("Invalid file path.");
        try {
            const { metadata, credentials } = await repository.getAccount(user.userId, accountId);
            const host = new URL(credentials.host);
            if (metadata.kind !== "cpanel" || credentials.username !== localDownload.username || host.hostname !== localDownload.hostname || host.protocol !== "https:" || host.port !== "2083")
                return res.status(403).send("This hosting account does not support direct downloads.");
            const verified = await client.call(credentials, "Fileman", "list_files", { dir: localDownload.root });
            if (verified.result?.status !== 1)
                return res.status(403).send("Hosting access could not be verified.");
            const root = await realpath(localDownload.root);
            const file = await realpath(join(root, ...parts));
            const relativePath = relative(root, file);
            if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath))
                return res.status(403).send("File is outside the configured download directory.");
            const info = await stat(file);
            if (!info.isFile() || info.size > 1_000_000_000)
                return res.status(400).send("Choose a file up to 1 GB.");
            let start = 0, end = info.size - 1;
            const range = req.headers.range;
            if (range) {
                const match = /^bytes=(\d+)-(\d*)$/.exec(range);
                if (!match) {
                    res.setHeader("Content-Range", `bytes */${info.size}`);
                    return res.status(416).end();
                }
                start = Number(match[1]);
                end = match[2] ? Number(match[2]) : end;
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= info.size) {
                    res.setHeader("Content-Range", `bytes */${info.size}`);
                    return res.status(416).end();
                }
                res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
            }
            res.setHeader("Cache-Control", "private, no-store");
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Length", end - start + 1);
            if (info.size === 0) return res.end();
            createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
        }
        catch {
            if (!res.headersSent)
                res.status(404).send("File unavailable or hosting access failed.");
        }
    });
    app.post("/mani_admin/uploads/begin", limit, async (req, res) => {
        const user = await authorised(req, true);
        if (!user)
            return res.status(403).json({ error: "Sign in and reopen the upload page." });
        const { accountId, directory, filename, totalBytes } = req.body ?? {};
        if (typeof accountId !== "string" || !accountIdPattern.test(accountId) || typeof directory !== "string" || typeof filename !== "string")
            return res.status(400).json({ error: "Check the account, folder and filename." });
        try {
            const { metadata } = await repository.getAccount(user.userId, accountId);
            if (metadata.kind !== "cpanel")
                return res.status(400).json({ error: "Choose a cPanel account." });
            res.json(await storeFor(user.userId).begin({ accountId, directory, filename, totalBytes }));
        }
        catch (error) {
            failure(res, error);
        }
    });
    app.get("/mani_admin/uploads/:id/status", limit, async (req, res) => {
        const user = await authorised(req, false);
        if (!user)
            return res.status(401).json({ error: "Sign in again." });
        if (!uploadIdPattern.test(String(req.params.id)))
            return res.status(400).json({ error: "Invalid upload ID." });
        try {
            res.json(await storeFor(user.userId).status(String(req.params.id)));
        }
        catch (error) {
            failure(res, error, 404);
        }
    });
    app.put("/mani_admin/uploads/:id/chunk", limit, express.raw({ type: "application/octet-stream", limit: "8mb" }), async (req, res) => {
        const user = await authorised(req, true);
        if (!user)
            return res.status(403).json({ error: "Sign in and reopen the upload page." });
        if (!uploadIdPattern.test(String(req.params.id)) || !Buffer.isBuffer(req.body))
            return res.status(400).json({ error: "Invalid upload chunk." });
        const offset = Number(req.query.offset);
        try {
            res.json(await storeFor(user.userId).appendBytes(String(req.params.id), offset, req.body));
        }
        catch (error) {
            failure(res, error);
        }
    });
    app.post("/mani_admin/uploads/:id/finish", limit, async (req, res) => {
        const user = await authorised(req, true);
        if (!user)
            return res.status(403).json({ error: "Sign in and reopen the upload page." });
        if (!uploadIdPattern.test(String(req.params.id)))
            return res.status(400).json({ error: "Invalid upload ID." });
        req.setTimeout(31 * 60 * 1000);
        res.setTimeout(31 * 60 * 1000);
        try {
            const store = storeFor(user.userId);
            res.json(await store.finish(String(req.params.id), async (meta, file) => {
                const { metadata, credentials } = await repository.getAccount(user.userId, meta.accountId);
                if (metadata.kind !== "cpanel")
                    throw new Error("The cPanel account is no longer connected.");
                return client.uploadStagedFile(credentials, meta.directory, meta.filename, file);
            }));
        }
        catch (error) {
            failure(res, error, 502);
        }
    });
    app.post("/mani_admin/uploads/:id/cancel", limit, async (req, res) => {
        const user = await authorised(req, true);
        if (!user)
            return res.status(403).json({ error: "Sign in and reopen the upload page." });
        if (!uploadIdPattern.test(String(req.params.id)))
            return res.status(400).json({ error: "Invalid upload ID." });
        try {
            res.json(await storeFor(user.userId).cancel(String(req.params.id)));
        }
        catch (error) {
            failure(res, error, 404);
        }
    });
}

