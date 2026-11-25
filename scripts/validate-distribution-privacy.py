"""Exercise real packaging commands against disposable disclosure fixtures."""
from io import BytesIO
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from distribution_privacy import PrivacyError, validate_public_file

SCRIPTS = Path(__file__).resolve().parent


class PublicDistributionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='connector-privacy-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'project'
        self.root.mkdir()
        for name in ['README.md', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.gitignore',
                     'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'Setup cPanel Connection.cmd',
                     'Enable Automatic Startup.cmd', 'Disable Automatic Startup.cmd',
                     'docs/START-HERE.html', 'docs/QUICKSTART.md']:
            self.write(name, 'Public fixture\n')
        for name in ['package-lock.json', 'tsconfig.json', 'plugin.json']:
            self.write(name, '{}')
        self.write('package.json', json.dumps({'name': 'public-fixture', 'version': '0.0.0', 'dependencies': {}}))
        self.write('mcp.json', json.dumps({'mcpServers': {'parmtech-cpanel': {'url': 'https://connector.example.com/mcp'}}}))
        self.write('.env.example', 'PGPASSWORD=REPLACE_WITH_DATABASE_PASSWORD\n')
        self.write('deploy/cpanel/runtime.example.json', '{"PGPASSWORD":"REPLACE_WITH_DATABASE_PASSWORD"}')
        self.write('deploy/cpanel/ssl-credentials.example.json', '{"apiToken":"REPLACE_WITH_CPANEL_API_TOKEN"}')
        for name in ['app.cjs', 'load-config.cjs', 'renew-ssl.mjs']:
            self.write('deploy/cpanel/' + name, '// Public fixture\n')
        self.write('src/hosted/server.ts', 'export {};\n')
        self.write('dist/src/hosted/server.js', 'export {};\n')
        for name in ['tools', 'uapi', 'whm', 'host', 'types', 'version']:
            self.write('dist/src/' + name + '.js', 'export {};\n')
        for name in ['build-cpanel.py', 'build-distribution.py', 'distribution_privacy.py']:
            destination = self.root / 'scripts' / name
            destination.parent.mkdir(exist_ok=True)
            shutil.copyfile(SCRIPTS / name, destination)

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode())

    def run_builder(self, script='build-distribution.py', succeeds=True):
        result = subprocess.run([sys.executable, str(self.root / 'scripts' / script)],
                                cwd=self.root, text=True, capture_output=True)
        if succeeds:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, 'Unsafe release was accepted')
        return result

    def test_clean_package_preserves_examples_and_excludes_private_root_and_stale_code(self):
        self.write('.env', 'PGPASSWORD=synthetic-private-value\n')
        self.write('runtime.json', '{"PGPASSWORD":"synthetic-private-value"}')
        self.write('dist/src/hosted/stale.js', 'const obsolete = true;\n')
        self.run_builder()
        archive = next((self.root / 'outputs').glob('*/**/*-FULL.zip'))
        with zipfile.ZipFile(archive) as outer:
            self.assertIn('.env.example', outer.namelist())
            self.assertIn('deploy/cpanel/runtime.example.json', outer.namelist())
            self.assertIn('deploy/cpanel/ssl-credentials.example.json', outer.namelist())
            self.assertNotIn('.env', outer.namelist())
            self.assertNotIn('runtime.json', outer.namelist())
            with zipfile.ZipFile(BytesIO(outer.read('packages/cpanel-server.zip'))) as runtime:
                self.assertIn('dist/src/version.js', runtime.namelist())
                self.assertNotIn('dist/src/hosted/stale.js', runtime.namelist())
            with zipfile.ZipFile(BytesIO(outer.read('packages/remote-plugin-template.zip'))) as plugin:
                url = json.loads(plugin.read('mcp.json'))['mcpServers']['parmtech-cpanel']['url']
                self.assertEqual(url, 'https://YOUR-CONNECTOR-HOST.example/mcp')

    def test_nested_operational_files_fail_before_output(self):
        cases = ['.env.production', 'runtime.json', 'ssl-credentials.json', 'accounts.json',
                 'service-account.production.json', 'upload.p12', 'key.pfx', 'snapshot.sql',
                 'snapshot.sqlite', 'database.dump', 'backup.tar.gz', 'private/customer.txt']
        for name in cases:
            with self.subTest(name=name):
                location = 'deploy/nested/' + name
                self.write(location, '{}')
                self.run_builder(succeeds=False)
                self.assertFalse((self.root / 'outputs').exists())
                (self.root / location).unlink()

    def test_examples_cannot_hide_real_credential_values(self):
        self.write('deploy/cpanel/runtime.example.json', json.dumps({'PGPASSWORD': 'synthetic-private-value'}))
        self.run_builder(succeeds=False)
        self.assertFalse((self.root / 'outputs').exists())

    def test_private_wrapper_id_in_source_fails(self):
        identifier = 'dev-' + 'a' * 32
        self.write('src/hosted/server.ts', 'export const wrapper = ' + json.dumps(identifier))
        result = self.run_builder(succeeds=False)
        self.assertNotIn(identifier, result.stderr)
        self.assertFalse((self.root / 'outputs').exists())

    def test_compiled_credential_blocks_runtime_archive(self):
        token = 'ghp_' + 'A' * 36
        self.write('dist/src/hosted/server.js', 'export const token = ' + json.dumps(token))
        result = self.run_builder('build-cpanel.py', succeeds=False)
        self.assertNotIn(token, result.stderr)
        self.assertFalse((self.root / 'outputs').exists())

    def test_symlinked_runtime_module_is_rejected(self):
        path = self.root / 'dist/src/hosted/server.js'
        path.unlink()
        target = self.root.parent / 'outside.js'
        target.write_text('export {};\n')
        path.symlink_to(target)
        self.run_builder('build-cpanel.py', succeeds=False)
        self.assertFalse((self.root / 'outputs').exists())

    def test_nested_zip_contents_are_checked_after_decompression(self):
        cases = [('nested/runtime.json', b'{}'), ('../outside.txt', b'fixture'),
                 ('src/server.js', ('const token = "ghp_' + 'B' * 36 + '";').encode()),
                 ('private/key.txt', ('-----BEGIN ' + 'PRIVATE KEY-----').encode())]
        for filename, data in cases:
            with self.subTest(filename=filename):
                buffer = BytesIO()
                with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr(filename, data)
                with self.assertRaises(PrivacyError):
                    validate_public_file('packages/cpanel-server.zip', buffer.getvalue(), allow_archive=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
