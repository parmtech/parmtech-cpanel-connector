"""Build a reviewed source/documentation/runtime distribution, never private state."""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from distribution_privacy import PrivacyError, public_file_bytes, validate_public_file

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
directory = root / 'outputs' / ('PARMTECH-cPanel-Connector-' + version)
required = ['README.md', 'package.json', 'package-lock.json', 'plugin.json', 'mcp.json',
            'tsconfig.json', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.env.example',
            '.gitignore', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'Setup cPanel Connection.cmd',
            'Enable Automatic Startup.cmd', 'Disable Automatic Startup.cmd']
public_dirs = ['src', 'scripts', 'deploy', 'docs', 'assets', '.github']
payload = {}
try:
    for name in required:
        path = root / name
        if not path.is_file():
            raise SystemExit('Required source file missing: ' + name)
        payload[name] = public_file_bytes(root, path)
    for name in public_dirs:
        for path in sorted((root / name).rglob('*')):
            if path.is_symlink():
                raise PrivacyError('Public package refuses symlinks: ' + path.relative_to(root).as_posix())
            if not path.is_file() or '__pycache__' in path.parts:
                continue
            payload[path.relative_to(root).as_posix()] = public_file_bytes(root, path)
    if 'docs/START-HERE.html' not in payload:
        raise SystemExit('Render documentation first')
    # A self-hosting template must never silently select the operator's service.
    plugin_mcp = json.loads(payload['mcp.json'])
    plugin_mcp['mcpServers']['parmtech-cpanel']['url'] = 'https://YOUR-CONNECTOR-HOST.example/mcp'
    payload['mcp.json'] = (json.dumps(plugin_mcp, indent=2) + '\n').encode()
    # Validate source first, before creating any distribution output.
    subprocess.run([sys.executable, str(root / 'scripts/build-cpanel.py')], cwd=root, check=True)
    payload['packages/cpanel-server.zip'] = (root / 'outputs/parmtech-cpanel-hosted-cpanel.zip').read_bytes()
    plugin_bytes = BytesIO()
    with zipfile.ZipFile(plugin_bytes, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in ['plugin.json', 'mcp.json'] + [n for n in payload if n.startswith('assets/')]:
            archive.writestr(name, payload[name])
    payload['packages/remote-plugin-template.zip'] = plugin_bytes.getvalue()
    payload['START-HERE.html'] = payload['docs/START-HERE.html']
    for name, data in payload.items():
        validate_public_file(name, data, allow_archive=name in {
            'packages/cpanel-server.zip', 'packages/remote-plugin-template.zip'})
except PrivacyError as error:
    raise SystemExit(str(error)) from None
manifest = {'version': version, 'files': [
    {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    for name, data in sorted(payload.items())]}
payload['SOURCE-MANIFEST.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
directory.mkdir(parents=True, exist_ok=True)
archive_path = directory / ('PARMTECH-cPanel-Connector-' + version + '-FULL.zip')
handle = tempfile.NamedTemporaryFile(prefix='.full-package-', suffix='.zip', dir=directory, delete=False)
temporary = Path(handle.name)
handle.close()
try:
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(payload.items()):
            archive.writestr(name, data)
    with zipfile.ZipFile(temporary) as archive:
        if archive.testzip() is not None:
            raise SystemExit('Distribution archive integrity check failed.')
        for entry in manifest['files']:
            if hashlib.sha256(archive.read(entry['path'])).hexdigest() != entry['sha256']:
                raise SystemExit('Distribution file integrity check failed: ' + entry['path'])
    os.replace(temporary, archive_path)
finally:
    temporary.unlink(missing_ok=True)
(directory / 'remote-plugin-template.zip').write_bytes(payload['packages/remote-plugin-template.zip'])
shutil.copyfile(root / 'docs/START-HERE.html', directory / 'START-HERE.html')
shutil.copyfile(root / 'docs/QUICKSTART.md', directory / 'QUICKSTART.md')
digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
(directory / 'SHA256SUMS.txt').write_text(digest + '  ' + archive_path.name + '\n', encoding='ascii')
(directory / 'SOURCE-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print('Full source ZIP built and checked: ' + str(archive_path))
print('Included ' + str(len(payload)) + ' source/documentation/runtime entries; private state excluded.')
