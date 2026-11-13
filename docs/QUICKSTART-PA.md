# ਪਹਿਲੀ setup ਅਤੇ login — ਪੰਜਾਬੀ

## ਤੁਹਾਡਾ login

ਹੁਣ ਖੋਲ੍ਹੋ: **https://connector.parmtech.au/mani_admin**

ਪਹਿਲੀ ਵਾਰੀ **First-time admin setup** ਆਵੇਗੀ। Email **info@parmtech.au** ਪਾਓ। Email ਵਿੱਚ ਆਇਆ8ਅੰਕਾਂ ਵਾਲਾ code ਉਸੇ browser tab ਵਿੱਚ ਪਾਓ। ਫਿਰ ਆਪਣਾ ਨਵਾਂ password ਬਣਾਓ ਅਤੇ ਦੁਬਾਰਾ ਲਿਖ ਕੇ confirm ਕਰੋ। ਕੋਈ default password ਨਹੀਂ ਹੈ। ਮੈਂ ਤੁਹਾਡਾ password ਬਣਾਇਆ ਜਾਂ chat ਵਿੱਚ ਰੱਖਿਆ ਨਹੀਂ ਹੈ।

ਉਸ ਤੋਂ ਬਾਅਦ ਇਸੇ URL ’ਤੇ ਆਪਣਾ email ਅਤੇ ਬਣਾਇਆ password ਪਾ ਕੇ login ਕਰੋ। Setup ਮੁੜ ਨਹੀਂ ਆਉਣੀ ਚਾਹੀਦੀ। ਇਹ connector ਦਾ login ਹੈ—cPanel ਜਾਂ ChatGPT ਦਾ password ਨਹੀਂ।

Code15ਮਿੰਟ ਲਈ ਹੈ। ਪੰਜ ਗਲਤ ਕੋਸ਼ਿਸ਼ਾਂ ਤੋਂ ਬਾਅਦ ਨਵਾਂ code ਮੰਗੋ। ਪੰਦਰਾਂ ਮਿੰਟਾਂ ਵਿੱਚ ਵੱਧ ਤੋਂ ਵੱਧ ਤਿੰਨ codes ਮੰਗ ਸਕਦੇ ਹੋ। ਜਿਸ browser ਵਿੱਚ setup ਸ਼ੁਰੂ ਕੀਤੀ, ਉਸੇ ਵਿੱਚ ਪੂਰੀ ਕਰੋ। Code/password chat ਵਿੱਚ ਨਾ ਪਾਓ।

ਸਿਰਫ਼ `connector.parmtech.au` ਖੋਲ੍ਹਣ ’ਤੇ official `parmtech.au` website ਖੁੱਲੇਗੀ। ਵੱਖਰਾ connector public frontend ਨਹੀਂ ਹੈ।

## cPanel ਕਿਵੇਂ ਜੁੜੇਗਾ?

ਇਸ owner installation ਵਿੱਚ ਪਹਿਲਾਂ ਸੇਵ ਕੀਤਾ cPanel account, **info@parmtech.au** verify ਕਰਕੇ sign in ਕਰਨ ਤੋਂ ਬਾਅਦ ਇੱਕ ਵਾਰੀ migrate ਹੋ ਸਕਦਾ ਹੈ। ਆਪਣਾ account disconnect ਕਰਨ ’ਤੇ ਉਹ ਚੁੱਪਚਾਪ ਦੁਬਾਰਾ ਨਹੀਂ ਜੋੜਿਆ ਜਾਵੇਗਾ। ਕਿਸੇ ਹੋਰ self-hosting user ਨੂੰ ਤੁਹਾਡੇ credentials ਨਹੀਂ ਮਿਲਣਗੇ।

ਨਵਾਂ account ਜੋੜਨਾ ਹੋਵੇ ਤਾਂ label, server hostname, cPanel username ਅਤੇ ਅਸਲੀ API token secure form ਵਿੱਚ ਪਾਓ। Token ਦਾ name ਅਤੇ token ਦੀ value ਵੱਖਰੀਆਂ ਚੀਜ਼ਾਂ ਹਨ।

## ChatGPT/Codex ਨਾਲ ਵਰਤਣਾ

Remote MCP URL: `https://connector.parmtech.au/mcp`

Client ਵਿੱਚ ਇਹ URL ਜੋੜ ਕੇ OAuth login ਅਤੇ permissions approve ਕਰੋ। `/mcp` ਆਮ web page ਨਹੀਂ ਹੈ। Browser ਵਾਲਾ admin URL `/mani_admin` ਹੈ। ਪੁਰਾਣਾ Local plugin ਆਪਣੇ ਆਪ hosted plugin ਨਹੀਂ ਬਣਦਾ।

ਹੁਣ server-side service ਲਈ PC ਚਾਲੂ ਰੱਖਣ ਦੀ ਲੋੜ ਨਹੀਂ। Hosting ਚੱਲਦੀ ਹੋਵੇ ਤਾਂ connector ਉੱਥੋਂ ਕੰਮ ਕਰੇਗਾ। Saved credentials PostgreSQL ਵਿੱਚ encrypted ਹਨ ਅਤੇ encryption key private file ਵਿੱਚ stable ਰਹਿੰਦੀ ਹੈ। Server restart ’ਤੇ ਨਵੀਂ key ਨਹੀਂ ਬਣਦੀ। Client ਦਾ login expire ਹੋਣਾ ਅਤੇ cPanel token ਮਿਟਣਾ ਵੱਖਰੀਆਂ ਗੱਲਾਂ ਹਨ।

## ZIP ਵਿੱਚ ਕੀ ਹੈ?

ਪੂਰਾ source, cPanel/Docker setup, config templates, tests, plugin manifests, prebuilt server package ਅਤੇ English/Punjabi documentation। **START-HERE.html** browser ਵਿੱਚ ਖੋਲ੍ਹੋ। ਆਪਣੇ actual passwords, tokens, database ਜਾਂ SSL private keys ZIP ਵਿੱਚ ਨਹੀਂ ਹਨ।

ਦੂਜਾ ਬੰਦਾ self-host ਕਰੇ ਤਾਂ ਉਸਨੂੰ ਆਪਣਾ domain, owner email, PostgreSQL ਅਤੇ mail setup ਕਰਨਾ ਪਵੇਗਾ। ਤੁਹਾਡਾ live endpoint ਹਾਲੇ owner-restricted ਹੈ। GitHub ’ਤੇ source ਰੱਖਣਾ ਅਤੇ ChatGPT public directory ਵਿੱਚ approve ਹੋਣਾ ਵੱਖਰੇ ਕਦਮ ਹਨ।
