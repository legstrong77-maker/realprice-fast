# Realprice — fast edition（六都試行版）

> Have-House 的姊妹站。資料同源（內政部實價登錄 Open Data），但採「**預烘靜態 JSON + CDN 直送**」的快速架構：無後端、無資料庫、無 cold start。

```
泥鰍工具間/
├── Have-House/          ← 舊站，PostgreSQL on NAS（不動，繼續跑）
└── realprice-fast/      ← 本站
    ├── pipeline/        ← Python：MOI → Parquet → JSON 預烘
    │   ├── src/realprice/
    │   ├── requirements.txt
    │   └── data/        ← raw / parquet / snapshots (執行後產生)
    └── web/             ← React + Vite + Tailwind
        ├── src/
        └── public/data/ ← 從 pipeline sync 過來；前端直接 fetch
```

---

## 範圍與設計取捨

- 只處理**六都**（臺北、新北、桃園、臺中、臺南、高雄）— 涵蓋約 80% 流量、儲存成本最小
- 三類交易：**買賣 / 預售 / 租賃**
- 所有「會被反覆讀取的聚合」一次烘成 JSON：縣市總覽、鄉鎮排名、月度趨勢、動能、分位
- 「明細瀏覽」目前提供每縣市每類別最新 500 筆；之後可加 DuckDB-WASM 把整個 Parquet 載到瀏覽器跑 SQL
- UI 採**編輯部 / 研究機構**風（serif 標題、tabular mono 數字、低彩度配色）—— 跟 v1 的中控台美學區隔

---

## 快速跑通

### 1. 裝 pipeline 依賴

```powershell
cd realprice-fast\pipeline
python -m pip install -r requirements.txt
```

### 2. 抓資料 + 烘 Parquet + 烘 JSON + 同步到 web

```powershell
# 從 ROC 113 (2024) 起到最新一季
$env:PYTHONPATH = "src"
python -m realprice all --since 113
```

> ⚠️ 若碰到 SSL 驗證失敗（內政部主機偶爾憑證老舊）：
> ```powershell
> $env:REALPRICE_INSECURE_TLS = "1"
> ```
> 這會讓 httpx 略過憑證驗證。**僅對這個 public open-data 端點建議使用**，不要對其他 host 套用。

執行後資料夾長這樣：
```
pipeline/data/
├── raw/                        # 下載的 ZIP + 解壓 CSV
├── parquet/                    # sale-a.parquet, sale-f.parquet ...（共 18 個）
└── snapshots/                  # JSON 聚合
    ├── meta.json
    ├── county-summary.json
    ├── heatmap/{cc}-{dk}.json
    ├── momentum/{cc}-{dk}.json
    ├── distribution/{cc}-{dk}.json
    ├── district-monthly/{cc}-{district}-{dk}.json
    └── recent/{cc}-{dk}.json
```
**最後一步會把 snapshots/ 複製到 `web/public/data/`** — 前端直接從同源讀。

### 3. 跑前端

```powershell
cd ..\web
npm install        # 第一次
npm run dev
```

瀏覽器打開 http://127.0.0.1:5174。

### 4. 上線（之後再做）

最簡單：
- `npm run build` → `web/dist/`
- 把 `dist/` + `web/public/data/` 一起丟 **Cloudflare Pages**
- 或：把 `snapshots/` 上 R2、把 `dist/` 上 Pages，前端 `VITE_DATA_BASE` 指向 R2 自訂網域

預期速度：首頁、縣市頁、瀏覽頁皆 < 100 ms（CDN edge）。

---

## Pipeline 子指令

| 指令 | 用途 |
|---|---|
| `python -m realprice download --since 113` | 只下載 ZIP + 解壓，不解析 |
| `python -m realprice build --since 113` | 解析 + 寫 Parquet（依 `parquet/` 既存資料覆蓋） |
| `python -m realprice snapshot` | 從 Parquet 重新烘 JSON |
| `python -m realprice sync-web` | 把 snapshots 複製到 web/public/data |
| `python -m realprice all --since 113` | build + snapshot + sync-web |
| `python -m realprice ... --season 114S2` | 改成只處理單一季 |
| `python -m realprice latest` | 抓當期旬報 + 重 build/snapshot/sync（每旬跑一次最新） |
| `python -m realprice geocode --top-per-county 100` | 把每縣市熱門路段轉座標寫入 cache（Nominatim 1 req/s，每 100 條約 2 分鐘） |

---

## 資料品質規則（與舊站一致）

排除以下單筆，避免聚合被汙染：
- 備註含 `親友 / 員工 / 債務 / 瑕疵 / 凶宅 / 受贈 / 急售 / 急讓 / 受迫 / 特殊`
- 單價/坪 < 1,000 元 或 > 5,000,000 元
- 建物面積 < 20 平方公尺（疑似車位）
- 租賃用獨立規則：總價在 1,000~2,000,000 元

特殊交易仍會出現在 `recent/*.json`（瀏覽用），但統計類聚合一律排除。

---

## 為什麼這樣比 NAS 上的 PostgreSQL 快

| 維度 | Have-House (NAS) | realprice-fast |
|---|---|---|
| 儲存 | HDD + Postgres 索引 | Parquet（zstd）+ R2/Pages |
| 查詢 | 即時 SQL，每個請求要打 NAS | 預烘 JSON，從 CDN 邊緣讀 |
| 伺服器 RAM | 1 GB / DB 256 MB shared_buffers | **無伺服器** |
| Cold start | warmup + TTL cache，第一請求仍可能慢 | 不存在 cold start |
| 對外延遲 | NAS → Cloudflare Tunnel → CF 邊緣 | CF 邊緣（資料就在邊緣節點） |
| 月費 | NAS 電 + 網 | < $1（R2 存 + 流量） |

代價：
- 個人化、即時的「全表 ad-hoc 查詢」要嘛走 v1，要嘛之後加 DuckDB-WASM
- Pipeline 要排程觸發（每旬一次 cron 或 GitHub Actions 即可）

---

## 路線圖

- [x] Phase 1：六都，預烘 JSON
- [ ] Phase 2：DuckDB-WASM 整合，瀏覽頁支援任意過濾
- [ ] Phase 3：地圖（MapLibre + 鄉鎮 GeoJSON），熱力圖視覺化
- [ ] Phase 4：擴張到全 22 縣市
- [ ] Phase 5：GitHub Actions 自動排程跑 pipeline + push R2
- [ ] Phase 6：撿漏雷達、相似物件查詢（純前端 SQL）
- [ ] Phase 7：試算工具（房貸、可負擔、升息壓力、租 vs 買）

---

## 跟 Have-House (v1) 的關係

完全獨立，零耦合。v1 的 NAS Postgres 不需要動，本站不會碰它。
你可以同時跑兩個，做 A/B 比較；也可以隨時砍掉任一個。

## 法律

本站所有統計僅供參考，不構成購屋、投資、金融或不動產顧問建議。
資料著作權屬內政部，請遵守該網站開放資料使用條款。
