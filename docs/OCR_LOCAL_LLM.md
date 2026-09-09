# Talai — OCR with a local LLM (recommendation)

Decision A10 in `DECISIONS.md`: bills never leave the LAN; extraction runs on the
Ubuntu server. This note gives the engineering recommendation for doing that
well with a Gemma‑class model, and what to measure before trusting it.

## Recommendation in one paragraph

Run **Ollama** on the Ubuntu server and start with **Gemma 3** as the extraction
model, using Ollama's *structured outputs* (a JSON schema in the `format` field)
so the model can only answer in the shape Talai expects. Keep the model behind
the `OcrProvider` interface and treat the model name as configuration. Add a
deterministic post‑processing pass (dates, GSTIN checksum, arithmetic) and a
confidence gate that routes doubtful bills to **Needs Review**. Benchmark on 20
real bills before the pilot, and keep **Qwen2.5‑VL** as the first alternative if
Gemma's number reading is not good enough.

## Why Gemma 3 is a reasonable first choice

- It is multimodal (image in, text out) at 4B, 12B and 27B parameters, so a
  single model reads the bill image and fills the schema; no separate OCR engine.
- Ollama ships it with structured outputs, which turns "parse whatever the model
  said" into "validate a JSON document against `OcrResult`".
- Apache‑style open weights, runs fully offline, no per‑page cost.

Caveats you should expect:

- Vision LLMs are weaker at **long digit strings** (GSTINs, invoice numbers,
  amounts with many digits) than a dedicated OCR engine. This is why the
  post‑processing pass and the confidence gate exist.
- Dense tables (10+ line items) and low‑quality scans degrade accuracy
  noticeably; rasterise PDFs at 150–200 dpi and send one page per request.
- Self‑reported confidence is only loosely calibrated; combine it with the
  arithmetic check.

## Sizing on the Ubuntu server

| Setup | Model | Typical time per page | Notes |
|---|---|---|---|
| CPU only, 16 GB RAM | `gemma3:4b` | 30–90 s | Usable for a few bills a day; run OCR in the background (already designed that way) |
| GPU 8 GB VRAM (e.g. RTX 3060/4060) | `gemma3:4b` or `gemma3:12b` (Q4) | 3–15 s | 12B needs ~8–9 GB at Q4; may spill to CPU on an 8 GB card |
| GPU 12–16 GB VRAM | `gemma3:12b` | 2–8 s | Recommended sweet spot |
| GPU 24 GB VRAM | `gemma3:27b` | 4–12 s | Best accuracy; diminishing returns for invoices |

Install: `curl -fsSL https://ollama.com/install.sh | sh`, then
`ollama pull gemma3:12b` (or `gemma3:4b`). Ollama listens on 11434; keep it bound
to localhost since only the middleware calls it. `scripts/check_ocr.py` verifies
reachability and that the model is pulled, then runs a sample extraction.

## Alternatives to keep in the back pocket

1. **Qwen2.5‑VL (7B)** via Ollama: in public document‑understanding benchmarks it
   generally reads tables and digits better than similarly sized general models.
   Same interface, one config change. Try it first if Gemma misreads amounts.
2. **Two‑stage pipeline**: a classical OCR engine (Tesseract, PaddleOCR or
   docTR) produces text with coordinates; a small text‑only LLM (Gemma 3 4B or
   Qwen 2.5 7B) maps that text to the schema. More moving parts, but digit
   accuracy is usually higher and it runs comfortably on CPU. Worth building if
   the benchmark below shows amount errors above ~5%.
3. **Specialised document models** (Donut, LayoutLM‑family fine‑tunes): higher
   ceiling, but need training data and MLOps we do not want in v1.

## Accuracy gate before the pilot (task T‑L09)

Collect 20 real purchase bills covering your main vendors. For each, compare the
extracted supplier, invoice number, invoice date, taxable value, GST and grand
total to the accountant's entry. Targets for go‑live:

- Grand total and invoice number exactly right on ≥ 90% of bills.
- No bill where a wrong value passed the confidence gate silently (false
  confidence). If that happens, raise `OCR_MIN_CONFIDENCE` or tighten the
  arithmetic check before widening use.

Record results in `docs/LAN_DEPLOYMENT.md` §8.

## How the pipeline is built (plan §3.10)

`upload → store file → background OCR → post‑process → attachment.ocr_result →
"Create bill from this file" → draft (needs_review when doubtful) → validation →
queue → push`. The model never writes to Tally; it only proposes a draft that a
person reviews.
