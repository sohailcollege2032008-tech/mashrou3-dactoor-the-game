"""
Dactoor Question Processor — Cloud Run Service
Accepts a file (PDF / PPTX / DOCX / image), sends it to Gemini,
returns a structured JSON question bank ready to save to Firestore.
"""

import json
import logging
import os
import tempfile
import time

import google.generativeai as genai
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
API_SECRET     = os.environ.get("API_SECRET", "")      # optional shared secret
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
MODEL_NAME      = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

genai.configure(api_key=GEMINI_API_KEY)

# ── FastAPI ────────────────────────────────────────────────────────────────────
app = FastAPI(title="Dactoor Processor", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── System Prompt ──────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are a medical exam question extractor. You receive a document \
(PDF, PPTX, DOCX, image, etc.) that contains multiple-choice questions (MCQs).

Your task is to extract ALL questions from the document and return them in \
this EXACT JSON format. Return ONLY valid JSON, no markdown, no explanation.

{
  "title": "<infer a title from the document content>",
  "questions": [
    {
      "id": 1,
      "question": "<the question text in its original language>",
      "question_ar": "<Arabic version if the original is in Arabic, otherwise null>",
      "choices": ["<choice A>", "<choice B>", "<choice C>", "<choice D>"],
      "correct": <0-indexed position of the correct answer>,
      "time_limit": 20,
      "needs_image": false,
      "image_url": null
    }
  ]
}

RULES:
1. Extract every single MCQ from the document — do not skip any.
2. The "correct" field must be the 0-based index of the correct answer in the choices array.
3. If the correct answer is marked/highlighted/bolded/starred, use that. If no answer is marked, set "correct" to -1.
4. If the question is in Arabic, put it in both "question" and "question_ar". If in English, put in "question" only and set "question_ar" to null.
5. Preserve the original wording of questions and choices exactly as written.
6. If choices are labeled A/B/C/D or 1/2/3/4, remove the labels and just keep the text.
7. Set time_limit to 20 for normal questions, 30 for long/complex ones, 10 for simple recall.
8. Set "needs_image" to true if the question refers to a figure, image, photograph, diagram, \
graph, table, or any visual element that is required to answer correctly. Set to false otherwise.
9. Return ONLY the JSON object. No markdown backticks, no commentary.\
"""

# ── MIME type map ──────────────────────────────────────────────────────────────
EXT_TO_MIME = {
    "pdf":  "application/pdf",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "ppt":  "application/vnd.ms-powerpoint",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc":  "application/msword",
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
    "png":  "image/png",
    "gif":  "image/gif",
    "webp": "image/webp",
    "bmp":  "image/bmp",
}

# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}

# ── Main endpoint ──────────────────────────────────────────────────────────────
@app.post("/process")
async def process_file(
    file: UploadFile = File(...),
    x_api_secret: str | None = Header(None, alias="x-api-secret"),
):
    # ── Auth check ─────────────────────────────────────────────────────────────
    if API_SECRET and x_api_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized — invalid x-api-secret header")

    # ── Read file ──────────────────────────────────────────────────────────────
    content = await file.read()
    filename = file.filename or "document"
    mime_type = file.content_type or "application/octet-stream"
    size_kb = len(content) / 1024

    log.info(f"Received: {filename}  {mime_type}  {size_kb:.1f} KB")

    if len(content) > 150 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 150 MB)")

    # Fix generic MIME from extension
    if mime_type in ("application/octet-stream", "binary/octet-stream"):
        ext = filename.rsplit(".", 1)[-1].lower()
        mime_type = EXT_TO_MIME.get(ext, mime_type)

    ext_suffix = ("." + filename.rsplit(".", 1)[-1]) if "." in filename else ""
    uploaded_file = None
    tmp_path = None

    try:
        # ── Write to temp file ─────────────────────────────────────────────────
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext_suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        # ── Upload to Gemini Files API ─────────────────────────────────────────
        log.info("Uploading to Gemini Files API…")
        uploaded_file = genai.upload_file(tmp_path, mime_type=mime_type, display_name=filename)

        # Wait until the file is ACTIVE (usually instant for PDFs/images)
        poll = 0
        while uploaded_file.state.name == "PROCESSING" and poll < 90:
            time.sleep(2)
            uploaded_file = genai.get_file(uploaded_file.name)
            poll += 1
            log.info(f"  still processing… ({poll * 2}s)")

        if uploaded_file.state.name != "ACTIVE":
            raise HTTPException(
                status_code=500,
                detail=f"Gemini file processing failed (state={uploaded_file.state.name})"
            )

        # ── Generate content ───────────────────────────────────────────────────
        log.info("Calling Gemini generate_content…")
        model = genai.GenerativeModel(MODEL_NAME)
        response = model.generate_content([SYSTEM_PROMPT, uploaded_file])
        raw_text = response.text

        # ── Parse JSON ─────────────────────────────────────────────────────────
        cleaned = raw_text.strip()
        # Strip markdown fences if present
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            cleaned = "\n".join(lines[1:])          # remove first fence line
            if cleaned.rstrip().endswith("```"):
                cleaned = cleaned.rstrip()[:-3]     # remove trailing fence
        cleaned = cleaned.strip()

        data = json.loads(cleaned)

        if not isinstance(data.get("title"), str) or not isinstance(data.get("questions"), list):
            raise HTTPException(status_code=422, detail="AI returned unexpected JSON structure")

        if len(data["questions"]) == 0:
            raise HTTPException(status_code=422, detail="AI found no questions in the document")

        # Re-sequence IDs
        data["questions"] = [
            {**q, "id": i + 1}
            for i, q in enumerate(data["questions"])
        ]

        log.info(f"Success — extracted {len(data['questions'])} questions from {filename}")
        return data

    except json.JSONDecodeError as exc:
        snippet = raw_text[:400] if "raw_text" in dir() else "(no text)"
        log.error(f"JSON parse error: {exc}\nSnippet: {snippet}")
        raise HTTPException(
            status_code=422,
            detail=f"AI returned invalid JSON: {exc}. Make sure the file contains MCQ questions."
        )

    except HTTPException:
        raise

    except Exception as exc:
        log.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=str(exc))

    finally:
        # Clean up temp file
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        # Delete from Gemini Files API (they auto-expire after 48h, but clean up anyway)
        if uploaded_file:
            try:
                genai.delete_file(uploaded_file.name)
            except Exception:
                pass
