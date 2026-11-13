"""Build a whitelisted source/documentation/runtime distribution, never the work directory."""
from pathlib import Path
import hashlib,json,re,subprocess,sys,zipfile,shutil
root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
directory=root/'outputs'/('PARMTECH-cPanel-Connector-'+version)
directory.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,str(root/'scripts/build-cpanel.py')],cwd=root,check=True)
required=['README.md','package.json','package-lock.json','plugin.json','mcp.json','tsconfig.json','Dockerfile','docker-compose.yml','.dockerignore','.env.example','.gitignore','LICENSE','SECURITY.md','CHANGELOG.md','Setup cPanel Connection.cmd','Enable Automatic Startup.cmd','Disable Automatic Startup.cmd']
public_dirs=['src','scripts','deploy','docs','assets','.github']
payload={}
for name in required:
    p=root/name
    if not p.is_file():raise SystemExit('Required source file missing: '+name)
    payload[name]=p.read_bytes()
for name in public_dirs:
    for p in sorted((root/name).rglob('*')):
        if p.is_symlink():raise SystemExit('Public package refuses symlinks: '+str(p.relative_to(root)))
        if not p.is_file():continue
        relative=p.relative_to(root).as_posix()
        if '__pycache__' in p.parts:continue
        if p.suffix.lower() in {'.pem','.key','.enc','.log','.map','.pyc'} or p.name in {'.env','runtime.json','accounts.json'}:
            raise SystemExit('Private/runtime file found in source tree: '+relative)
        payload[relative]=p.read_bytes()
if 'docs/START-HERE.html' not in payload:raise SystemExit('Render documentation first')
# Self-hosting manifests must not silently select the owner's private service.
manifest=json.loads(payload['mcp.json'])
manifest['mcpServers']['parmtech-cpanel']['url']='https://YOUR-CONNECTOR-HOST.example/mcp'
payload['mcp.json']=(json.dumps(manifest,indent=2)+'\n').encode()
runtime=(root/'outputs/parmtech-cpanel-hosted-cpanel.zip').read_bytes()
payload['packages/cpanel-server.zip']=runtime
plugin=directory/'remote-plugin-template.zip'
with zipfile.ZipFile(plugin,'w',zipfile.ZIP_DEFLATED) as z:
    for name in ['plugin.json','mcp.json']+[n for n in payload if n.startswith('assets/')]:z.writestr(name,payload[name])
payload['packages/remote-plugin-template.zip']=plugin.read_bytes()
payload['START-HERE.html']=payload['docs/START-HERE.html']
for name,data in payload.items():
    if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',data):raise SystemExit('Private key material detected: '+name)
manifest={'version':version,'files':[{'path':n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in sorted(payload.items())]}
payload['SOURCE-MANIFEST.json']=(json.dumps(manifest,indent=2)+'\n').encode()
archive=directory/('PARMTECH-cPanel-Connector-'+version+'-FULL.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for name,data in sorted(payload.items()):z.writestr(name,data)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert not any(n.startswith(('work/','outputs/','node_modules/')) or '..' in Path(n).parts for n in z.namelist())
    for entry in manifest['files']:assert hashlib.sha256(z.read(entry['path'])).hexdigest()==entry['sha256']
    for nested in ['packages/cpanel-server.zip','packages/remote-plugin-template.zip']:
        import io
        with zipfile.ZipFile(io.BytesIO(z.read(nested))) as child:assert child.testzip() is None
shutil.copyfile(root/'docs/START-HERE.html',directory/'START-HERE.html')
shutil.copyfile(root/'docs/QUICKSTART.md',directory/'QUICKSTART.md')
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(directory/'SHA256SUMS.txt').write_text(digest+'  '+archive.name+'\n',encoding='ascii')
(directory/'SOURCE-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print('Full source ZIP built and checked: '+str(archive))
print('Included '+str(len(payload))+' source/documentation/runtime entries; private work/state excluded.')
