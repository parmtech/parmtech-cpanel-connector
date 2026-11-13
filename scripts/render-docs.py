from pathlib import Path
import sys,html
root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'work'/'docs-runtime'))
import markdown
css='''*{box-sizing:border-box}body{font:16px/1.75 system-ui,"Nirmala UI",sans-serif;margin:0;background:#f0f5fa;color:#182939}header{background:#112e46;color:#fff;padding:42px max(5vw,20px)}header h1{line-height:1.2;max-width:1000px}main{max-width:1080px;margin:28px auto;padding:32px;background:#fff;border:1px solid #d6e2ec;border-radius:16px}h2{margin-top:46px;padding-top:18px;border-top:1px solid #d8e3ee;color:#105268}h3{color:#15546b}a{color:#00698b}pre{padding:18px;background:#102638;color:#e5f6ff;border-radius:8px;overflow:auto;font-size:14px;line-height:1.6}code{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:20px 0;font-size:14px}th,td{border:1px solid #ccdbe6;text-align:left;padding:12px;vertical-align:top}th{background:#e9f4f8}li{margin-bottom:9px}.toc{padding:18px;background:#edf5fa;border-radius:10px}footer{padding:20px;text-align:center;color:#54677a}@media(max-width:700px){main{margin:12px;padding:18px}table{display:block;overflow:auto}header{padding:28px 20px}}@media print{body{background:white}header{background:white;color:#112e46;padding:10px}main{border:0;margin:0;padding:0;max-width:none}pre{white-space:pre-wrap;color:#102638;background:#eee}h2{break-after:avoid}table{font-size:11px}}'''
parts=[]
for filename in ['QUICKSTART-PA.md','COMPLETE-GUIDE.md']:
    parts.append(markdown.markdown((root/'docs'/filename).read_text(encoding='utf-8'),extensions=['tables','fenced_code','toc']))
document='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PARMTECH Connector · Setup and User Guide</title><style>'+css+'</style></head><body><header><p>PARMTECH · cPanel / WHM · MCP</p><h1>Setup, Login &amp; Complete User Guide</h1><p>Version0.2.0-alpha.2 · English &amp; ਪੰਜਾਬੀ · Owner-restricted hosted alpha</p></header><main>'+''.join(parts)+'</main><footer>PARMTECH · Source package documentation · No credentials included</footer></body></html>'
(root/'docs'/'START-HERE.html').write_text(document,encoding='utf-8')
print('Rendered standalone English/Punjabi documentation HTML.')
