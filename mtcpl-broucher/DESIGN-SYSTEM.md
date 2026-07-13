# MTCPL Design System

> A one-file brand manual for **Mateshwari Temple Construction Pvt. Ltd.** (MTCPL).
> Attach this file to any new Claude Design / Claude Code / Claude.ai session
> along with `/logo/logo-dark.png` — every new deliverable will stay on-brand.

---

## 1 · The Company

- **Legal name:** Mateshwari Temples Construction Pvt. Ltd.
- **Short name:** MTCPL
- **Founded:** 1971, by Mr. Mancharam Lohar
- **Home:** G-109, RIICO Industrial Area, Sirohi-Road, Distt. Sirohi, Rajasthan 307022
- **What we do:** Design, carving, CNC, restoration & installation of Hindu/Jain temples across India. Deity statues up to 100+ ft.
- **Scale:** 12+ lakh ft³ of stone carved · 100+ temples · 7+ states · 350+ craftsmen
- **Landmark project:** Shri Ram Janmabhoomi, Ayodhya (7+ lakh ft³ of sandstone)
- **Website:** mateshwaritemples.com
- **Email:** info@mateshwaritemples.com

## 2 · Leadership

| Role | Name | Phone |
|------|------|-------|
| Chairman (Founder) | Mr. Mancharam Lohar | — (through the MDs) |
| Managing Director · Operations | Mr. Naresh Lohar | +91 99292 77566 |
| Managing Director · Production | Mr. Rohit Lohar | +91 94143 74979 |

## 3 · Taglines

**Primary (English):**
> Preserving *Dharma*, through stone.

**Hindi slogan (always in Devanagari, never transliterated in print):**
> पत्थर से प्रतिमा तक

**Translation (only use as secondary caption):**
> "From stone to deity."

**Short mark:** *Since 1971* · **Long mark:** *India's House of Temple Craft · Since 1971*

**Sacred invocation (for opening pages):** ॥ श्री ॥

---

## 4 · Color Palette

```
GOLD
--gold           #C9973A   /* primary gold — foil, accents, italics */
--gold-light     #e0a840   /* hover / highlight */
--gold-deep      #a87a28   /* text-on-cream, deeper gold */

CREAM / IVORY (backgrounds)
--cream          #f5ede0
--cream-soft     #f7f4f0
--cream-warm     #f5eedd   /* cover bg */
--cream-radial-a #fcf7ec   /* center glow */
--cream-radial-b #ecdbb8   /* corner warmth */
--cream-radial-c #f4e7cc   /* opposite corner */

INK / BROWNS (typography)
--black          #0d0a07
--brown-1        #1a1510   /* primary headings */
--brown-2        #2a2018   /* body text */
--muted          #6b5d4b   /* captions, small labels */

STONE ACCENTS
--stone-tan      #d7b494
--stone-deep     #b8906a
```

### Rules of thumb
- **Cream is the canvas** — most pages are on cream, never pure white
- **Gold is used sparingly** — as italic accents in a heading, hairline rules, small ornaments, and the logo
- **Never fill large areas with gold** — it cheapens the look; use it as a jewel, not a paint
- **Two blacks are forbidden on covers** — user preference; keep to cream/gold
- **Ongoing/pipeline markers use olive-green `#7b8f5b`** — distinct from gold

---

## 5 · Typography

### Fonts (all Google Fonts)

| Role | Family | Weights we use |
|------|--------|----------------|
| **Display / headings** | Cormorant Garamond | 300, 400, 500 (plus italic variants) |
| **UI / small caps / labels** | Inter | 400, 500, 600 |
| **Hindi / Devanagari** | Noto Serif Devanagari | 400, 500 |

Google Fonts import (paste into `<head>` of any new project):
```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Noto+Serif+Devanagari:wght@400;500;600&display=swap" rel="stylesheet" />
```

### Typographic scale (print / A4)

| Role | Size | Font | Weight | Notes |
|------|------|------|--------|-------|
| Mega display (covers) | 44–94 pt | Cormorant | 300 | italic emphasis in `--gold` |
| H1 headings | 32–44 pt | Cormorant | 300 | `-0.012em` letter-spacing |
| H2 section | 26–32 pt | Cormorant | 300–400 | |
| H3 subheading | 18 pt | Cormorant | 400 | |
| Pull-quote | 13–14 pt | Cormorant | 400 italic | with 2px gold left border |
| Body serif | 10–11 pt | Cormorant | 400 | 1.55 line-height |
| Body sans | 8.5–10 pt | Inter | 400 | 1.6 line-height, `--muted` |
| Chapter label | 9 pt | Inter | 500–600 | `0.3em` letter-spacing, UPPERCASE, gold |
| Small caps / stats | 7–8 pt | Inter | 500–600 | `0.3em–0.42em` letter-spacing |
| Hindi body | 13–20 pt | Noto Serif Devanagari | 500 | **no letter-spacing** (breaks conjuncts) |
| Hindi display (cover) | 22–26 pt | Noto Serif Devanagari | 500 | small letter-spacing 0.08em max |

### Typographic rules
- **Italic gold** is the brand's signature move — one word per heading, never a whole sentence
- **UPPERCASE labels** always use Inter, letter-spaced 0.3em+
- **Devanagari must never have `letter-spacing > 0.08em`** — it breaks the matras
- **Numerals on stats** always in Cormorant italic/light, large and gold
- **Body copy** stays in one of two colors: `--brown-2` for long-form, `--muted` for captions

---

## 6 · Ornaments & motifs

1. **Gold corner brackets** (L-shapes, 18–24mm, 1px stroke) — on covers, quote pages, ceremonial pages
2. **Thin gold rules** (50pt × 2pt) as section dividers
3. **Hairline ornament row** — thin gold rule · small gold-filled diamond (rotated square) · thin gold rule
4. **Dotted gold row separators** in lists
5. **Faded italic gold quote mark** (`"`) as decorative pull-quote accent (38pt+, 22% opacity)
6. **॥ श्री ॥** sacred mark — only on opening pages or section dividers
7. **Gold ring monograms** — for team avatars without photos
8. **Paper-grain texture** — very subtle `repeating-linear-gradient` at 2–3% opacity over cream backgrounds

---

## 7 · Logo

File: `/public/logo/logo-dark.png`
Variant: `/public/logo/logo-light.png` (icon only — no wordmark)

- **Mandala**: 8-petal lotus + 4 divine figures inside petals, gold gradient
- **Wordmark**: Large bold "MTCPL" in deep brown/black

**Usage rules:**
- **Never resize below 30mm wide** on print (mandala detail gets lost)
- **Never change color** — always full gold
- **Always on cream background** — logo was designed for light backgrounds
- **Emboss effect** for premium feel:
  ```css
  filter:
    contrast(1.08)
    drop-shadow(0 1px 2px rgba(120,80,20,0.22))
    drop-shadow(0 0 14px rgba(201,151,58,0.16));
  ```

---

## 8 · Photography direction

- **Warm tones, slight saturation** (`saturate(1.02) contrast(1.03)` as default treatment)
- **Heroes** get a subtle dark vignette at bottom 30–40% so overlay type reads clean
- **Thumbnail grids** use 16:10 or 4:3 aspect ratios with 1px gold border at 25–30% opacity
- **Never apply a blue filter** — clashes with the warm palette
- Preferred subjects: stone being carved · masons at work · temple silhouettes at sunrise/sunset · CNC precision · finished shikhar details

---

## 9 · Brand voice

| Do | Don't |
|----|-------|
| Write like a reverent craftsman — quiet confidence | Corporate buzzwords (synergy, leverage, cutting-edge) |
| Use *shraddha · bhaav · dharma* where fitting | Over-translate; some words need to stay Sanskrit |
| Short, deliberate sentences with emotional weight | Long paragraphs of marketing copy |
| Numbers told with context (e.g. "7 L+ ft³ of sandstone from our Sirohi yard") | Raw stat dumps |
| Family-firm language ("our founder · our yard") | Third-person corporate ("the company offers") |

**Opening hook formula:** *"Preserving [something sacred], through [our craft]."*

**Sign-off formula:** *Since 1971* · *Sirohi · Rajasthan* · or *पत्थर से प्रतिमा तक*

---

## 10 · Page architecture (A4 print)

- Size: `210mm × 297mm`
- Standard padding: `18mm top · 22mm sides · 22mm bottom`
- Page-break: `page-break-after: always` on every `.page`
- Print rules: `@page { size: A4; margin: 0 }` + `color-adjust: exact`
- Page number footer: bottom-right, at `bottom: 10mm; right: 14mm` · 8pt Inter · `03 / 24` format
- Cover / back / section-dividers: **no page footer**

### Grid patterns used
- **Editorial split** — 100mm photo / 110mm text
- **2×3 card grid** — project showcase
- **4×5 thumbnail grid** — portfolio
- **Asymmetric mosaic** — 1 large + 2 small (facility page)
- **3-column** — team, leadership, contact footer
- **2×2 quadrant** — big numbers page

---

## 11 · Print & PDF export

- Always A4, margins 0, background graphics ON
- Use Chrome's print dialog → *Save as PDF*
- Gold `#C9973A` reproduces cleanly in CMYK
- Avoid pure black — use `--brown-1` (#1a1510) so it stays warm in print
- Minimum body text size: **9 pt**

---

## 12 · Standard starter prompt for a new deliverable

When starting any new MTCPL design in Claude Design or Claude Code, paste this first:

```
Brand: Mateshwari Temple Construction Pvt. Ltd. (MTCPL).
Founded 1971 in Sirohi, Rajasthan. India's leading temple construction firm.

I've attached DESIGN-SYSTEM.md (full brand manual) and logo-dark.png.
Use the Cormorant Garamond + Inter + Noto Serif Devanagari type stack,
cream (#f5eedd) backgrounds, gold (#C9973A) accents, and the reverent
family-firm brand voice described in the design system.

Today I want to build: [DESCRIBE THE ARTEFACT]

Follow the architecture rules in section 10 if it's print (A4, margin
padding, page break rules).
```

---

## 13 · Existing assets

All of these are already built — reuse/adapt where possible:

| Asset | Location |
|-------|----------|
| 24-page company brochure (Next.js) | `/Users/home/Documents/DEVELOPMENT/mtcpl-broucher/` |
| Logo (gold, dark variant — with wordmark) | `/public/logo/logo-dark.png` |
| Logo (icon only) | `/public/logo/logo-light.png` |
| Project photos (33 files) | `/public/images/` |
| India map SVG (detailed path) | `app/components/IndiaMap.tsx` |
| Temple silhouette SVG | inline in `app/components/Cover.tsx` |
| Global CSS design tokens | `app/globals.css` (top) |

---

## 14 · Upcoming deliverables (roadmap)

**Quick wins (Tier 1):**
- [ ] Tri-fold DL brochure
- [ ] Business cards (3)
- [ ] Letterhead + email signature
- [ ] Ram Mandir case-study 4-pager

**Client-facing (Tier 2):**
- [ ] Technical tender profile (~40 pg)
- [ ] Pitch deck (16×9, 15 slides)
- [ ] Executive one-pager
- [ ] Quote · Invoice · Completion Certificate templates

**Marketing (Tier 3):**
- [ ] mateshwaritemples.com redesign
- [ ] Instagram post kit (9 grid)
- [ ] Monthly newsletter
- [ ] LinkedIn carousel templates

**Event / ceremonial (Tier 4):**
- [ ] Pran-pratishtha invitation card
- [ ] Festival greeting kit (Diwali, Ram Navami, Mahashivratri)
- [ ] 55-year anniversary card

**Aspirational (Tier 5):**
- [ ] 100-page coffee-table monograph
- [ ] Annual report
- [ ] Awards application materials

---

*Document owner: MTCPL · Edition 1 · Edition kept alongside the 24-page Company Profile.*
