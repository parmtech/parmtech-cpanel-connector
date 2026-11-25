# cPanel and WHM capabilities and transfer limits

Reference for source version **0.2.0-alpha.4**, updated 25 November 2026. This describes the implementation; verify operations against your own hosting account. Provider features, permissions, quotas and cPanel versions can restrict individual functions.

| Task | Available behavior and limits |
| --- | --- |
| List profiles, domains, mailboxes and directories | Dedicated MCP tools. Profile listings return metadata, not stored secrets. |
| cPanel UAPI | `cpanel_uapi_execute` supports GET or form POST; requires `cpanel:write` because the generic tool can modify data. |
| Legacy cPanel API 2 | `cpanel_api2_execute` covers functions without a UAPI equivalent; prefer UAPI when available. |
| Small file upload | `cpanel_upload_file` accepts inline base64 up to 500,000 decoded bytes. |
| Public URL upload | `cpanel_upload_file` accepts a direct public HTTPS URL up to 32 MiB; credentials, query strings and redirects are not a private-file transport. |
| Staged cPanel upload | Existing begin/append/finish/cancel tools; up to 1,000,000,000 bytes, one active upload per user, six-hour expiry and 500,000-byte MCP chunks. Actual upload occurs at finish. |
| Browser upload and resume | Signed-in `/mani_admin/uploads`; browser chunks up to 8 MiB, status/resume/retry and cancellation. No additional MCP status tool is introduced. |
| ZIP extraction | `cpanel_extract_archive` uses API 2 Fileman file operations. It can overwrite destination files. |
| Text-file content | UAPI `Fileman::get_file_content`, subject to the connector’s 1 MiB API-response cap. |
| WHM operations | Separate WHM profile; `whm_api_read` allowlists read functions, while `whm_api_execute` requires the broader write grant. |
| Shell or SSH terminal | Not provided by cPanel UAPI/API 2/WHM tools. |
| Arbitrary remote binary download | No general MCP streaming download tool. Optional browser download below is restricted to a shared local filesystem. |

The 1,000,000,000-byte ceiling is the connector’s staging limit, not a guarantee from the hosting provider. An MCP client or app can enforce a lower cached tool-schema limit before a request reaches the connector. If supported, refresh its tool definitions and check the limit it advertises; refreshing does not change the provider’s restrictions. Do not cancel someone else’s staged upload to test.

The assistant must actually have access to a file’s bytes to send MCP chunks. A path on another computer or an attachment the client cannot read is insufficient. Browser upload offers a direct file picker. Transfers remain subject to hosting free space, per-request limits and network interruptions. A completed API response should be followed by a destination filename/size check when practical.

## Optional browser download

For a connector running on the same server filesystem as its target cPanel account, an operator may privately configure all of `LOCAL_DOWNLOAD_ROOT`, `LOCAL_DOWNLOAD_CPANEL_HOST` and `LOCAL_DOWNLOAD_CPANEL_USERNAME`. Without all three, direct download is disabled.

The signed-in route is `/mani_admin/download?accountId=<your-profile-id>&path=<relative-file-path>`. Use the opaque ID returned for your own saved profile and a path relative to the configured root. The implementation checks the matching cPanel host/username, verifies access through cPanel, resolves the real path and confines it to the allowed root. It is not a download proxy for unrelated remote accounts.

## Staging storage

`PRIVATE_UPLOAD_DIR` can select an absolute private cPanel staging directory; `PRIVATE_PLAY_BUNDLE_DIR` independently controls Play bundle staging. Keep them outside public web roots and archives. The supplied Docker setup uses `/tmp` tmpfs directories, which consume memory and are cleared on container restart. Configure and size private persistent mounts if transfers must survive container replacement. Temporary receipts and resumable state are not permanent file backups.

## Permissions and confirmation

The connector cannot grant more authority than your account and OAuth scopes. A dedicated read-only tool is the starting point for verification. Do not assume every interface action has an API equivalent or that a function present on one host exists on another. Removing a connector profile does not automatically revoke its cPanel/WHM token unless an explicit supported revoke action succeeds.

Primary references: [cPanel multipart upload](https://api.docs.cpanel.net/guides/quickstart-development-guide/tutorial-use-uapis-fileman-upload-files-function-in-custom-code), [API 2 Fileman operations](https://api.docs.cpanel.net/cpanel-api-2/cpanel-api-2-modules-fileman/cpanel-api-2-functions-fileman-fileop), [cPanel UAPI](https://api.docs.cpanel.net/cpanel/introduction).
