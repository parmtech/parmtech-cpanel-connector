# PARMTECH cPanel Remote capability audit

Audited 15 November 2026 against the hosted connector source and its live connected cPanel account. The account can list hosting profiles and call `Fileman::list_files` through the generic UAPI tool. The connected profile is a cPanel account, not a WHM administrator.

| Task | Connector status |
| --- | --- |
| List accounts, domains, mailboxes, files | Dedicated tools; live account and generic Fileman listing verified. |
| cPanel functions exposed by UAPI | Generic `cpanel_uapi_execute` with GET or form POST. Actual availability depends on the account, enabled cPanel features and token. |
| Upload a ZIP or other file | Added `cpanel_upload_file` using UAPI multipart upload. Live upload of a private test file and a small ZIP was verified by listing the uploaded filename and size. Inline base64 is limited to 500 KB; a direct public HTTPS source URL is limited to 32 MB. No private/signed URL or bare local path is accepted. |
| Extract an uploaded ZIP | Added `cpanel_extract_archive` through cPanel API 2 `Fileman::fileop` because there is no equivalent UAPI function. Live extraction of the small private test ZIP was verified by reading its contained file. Extracting can replace destination files. |
| Other cPanel API 2 functions | Added generic `cpanel_api2_execute` for API 2 operations without UAPI equivalents. cPanel deprecates API 2, so use UAPI where possible. |
| WHM server administration | Generic WHM API tool exists, but needs a separate WHM connection and its privileges. The current connected account is cPanel only. |
| Read text file content | Possible through UAPI `Fileman::get_file_content`; the connector caps API responses at 1 MB. |
| Download arbitrary binary files or database dumps to the chat | No dedicated streaming download tool. UAPI JSON responses are capped at 1 MB. |
| Upload a local chat attachment or a large/private ZIP directly | Not yet supported by the hosted MCP tool interface. The file must be supplied as small base64 content or placed at a direct public HTTPS URL. |
| SSH terminal, arbitrary shell commands, or cPanel GUI-only controls | Not exposed by this connector's UAPI/API 2/WHM API tools. These require separate access and may not be available on a shared-hosting plan. |
| Permanently delete a file through `Fileman::delete_file` | This connected host returned “function not found” for that UAPI call. The isolated upload and extract test files were moved to cPanel Trash with API 2 `Fileman::fileop`; they were not deleted from Trash. Other API functions must be checked on this host before relying on them. |

The connector cannot grant more authority than the connected cPanel or WHM account and the selected OAuth permissions. Some cPanel interface features have no published API, and provider policy can disable individual functions.

Sources: [cPanel's multipart upload guide](https://api.docs.cpanel.net/guides/quickstart-development-guide/tutorial-use-uapis-fileman-upload-files-function-in-custom-code), [cPanel API 2 Fileman file operations](https://api.docs.cpanel.net/cpanel-api-2/cpanel-api-2-modules-fileman/cpanel-api-2-functions-fileman-fileop), [cPanel UAPI introduction](https://api.docs.cpanel.net/cpanel/introduction).
