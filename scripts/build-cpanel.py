"""Package compiled hosted code for cPanel Passenger, without local credentials or native Windows modules."""
from pathlib import Path
import json, zipfile
root = Path(__file__).resolve().parent.parent
out = root / 'outputs' / 'parmtech-cpanel-hosted-cpanel.zip'
manifest = json.loads((root / 'package.json').read_text(encoding='utf-8'))
dependencies = {k:v for k,v in manifest['dependencies'].items() if k != '@napi-rs/keyring'}
package = {'name':manifest['name']+'-cpanel','version':manifest['version'],'private':True,
           'type':'commonjs','engines':{'node':'>=22.19'},'scripts':{'start':'node app.js'},'dependencies':dependencies}
allowed = ['tools.js','uapi.js','whm.js','host.js','types.js']
files = [root/'dist/src'/name for name in allowed] + list((root/'dist/src/hosted').glob('*.js'))
assert files and all(p.is_file() for p in files), 'Run npm run build first'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('package.json',json.dumps(package,indent=2)+'\n')
    z.writestr('app.js',(root/'deploy/cpanel/app.cjs').read_bytes())
    z.writestr('load-config.cjs',(root/'deploy/cpanel/load-config.cjs').read_bytes())
    z.writestr('renew-ssl.mjs',(root/'deploy/cpanel/renew-ssl.mjs').read_bytes())
    z.writestr('dist/package.json','{"type":"module"}\n')
    for p in files:z.write(p,p.relative_to(root).as_posix())
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert not any(n.endswith(('.env','.map')) or 'node_modules' in n for n in z.namelist())
print('Created hosted cPanel package; no credentials or Windows native modules included.')
