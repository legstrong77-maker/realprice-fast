# Web

```powershell
cd realprice-fast\web
npm install
npm run dev      # http://127.0.0.1:5174
npm run build    # 產 dist/
```

資料來源：`/data/*.json`（dev 時 vite 直接 serve `public/data/`）。
資料先用 [../pipeline](../pipeline) 產生：
```powershell
cd ..\pipeline
$env:PYTHONPATH = "src"
python -m realprice all --since 113
```

部署：把 `dist/` + `public/data/` 一起丟 Cloudflare Pages，或前端走 `VITE_DATA_BASE` 指向 R2。
