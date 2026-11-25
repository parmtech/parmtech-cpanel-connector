# Google Play AAB upload

The Play connector now supports binary uploads with the existing service-account connection and `play:write` permission. No browser Google sign-in is needed.

1. Create an edit with `play_api_write` (POST `/androidpublisher/v3/applications/PACKAGE/edits`).
2. Call `play_begin_bundle_upload` with package, edit ID, `.aab` filename, exact byte length and SHA-256.
3. Send sequential base64 chunks of at most 500,000 decoded bytes through `play_append_bundle_chunk`. Use `receivedBytes` from each acknowledgement as the next offset. `play_bundle_upload_status` supports progress recovery.
4. Call `play_finish_bundle_upload`. The server validates length and SHA-256, streams the staged file to Google's media endpoint and returns Google's matching versionCode/SHA-256 receipt.
5. Separately inspect/update a track, validate and commit the edit only when the user requested that release. Uploading a bundle alone never publishes it.

Each user's staging is private, limited to one active upload of at most 1 GB, and expires after six hours. Completed receipts are retained temporarily so repeated finish calls do not duplicate uploads. If Google's response is lost, finish reconciles bundles by SHA-256 before any new POST. Staging can be cancelled without deleting an uploaded bundle from Google Play.

Credentials remain server-side. There is no arbitrary URL fetch, local-path reading, or cross-connector credential access. New tools may require a host tool-list refresh after server deployment; this does not require a new Google account login.

Google API: https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload
