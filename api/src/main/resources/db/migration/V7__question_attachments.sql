-- Files a user attached to a question in Ask. Images are kept (base64) so a trainer
-- can view them in the queue; documents are extracted to text upstream (Tika) and the
-- extracted text is stored (and folded into the retrieval query at ask time).
-- 'kind' mirrors AttachmentConverter: image | text | unsupported.

CREATE TABLE question_attachment (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id    UUID NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    filename       TEXT NOT NULL,
    content_type   TEXT NOT NULL,
    kind           TEXT NOT NULL,            -- image | text | unsupported
    image          TEXT,                     -- base64 payload, for kind='image' (else null)
    extracted_text TEXT,                     -- for kind='text' (else null)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_question_attachment_question ON question_attachment (question_id);
