# 背景圖生成指南（編輯紙本 / 精品財經誌風）

把生成好的圖**用下列檔名**放進這個資料夾（`web/public/img/`），網站會自動套用，**不需改任何程式**。
沒有放圖時，網站會 fallback 到程式生成的漸層底（仍然好看），所以可以慢慢補。

> 共同風格關鍵字（每張都建議帶）：
> `editorial photography, warm muted tones, ivory and brass palette, soft film grain,
> golden hour haze, refined, restrained, cinematic, desaturated, fine art —— NOT vivid, NOT saturated, NOT neon`
>
> 共同負面詞（negative prompt）：
> `text, watermark, logo, people faces, oversaturated, HDR, neon, cartoon, lens flare, low quality, distorted`

---

## 1. `hero-skyline.webp` 　★ 現在就會用到（首頁大圖）

- **尺寸 / 格式**：2400 × 1400 px，輸出 **WebP**（品質 ~80，目標 < 400 KB）
- **用在哪**：首頁最上方深色 Hero 的背景（會壓一層深色漸層 + 黃銅光，所以圖要偏暗、留白在上方）
- **生成提示詞（英文，建議直接用）**：

```
Aerial editorial photograph of a Taiwanese city skyline at golden hour,
dense low-rise residential blocks fading into hazy mountains, warm muted
ivory-and-brass color palette, soft late-afternoon light, gentle film grain,
cinematic and restrained, desaturated, generous empty sky in the upper-left
for text overlay, fine-art real-estate magazine cover aesthetic.
No text, no watermark, no people.
```

- **中文要點**：台灣都會天際線、黃昏暖光、低彩度、霧感、**畫面上半部留白**（要疊白色大標）、偏暗。

---

## （選用）之後想讓各頁更豐富，可再生這幾張，我再幫你接上：

### 2. `accent-buyer.webp` — 買方頁系（儀表板 / 估價 / 試算）
```
Close-up editorial still life of house keys and a folded paper floor plan on a
warm travertine surface, golden hour side light, ivory and brass tones, soft
film grain, shallow depth of field, restrained and elegant. No text, no people.
```
尺寸 1600×900 WebP。

### 3. `accent-seller.webp` — 賣方頁系（賣房估價 / 交易成本）
```
Editorial photograph of a sunlit modern Taiwanese apartment living room seen
from the doorway, warm neutral interior, brass fixtures, soft window light,
muted ivory palette, film grain, calm and premium. No text, no people.
```
尺寸 1600×900 WebP。

### 4. `accent-invest.webp` — 投資頁系（租金投報 / 社區同棟）
```
Top-down aerial of an orderly residential neighborhood grid at dusk, warm amber
streetlights just turning on, muted desaturated tones, brass-and-ink palette,
fine film grain, cinematic editorial real-estate aesthetic. No text, no people.
```
尺寸 1600×900 WebP。

---

## 小提醒
- 一律輸出 **WebP**（檔案小、載入快，符合本站 CDN 直送的設計）。可用線上工具或 `cwebp` 轉。
- 圖請偏**暗、低彩度**；Hero 會再壓深色遮罩，太亮的圖會讓白色大標看不清楚。
- 放好後本機 `npm run dev` 即可預覽；要上線就照常 `npm run build` + 部署。
