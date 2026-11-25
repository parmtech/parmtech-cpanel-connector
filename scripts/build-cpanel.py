"""Package compiled hosted code for cPanel Passenger, without operational state."""
from pathlib import Path
import json
import os
import tempfile
import zipfile
from distribution_privacy import PrivacyError, validate_public_file

root = Path(__file__).resolve().parent.parent
out = root / 'outputs' / 'parmtech-cpanel-hosted-cpanel.zip'
manifest = json.loads((root / 'package.json').read_text(encoding='utf-8'))
dependencies = {k: v for k, v in manifest['dependencies'].items() if k != '@napi-rs/keyring'}
package = {'name': manifest['name'] + '-cpanel', 'version': manifest['version'], 'private': True,
           'type': 'commonjs', 'engines': {'node': '>=22.19'}, 'scripts': {'start': 'node app.js'},
           'dependencies': dependencies}
allowed = ['tools.js', 'uapi.js', 'whm.js', 'host.js', 'types.js', 'version.js']
# Match current source modules, rather than including every stale compiled file.
hosted_sources = sorted((root / 'src/hosted').glob('*.ts'))
hosted_sources = [p for p in hosted_sources if not p.name.endswith('.d.ts')]
if not any(p.name == 'server.ts' for p in hosted_sources):
    raise SystemExit('Hosted source entry point is missing.')
files = [root / 'dist/src' / name for name in allowed]
files += [root / 'dist/src/hosted' / (p.stem + '.js') for p in hosted_sources]
if not all(p.is_file() for p in files):
    raise SystemExit('Compiled hosted modules are missing. Run npm run build first.')
payload = {'package.json': (json.dumps(package, indent=2) + '\n').encode(),
           'dist/package.json': b'{"type":"module"}\n'}
destinations = {root / 'deploy/cpanel/app.cjs': 'app.js',
                root / 'deploy/cpanel/load-config.cjs': 'load-config.cjs',
                root / 'deploy/cpanel/renew-ssl.mjs': 'renew-ssl.mjs'}
files += list(destinations)
try:
    for path in files:
        name = destinations.get(path, path.relative_to(root).as_posix())
        for parent in (path, *path.parents):
            if parent == root:
                break
            if parent.is_symlink():
                raise PrivacyError('Public package refuses symlinks: ' + name)
        payload[name] = path.read_bytes()
    for name, data in payload.items():
        validate_public_file(name, data)
except PrivacyError as error:
    raise SystemExit(str(error)) from None
out.parent.mkdir(exist_ok=True)
handle = tempfile.NamedTemporaryFile(prefix='.cpanel-package-', suffix='.zip', dir=out.parent, delete=False)
temporary = Path(handle.name)
handle.close()
try:
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(payload.items()):
            archive.writestr(name, data)
    validate_public_file('cpanel-server.zip', temporary.read_bytes(), allow_archive=True)
    os.replace(temporary, out)
finally:
    temporary.unlink(missing_ok=True)
print('Created hosted cPanel package; public-file and credential checks passed.')
