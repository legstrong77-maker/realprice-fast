# Pipeline

```powershell
cd realprice-fast\pipeline
python -m pip install -r requirements.txt

$env:PYTHONPATH = "src"
python -m realprice all --since 113
```

碰到 SSL 驗證失敗時：
```powershell
$env:REALPRICE_INSECURE_TLS = "1"
```

詳見上層 [../README.md](../README.md)。
