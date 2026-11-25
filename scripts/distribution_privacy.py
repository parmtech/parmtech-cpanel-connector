"""Fail-closed checks for public source and generated release archives.

These checks catch common accidental disclosures; they do not replace reviewing
the files selected for a public release. Errors name files, never secret values.
"""
from io import BytesIO
from pathlib import PurePosixPath
import json
import re
import stat
import zipfile


class PrivacyError(ValueError):
    pass


PRIVATE_DIRS = {".git", "node_modules", "work", "outputs", "private", "backups", "__pycache__"}
PRIVATE_SUFFIXES = {".pem", ".key", ".enc", ".p12", ".pfx", ".jks", ".keystore",
                    ".sqlite", ".sqlite3", ".db", ".sql", ".dump", ".bak", ".backup",
                    ".log", ".map", ".pyc"}
ARCHIVE_SUFFIXES = {".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"}
PRIVATE_CONFIG = re.compile(
    r"^(?:runtime|accounts?|credentials?|secrets?|tokens?|service[-_]account|"
    r"client[-_]secret|ssl[-_]credentials?)(?:[._-].*)?\.(?:jsonl?|ya?ml|toml|ini|conf)$",
    re.IGNORECASE,
)
SIGNATURES = {
    "private key material": re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"),
    "GitHub credential": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b"),
    "Google API credential": re.compile(rb"\bAIza[A-Za-z0-9_-]{30,}\b"),
    "AWS access credential": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "private plugin identifier": re.compile(rb"\bdev-[0-9a-f]{32}\b"),
    "database dump": re.compile(rb"SQLite format 3\x00|^PGDMP|-- (?:PostgreSQL database|MySQL) dump"),
}
SECRET_FIELDS = {
    "password", "pgpassword", "postgrespassword", "smtppassword", "apitoken",
    "apikey", "cpanelapitoken", "accesstoken", "refreshtoken", "clientsecret",
    "credentialencryptionkey", "privatekey", "githubtoken", "ghtoken",
}
ENV_SECRET = re.compile(
    r"^\s*(?:export\s+)?(?:PGPASSWORD|POSTGRES_PASSWORD|SMTP_PASSWORD|CPANEL_API_TOKEN|"
    r"CREDENTIAL_ENCRYPTION_KEY|GITHUB_TOKEN|GH_TOKEN)\s*=\s*(.*?)\s*$", re.MULTILINE,
)
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024


def _placeholder(value):
    value = value.strip().strip("\"'")
    return (not value or value.startswith(("${", "<")) or
            re.match(r"^(?:replace|your[_ -]|change[_ -]?me|example|test|fake|mock|fixture|dummy|sample|placeholder|not[-_ ]real)", value, re.IGNORECASE) or
            value.lower() in {"token", "password", "secret"})


def validate_path(name, *, allow_archive=False):
    path = PurePosixPath(name)
    if (not name or "\\" in name or ":" in name or name.startswith("/") or
            any(part in {"", ".", ".."} for part in name.split("/"))):
        raise PrivacyError("Unsafe release path: " + name)
    if any(part.lower() in PRIVATE_DIRS for part in path.parts):
        raise PrivacyError("Private/runtime directory in release: " + name)
    lower = path.name.lower()
    if lower.startswith(".env") and lower != ".env.example":
        raise PrivacyError("Environment file in release: " + name)
    if path.suffix.lower() in PRIVATE_SUFFIXES:
        raise PrivacyError("Private/runtime file in release: " + name)
    is_example = lower.endswith((".example.json", ".example.yaml", ".example.yml", ".example.toml", ".example.ini", ".example.conf"))
    if not is_example and PRIVATE_CONFIG.match(lower):
        raise PrivacyError("Private runtime configuration in release: " + name)
    if lower == "hosted-connector-handoff.md":
        raise PrivacyError("Private handoff in release: " + name)
    if path.suffix.lower() in ARCHIVE_SUFFIXES and not allow_archive:
        raise PrivacyError("Unreviewed nested archive in release: " + name)


def public_file_bytes(root, path):
    """Read an allowlisted source file only after rejecting private names/links."""
    relative = path.relative_to(root)
    for parent in (path, *path.parents):
        if parent == root:
            break
        if parent.is_symlink():
            raise PrivacyError("Public package refuses symlinks: " + relative.as_posix())
    validate_path(relative.as_posix())
    data = path.read_bytes()
    validate_public_file(relative.as_posix(), data)
    return data


def _validate_json(value, name):
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = re.sub(r"[^a-z]", "", str(key).lower())
            if normalized in SECRET_FIELDS and isinstance(item, str) and not _placeholder(item):
                raise PrivacyError("Non-placeholder credential setting in release: " + name)
            _validate_json(item, name)
    elif isinstance(value, list):
        for item in value:
            _validate_json(item, name)


def validate_public_file(name, data, *, allow_archive=False):
    validate_path(name, allow_archive=allow_archive)
    for label, pattern in SIGNATURES.items():
        if pattern.search(data):
            raise PrivacyError(label.capitalize() + " in release: " + name)
    is_zip = zipfile.is_zipfile(BytesIO(data))
    if is_zip or PurePosixPath(name).suffix.lower() in ARCHIVE_SUFFIXES:
        if not allow_archive or not is_zip:
            raise PrivacyError("Unreviewed or invalid archive in release: " + name)
        with zipfile.ZipFile(BytesIO(data)) as archive:
            total = 0
            seen = set()
            for item in archive.infolist():
                if item.is_dir():
                    validate_path(item.filename.rstrip("/"))
                    continue
                if item.filename in seen or stat.S_ISLNK(item.external_attr >> 16) or item.flag_bits & 1:
                    raise PrivacyError("Unsafe archive entry in release: " + name)
                seen.add(item.filename)
                total += item.file_size
                if total > MAX_ARCHIVE_BYTES:
                    raise PrivacyError("Archive exceeds review size limit: " + name)
                try:
                    validate_public_file(item.filename, archive.read(item))
                except PrivacyError as error:
                    raise PrivacyError(name + ": " + str(error)) from None
        return
    text = data.decode("utf-8", errors="replace")
    for match in ENV_SECRET.finditer(text):
        if not _placeholder(match.group(1)):
            raise PrivacyError("Non-placeholder environment credential in release: " + name)
    if PurePosixPath(name).suffix.lower() == ".json":
        try:
            _validate_json(json.loads(text), name)
        except json.JSONDecodeError:
            pass
