import Section from "../components/Section";

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <Section kicker="設計初衷" title="為什麼要做 fast edition">
        <div className="prose prose-stone max-w-none text-[15px] leading-7 text-ink-700">
          <p>
            原版 Have-House 把 PostgreSQL + FastAPI 部署在家用 NAS 上，
            雖然功能完整，但每次查詢都要打回家裡，受限於 HDD I/O 與家用上行頻寬。
            這個 fast edition 把「會被反覆讀取的聚合」全部預烘成靜態 JSON，
            從 CDN 端直接送到瀏覽器，<strong>讀取延遲只剩網路 RTT</strong>。
          </p>
          <p>
            它跟舊站獨立運作，不共享資料庫、不共享 ETL —— 你可以同時跑兩站，A/B 比較速度與功能。
          </p>
        </div>
      </Section>

      <Section kicker="架構" title="如何組成">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Pipeline (Python)">
            <ul className="text-sm leading-7 text-ink-600 list-disc pl-5">
              <li>從內政部 Open Data 抓季資料 ZIP</li>
              <li>解析<strong>全台 22 縣市</strong> CSV</li>
              <li>標準化民國年、中文層次、特殊交易註記</li>
              <li>用 pyarrow 寫 Parquet（zstd 壓縮）</li>
              <li>用 DuckDB 預烘聚合 → JSON</li>
            </ul>
          </Card>
          <Card title="Web (React + Vite)">
            <ul className="text-sm leading-7 text-ink-600 list-disc pl-5">
              <li>Tailwind 自訂主題（編輯部風格）</li>
              <li>Recharts 畫圖</li>
              <li>所有資料 = 直接 fetch /data/*.json</li>
              <li>無後端、無資料庫、無 cold start</li>
              <li>可選 Phase 2：DuckDB-WASM 客端跑 SQL</li>
            </ul>
          </Card>
        </div>
      </Section>

      <Section kicker="資料品質" title="排除哪些雜訊">
        <ul className="text-sm leading-7 text-ink-600 list-disc pl-5">
          <li>備註含親友、員工、債務、瑕疵、凶宅、受贈、急售等註記之單筆</li>
          <li>單價/坪 &lt; 1,000 元 或 &gt; 5,000,000 元</li>
          <li>建物面積 &lt; 20 平方公尺（疑似車位、雜項）</li>
          <li>租賃用獨立過濾：總價在 1,000~2,000,000 元區間</li>
        </ul>
      </Section>

      <Section kicker="法律" title="使用條款與免責">
        <p className="text-sm leading-7 text-ink-600">
          本站所有統計僅供參考，<strong>不構成購屋、投資、金融或不動產顧問建議</strong>。
          資料著作權屬內政部，請遵守該網站之開放資料使用條款。
          任何決策前請諮詢專業仲介、估價師或代書。
        </p>
      </Section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white p-5">
      <div className="label mb-2">{title}</div>
      {children}
    </div>
  );
}
