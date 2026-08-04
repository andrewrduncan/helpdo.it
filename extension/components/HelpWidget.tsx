import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { capturePageContext, type PageContext } from '../lib/context';
import { captureScreenshot } from '../lib/screenshot';
import { getAuth, isTrainer } from '../lib/auth';
import { clearTabTrain } from '../lib/trainSession';
import { startRecording, stopRecording, saveWalkthrough, resummarizeAnswer, setOnStep, type RecState } from '../lib/recorder';
import {
  startPlayback,
  armPlayback,
  startEditRecordPlayback,
  armEditRecordPlayback,
  startPreview,
  armPreview,
  playbackStartUrl,
  samePattern,
  pathHasParams,
  canStartHere,
  type PlayStep,
} from '../lib/playback';

type Mode = 'faq' | 'train';

/** Deep-link prefill for Train mode: the queued question's id + resolved text. */
interface InitialTrain {
  qid?: string;
  question?: string;
}

/** Deep-link prefill for EDIT mode: an existing entry loaded for editing. */
interface InitialEdit {
  knowledgeEntryId: string;
  question: string;
  answer: string;
  tags: string[];
  steps: Record<string, unknown>[];
  hasWalkthrough: boolean;
}

/** A suggested answer the user can click (mirrors the server's AnswerOption). */
interface AnswerOption {
  knowledgeEntryId: string;
  title: string;
  snippet: string;
  hasWalkthrough: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  files?: string[]; // names of files attached to this turn
  options?: AnswerOption[]; // suggested entries to choose from (rendered as bubbles)
  playable?: { knowledgeEntryId: string }; // a recorded walkthrough backs this answer → "Show me"
}

/** Wait two animation frames so a state change is painted before we screenshot. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/** Read a File to its base64 body (data-URL prefix stripped) for the background to re-upload. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Outcome of an ask, mirroring the server's AskResult record. */
interface AskResult {
  questionId: string;
  answered: boolean;
  answer: string | null;
  knowledgeEntryId: string | null;
  options?: AnswerOption[];
}

/** Build the assistant turn for an ask result: inline answer, bubbles, or a queued note. */
function assistantTurn(result?: AskResult): Message {
  if (!result || !result.answered) {
    return {
      role: 'assistant',
      text: "I don't have an answer for that yet — I've sent it to the team and they'll get back to you.",
    };
  }
  if (result.answer) {
    const opt = result.options?.[0];
    return {
      role: 'assistant',
      text: result.answer,
      playable: opt?.hasWalkthrough && result.knowledgeEntryId ? { knowledgeEntryId: result.knowledgeEntryId } : undefined,
    };
  }
  // Several relevant entries — offer them as clickable bubbles.
  return {
    role: 'assistant',
    text: 'Here are a few things that might help — pick one:',
    options: result.options ?? [],
  };
}

/** Turn a raw channel/runtime error into a clear user-facing message. */
function friendlyError(error: string): string {
  if (/NOT_CONFIGURED/.test(error)) {
    return 'No instance set yet — add your helpdo.it instance URL in the extension options.';
  }
  if (/context invalidated|message port closed|receiving end does not exist/i.test(error)) {
    return 'helpdo.it was updated — reload this page to reconnect.';
  }
  // UNREACHABLE, WebSocket/connection failures, etc. — the instance is configured
  // but the service didn't respond.
  return "Can't reach your helpdo.it instance — the service may be unavailable.";
}

/**
 * The in-page help widget: a floating launcher that opens a chat panel. Lives
 * inside a Shadow DOM (see entrypoints/content.tsx) so the host page's CSS
 * can't bleed in and ours can't leak out.
 */
export function HelpWidget({
  initialTrain,
  initialEdit,
  initialRecording,
}: {
  initialTrain?: InitialTrain;
  initialEdit?: InitialEdit;
  initialRecording?: RecState | null;
}) {
  // Arriving via a Train/Edit deep-link (or mid-recording after a reload) opens the
  // panel straight into Train mode, prefilled.
  const trainEntry = !!initialTrain || !!initialEdit || !!initialRecording?.recording;
  // Mid-recording (e.g. after a reload), keep the panel closed — the FAB is the stop button.
  const [open, setOpen] = useState(trainEntry && !initialRecording?.recording);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [context, setContext] = useState<PageContext | null>(
    trainEntry ? capturePageContext() : null,
  );
  // Briefly hides our widget so the page snapshot (sent for context, not shown in chat) is clean.
  const [capturing, setCapturing] = useState(false);
  // The assistant is "typing" — show the bouncing-dots indicator while we await a reply.
  const [pending, setPending] = useState(false);

  // When "Show me" is clicked off the walkthrough's start page, we ask to navigate first.
  // `parameterized` = the recorded start has an id (e.g. /order/<id>), so we must NOT
  // redirect to that specific recorded record.
  const [navPrompt, setNavPrompt] = useState<{
    steps: PlayStep[];
    url: string;
    path: string;
    parameterized: boolean;
  } | null>(null);

  // User attachments (FAQ mode) — gated by the instance's central toggle.
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const askInputRef = useRef<HTMLInputElement>(null);

  // Trainer affordances: a FAQ⇄Train toggle that only trainers/admins ever see.
  const [trainer, setTrainer] = useState(false);
  const [mode, setMode] = useState<Mode>(trainEntry ? 'train' : 'faq');
  const [trainQuestion, setTrainQuestion] = useState(initialEdit?.question ?? initialTrain?.question ?? '');
  const [trainAnswer, setTrainAnswer] = useState(initialEdit?.answer ?? '');
  const [trainStatus, setTrainStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Editing an existing entry (Edit/Retrain deep-link) — Save updates it in place.
  const [editing, setEditing] = useState(!!initialEdit);
  const [editKnowledgeId, setEditKnowledgeId] = useState<string | null>(initialEdit?.knowledgeEntryId ?? null);

  // Tags (autocomplete via the "tags" route) + recording controls.
  const [tags, setTags] = useState<string[]>(initialEdit?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [captureScreens, setCaptureScreens] = useState(initialRecording?.captureScreens ?? true);
  const [recording, setRecording] = useState(!!initialRecording?.recording);
  const [stepCount, setStepCount] = useState(initialRecording?.stepCount ?? 0);
  const [recError, setRecError] = useState<string | null>(null);
  // The AI-generated answer from the last finalized recording (read-only preview).
  const [recordedAnswer, setRecordedAnswer] = useState<string | null>(null);

  // Review-before-save: after Stop, the draft (captioned steps) is editable here.
  // In edit mode we open straight into the editor with the entry's steps.
  const [reviewing, setReviewing] = useState(!!initialEdit);
  const [reviewSteps, setReviewSteps] = useState<Record<string, unknown>[]>(initialEdit?.steps ?? []);
  const [walkthroughId, setWalkthroughId] = useState<string | null>(null);
  const [resummarizing, setResummarizing] = useState(false);
  // After a successful save: show a "saved" panel with "Train another" (resets the form).
  const [savedItem, setSavedItem] = useState(false);

  // Live step counter from the recorder.
  useEffect(() => {
    setOnStep((n) => setStepCount(n));
    return () => setOnStep(null);
  }, []);

  // When the panel opens in FAQ mode, focus the question box so the user can just type.
  // Small delay so the element is mounted/visible after the open transition.
  useEffect(() => {
    if (open && mode === 'faq') {
      const t = window.setTimeout(() => askInputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [open, mode]);

  // Discover whether this instance allows user attachments (central toggle).
  useEffect(() => {
    if (!open || !browser.runtime?.id) return;
    browser.runtime
      .sendMessage({ type: 'helpdoit:config' })
      .then((res: { attachmentsEnabled?: boolean } | undefined) =>
        setAttachmentsEnabled(!!res?.attachmentsEnabled),
      )
      .catch(() => setAttachmentsEnabled(false));
  }, [open]);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setAttachedFiles((prev) => [...prev, ...Array.from(list)]);
  }
  function removeFile(idx: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // Tag type-ahead (debounced), excluding already-selected tags.
  useEffect(() => {
    const q = tagInput.trim();
    if (!q || !browser.runtime?.id) {
      setTagSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = (await browser.runtime.sendMessage({
          type: 'helpdoit:tags',
          payload: { query: q },
        })) as { ok: boolean; tags?: string[] } | undefined;
        if (res?.ok) setTagSuggestions((res.tags ?? []).filter((s) => !tags.includes(s)));
      } catch {
        /* ignore */
      }
    }, 150);
    return () => clearTimeout(t);
  }, [tagInput, tags]);

  function addTag(name: string) {
    const t = name.trim();
    setTagInput('');
    setTagSuggestions([]);
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
  }
  function removeTag(name: string) {
    setTags((prev) => prev.filter((x) => x !== name));
  }

  async function startRec() {
    setRecError(null);
    setRecordedAnswer(null);
    try {
      const st = await startRecording({ questionId: initialTrain?.qid, captureScreens });
      setRecording(true);
      setStepCount(st.stepCount);
      setTrainStatus(null);
      setOpen(false); // get the panel out of the way; the FAB becomes the stop button
    } catch (e) {
      setRecError(e instanceof Error ? e.message : String(e));
    }
  }
  async function stopRec() {
    if (saving) return; // ignore extra clicks while the summarize is in flight
    setSaving(true);
    setRecordedAnswer(null);
    let r: Awaited<ReturnType<typeof stopRecording>> = { stepCount };
    try {
      r = await stopRecording({ question: trainQuestion.trim() });
    } catch {
      /* clear UI regardless */
    }
    setRecording(false);
    setSaving(false);
    setStepCount(r.stepCount);
    setOpen(true); // reopen the panel to review/save the recorded steps
    if (r.stepCount > 0 && r.walkthroughId) {
      // Enter review: the trainer edits captions/order + the answer, then Saves.
      let steps: Record<string, unknown>[] = [];
      try {
        steps = r.steps ? JSON.parse(r.steps) : [];
      } catch {
        steps = [];
      }
      setReviewSteps(steps);
      setWalkthroughId(r.walkthroughId);
      setTrainAnswer(r.answer ?? '');
      setReviewing(true);
      setTrainStatus(null);
    } else {
      setReviewing(false);
      setTrainStatus('No steps recorded — write the answer below, or record again.');
    }
  }

  // --- Review editor helpers (edit caption / reorder / delete a draft step) ---
  /** The step's own caption (empty when unset — the editor shows the fallback as a placeholder). */
  function stepCaption(step: Record<string, unknown>): string {
    return typeof step.caption === 'string' ? step.caption : '';
  }
  /** A greyed suggestion shown when no caption is set — the element's label, not a stored value. */
  function stepCaptionHint(step: Record<string, unknown>): string {
    const target = step.target as { name?: string; text?: string } | undefined;
    return target?.name || target?.text || String(step.type ?? 'step');
  }
  function setStepCaption(i: number, caption: string) {
    setReviewSteps((prev) => prev.map((s, j) => (j === i ? { ...s, caption } : s)));
  }
  function deleteStep(i: number) {
    setReviewSteps((prev) => prev.filter((_, j) => j !== i));
  }
  function moveStep(i: number, dir: -1 | 1) {
    setReviewSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function stepMode(step: Record<string, unknown>): string {
    const m = step.mode;
    return m === 'input' || m === 'pick' ? m : 'auto';
  }
  function setStepMode(i: number, mode: string) {
    setReviewSteps((prev) => prev.map((s, j) => (j === i ? { ...s, mode } : s)));
  }
  function setStepPrompt(i: number, prompt: string) {
    setReviewSteps((prev) => prev.map((s, j) => (j === i ? { ...s, prompt } : s)));
  }
  /** The default value for an input step (pre-filled at playback; blank = user must type). */
  function setStepValue(i: number, value: string) {
    setReviewSteps((prev) => prev.map((s, j) => (j === i ? { ...s, value } : s)));
  }

  /** A step's identity for dup detection — its selector, else accessible name/text. */
  function stepKey(step: Record<string, unknown>): string {
    const t = step.target as { selector?: string; name?: string; text?: string } | undefined;
    return (t?.selector || t?.name || t?.text || '').trim().toLowerCase();
  }
  /** Auto-flag #2: a step that targets the same element + type as the one before it. */
  function isLikelyDuplicate(i: number): boolean {
    if (i === 0) return false;
    const a = reviewSteps[i];
    const b = reviewSteps[i - 1];
    const key = stepKey(a);
    return key !== '' && key === stepKey(b) && a.type === b.type;
  }

  async function saveReviewed() {
    if (!walkthroughId || saving) return;
    setSaving(true);
    setTrainStatus(null);
    try {
      const res = await saveWalkthrough({
        walkthroughId,
        question: trainQuestion.trim(),
        tags,
        answer: trainAnswer.trim(),
        steps: JSON.stringify(reviewSteps),
      });
      setSaving(false);
      if (res.ok) {
        setReviewing(false);
        setRecordedAnswer(trainAnswer.trim());
        setSavedItem(true);
        setTrainStatus(
          `Saved to the knowledge base from ${reviewSteps.length} step${reviewSteps.length === 1 ? '' : 's'} — it can answer this now.`,
        );
      } else if (res.error === 'NOT_TRAINER') {
        setTrainStatus("You don't have permission to train.");
      } else {
        setTrainStatus(friendlyError(res.error ?? ''));
      }
    } catch (e) {
      setSaving(false);
      setTrainStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  }

  async function regenerateAnswer() {
    if (resummarizing || saving) return;
    setResummarizing(true);
    try {
      const res = await resummarizeAnswer({
        question: trainQuestion.trim(),
        steps: JSON.stringify(reviewSteps),
      });
      if (res.ok && res.answer) setTrainAnswer(res.answer);
    } catch {
      /* leave the answer as-is */
    } finally {
      setResummarizing(false);
    }
  }

  function discardReview() {
    setReviewing(false);
    setReviewSteps([]);
    setWalkthroughId(null);
    setTrainAnswer('');
    setTrainStatus('Discarded the recording.');
  }

  /** Preview the in-progress steps (animations + interactive pauses), then return to the editor. */
  async function previewSteps() {
    if (!editKnowledgeId || reviewSteps.length === 0) return;
    try {
      await browser.runtime.sendMessage({
        type: 'helpdoit:pending-edit-set',
        payload: {
          knowledgeEntryId: editKnowledgeId,
          question: trainQuestion,
          answer: trainAnswer,
          tags,
          steps: reviewSteps,
        },
      });
    } catch {
      return;
    }
    setOpen(false);
    playFromStart(reviewSteps as unknown as PlayStep[], startPreview, armPreview);
  }

  /** Record-from-here: play the steps up to N (to set the app state), then capture new
   *  steps that splice in after N. Persists the editor so it survives navigation. */
  async function recordFromStep(i: number) {
    if (!editKnowledgeId) return;
    try {
      await browser.runtime.sendMessage({
        type: 'helpdoit:editrec-arm',
        payload: {
          knowledgeEntryId: editKnowledgeId,
          question: trainQuestion,
          answer: trainAnswer,
          tags,
          steps: reviewSteps,
          insertIndex: i + 1,
        },
      });
    } catch {
      return;
    }
    setOpen(false); // get out of the way; the on-page bar drives from here
    playFromStart(
      reviewSteps.slice(0, i + 1) as unknown as PlayStep[],
      startEditRecordPlayback,
      armEditRecordPlayback,
    );
  }

  /**
   * Run a prefix/steps that must begin on the walkthrough's recorded start page. If we're
   * already on that page pattern (or the start is parameterized, so we can't safely jump to
   * the recorded id), run in place. Otherwise arm and navigate to the start page — the next
   * load's resume plays it. Mirrors "Show me"'s start-page handling.
   */
  function playFromStart(
    steps: PlayStep[],
    run: (s: PlayStep[]) => void,
    arm: (s: PlayStep[]) => void,
  ) {
    const startUrl = playbackStartUrl(steps);
    const startPath = startUrl ? new URL(startUrl).pathname : location.pathname;
    if (!startUrl || samePattern(location.pathname, startPath) || pathHasParams(startPath) || canStartHere(steps)) {
      run(steps);
      return;
    }
    arm(steps);
    window.location.assign(startUrl); // resume runs it once the start page loads
  }

  /** Save edits to an existing entry (Edit/Retrain) — updates it in place + re-indexes. */
  async function saveEdit() {
    if (!editKnowledgeId || saving) return;
    setSaving(true);
    setTrainStatus(null);
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'helpdoit:knowledge-update',
        payload: {
          knowledgeEntryId: editKnowledgeId,
          question: trainQuestion.trim(),
          answer: trainAnswer.trim(),
          tags,
          steps: JSON.stringify(reviewSteps),
        },
      })) as { ok: boolean; error?: string } | undefined;
      setSaving(false);
      if (res?.ok) {
        setReviewing(false);
        setEditing(false);
        setRecordedAnswer(trainAnswer.trim());
        setSavedItem(true);
        setTrainStatus('Saved your changes — the entry is updated and re-indexed.');
      } else if (res?.error === 'NOT_TRAINER') {
        setTrainStatus("You don't have permission to edit.");
      } else {
        setTrainStatus(friendlyError(res?.error ?? ''));
      }
    } catch (e) {
      setSaving(false);
      setTrainStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  }

  /** Clear the whole Train form to start a fresh item (after a save, no page refresh). */
  function resetTrain() {
    setSavedItem(false);
    setRecordedAnswer(null);
    setReviewing(false);
    setReviewSteps([]);
    setWalkthroughId(null);
    setEditing(false);
    setEditKnowledgeId(null);
    setTrainQuestion('');
    setTrainAnswer('');
    setTags([]);
    setTagInput('');
    setStepCount(0);
    setTrainStatus(null);
    setRecError(null);
    clearTabTrain(); // a deep-link prefill is consumed once; don't re-load it on reset
  }

  // Resolve the role from the stored app JWT once the panel opens (or immediately
  // for a deep-link). If a deep-link landed us in Train but the user isn't a
  // trainer, drop back to FAQ and forget the tab flag.
  useEffect(() => {
    if (!open || !browser.runtime?.id) return;
    getAuth()
      .then((auth) => {
        const ok = isTrainer(auth);
        setTrainer(ok);
        if (!ok && mode === 'train') {
          setMode('faq');
          clearTabTrain();
        }
      })
      .catch(() => setTrainer(false));
  }, [open]);

  /** Leave Train mode and forget the per-tab flag so a reload won't re-enter it. */
  function exitTrain() {
    setMode('faq');
    setTrainStatus(null);
    setReviewing(false);
    setRecordedAnswer(null);
    setSavedItem(false);
    setEditing(false);
    clearTabTrain();
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) setContext(capturePageContext());
  }

  async function saveTraining() {
    const q = trainQuestion.trim();
    const a = trainAnswer.trim();
    if (!q || !a || saving) return;
    setSaving(true);
    setTrainStatus(null);
    const ctx = capturePageContext();
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'helpdoit:train',
        payload: { question: q, answer: a, pageUrl: ctx.url, tags },
      })) as { ok: boolean; result?: { knowledgeEntryId: string }; error?: string } | undefined;
      if (res?.ok) {
        setRecordedAnswer(a);
        setSavedItem(true);
        setTrainStatus('Saved to the knowledge base — it can answer this now.');
      } else if (res?.error === 'NOT_TRAINER') {
        setTrainStatus("You don't have permission to train.");
      } else {
        setTrainStatus(friendlyError(res?.error ?? ''));
      }
    } catch (e) {
      setTrainStatus(friendlyError(e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    const q = question.trim();
    if (!q || capturing) return;
    const ctx = capturePageContext();
    setContext(ctx);
    setQuestion('');
    const files = attachedFiles;
    setAttachedFiles([]);

    // Hide our UI, let it paint, then snapshot the page underneath — kept for context
    // (sent to the API / shown to the trainer), NOT rendered in the chat.
    setCapturing(true);
    await nextPaint();
    const screenshot = await captureScreenshot();
    setCapturing(false);

    // Show the user's turn immediately, then the "typing" indicator.
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: q, files: files.map((f) => f.name) },
    ]);
    setPending(true);

    // Ask the API: the server retrieves from the knowledge corpus and either
    // answers, offers a few options, or queues. With attachments we go over HTTP
    // (multipart) since files are too large for an RSocket-over-WS frame.
    let turn: Message;
    // If the extension was reloaded/updated, this page's content script is
    // orphaned — talking to the background throws "Extension context invalidated".
    if (!browser.runtime?.id) {
      turn = { role: 'assistant', text: friendlyError('context invalidated') };
    } else {
      try {
        let res: { ok: boolean; result?: AskResult; error?: string } | undefined;
        if (files.length > 0 && attachmentsEnabled) {
          const encoded = await Promise.all(
            files.map(async (f) => ({ name: f.name, type: f.type, dataBase64: await fileToBase64(f) })),
          );
          res = (await browser.runtime.sendMessage({
            type: 'helpdoit:ask-files',
            payload: { text: q, pageUrl: ctx.url, pageContext: JSON.stringify(ctx), files: encoded },
          })) as typeof res;
        } else {
          res = (await browser.runtime.sendMessage({
            type: 'helpdoit:ask',
            payload: { text: q, pageUrl: ctx.url, pageContext: JSON.stringify(ctx) },
          })) as typeof res;
        }
        turn = res?.ok ? assistantTurn(res.result) : { role: 'assistant', text: friendlyError(res?.error ?? '') };
        // Unanswered → store the page snapshot on the question so the trainer (and the
        // AI, if it later resolves it) has the visual context. Fire-and-forget.
        if (res?.ok && res.result && !res.result.answered && screenshot) {
          browser.runtime
            .sendMessage({
              type: 'helpdoit:question-screenshot',
              payload: { questionId: res.result.questionId, image: screenshot },
            })
            .catch(() => {});
        }
      } catch (e) {
        turn = { role: 'assistant', text: friendlyError(e instanceof Error ? e.message : String(e)) };
      }
    }
    setPending(false);
    setMessages((prev) => [...prev, turn]);
  }

  /** User clicked a suggested option — fetch that entry's answer and show it. */
  async function chooseOption(opt: AnswerOption) {
    setMessages((prev) => [...prev, { role: 'user', text: opt.title }]);
    if (!browser.runtime?.id) {
      setMessages((prev) => [...prev, { role: 'assistant', text: friendlyError('context invalidated') }]);
      return;
    }
    setPending(true);
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'helpdoit:answer',
        payload: { knowledgeEntryId: opt.knowledgeEntryId },
      })) as
        | { ok: boolean; answer?: { answer?: string; hasWalkthrough?: boolean }; error?: string }
        | undefined;
      setPending(false);
      if (res?.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: res.answer?.answer || '(no answer)',
            playable: res.answer?.hasWalkthrough ? { knowledgeEntryId: opt.knowledgeEntryId } : undefined,
          },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', text: friendlyError(res?.error ?? '') }]);
      }
    } catch (e) {
      setPending(false);
      setMessages((prev) => [...prev, { role: 'assistant', text: friendlyError(e instanceof Error ? e.message : String(e)) }]);
    }
  }

  /** User clicked "Show me" — fetch the recorded steps, hide the panel, and play them. */
  async function showMe(knowledgeEntryId: string) {
    if (!browser.runtime?.id) return;
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'helpdoit:walkthrough-steps',
        payload: { knowledgeEntryId },
      })) as { ok: boolean; result?: { steps?: string } } | undefined;
      let steps: PlayStep[] = [];
      try {
        const raw = res?.ok ? res.result?.steps : undefined;
        steps = raw ? (JSON.parse(raw) as PlayStep[]) : [];
      } catch {
        steps = [];
      }
      if (steps.length === 0) return;
      // Play in place when the walkthrough can start here — either the page pattern matches
      // the recorded start (ids wildcarded, so /order/<recorded-id> matches /order/<their-id>),
      // OR its first control is already present on this page (e.g. a global search box that
      // lives on several pages). Only navigate when the entry control genuinely isn't here.
      const startUrl = playbackStartUrl(steps);
      const startPath = startUrl ? new URL(startUrl).pathname : location.pathname;
      if (!startUrl || samePattern(location.pathname, startPath) || canStartHere(steps)) {
        setOpen(false); // get the panel out of the way so the user can watch the page
        startPlayback(steps);
        return;
      }
      // Different page structure — ask to navigate. If the recorded start is
      // parameterized (e.g. a specific order id), don't offer to open that stale
      // record; tell the user to open the relevant item first.
      setNavPrompt({ steps, url: startUrl, path: startPath, parameterized: pathHasParams(startPath) });
    } catch {
      /* ignore — playback is best-effort */
    }
  }

  /** Confirmed the navigate prompt: arm playback, then go to the start page (resume runs it). */
  function goToStartAndPlay() {
    const p = navPrompt;
    if (!p) return;
    setNavPrompt(null);
    armPlayback(p.steps);
    window.location.assign(p.url);
  }

  /** Play on the current page anyway (e.g. the user is on the right kind of page already). */
  function playHere() {
    const p = navPrompt;
    if (!p) return;
    setNavPrompt(null);
    setOpen(false);
    startPlayback(p.steps);
  }

  return (
    <div className={`helpdoit-root${capturing ? ' helpdoit-capturing' : ''}`}>
      {open && (
        <div className="helpdoit-panel" role="dialog" aria-label="helpdo.it help">
          <header className="helpdoit-header">
            <span className="helpdoit-title">helpdo.it</span>
            {trainer && (
              <div className="helpdoit-modes" role="tablist" aria-label="Mode">
                <button
                  role="tab"
                  aria-selected={mode === 'faq'}
                  className={`helpdoit-mode${mode === 'faq' ? ' is-active' : ''}`}
                  onClick={exitTrain}
                >
                  FAQ
                </button>
                <button
                  role="tab"
                  aria-selected={mode === 'train'}
                  className={`helpdoit-mode${mode === 'train' ? ' is-active' : ''}`}
                  onClick={() => {
                    setMode('train');
                    setTrainStatus(null);
                  }}
                >
                  Train
                </button>
              </div>
            )}
            <button
              className="helpdoit-close"
              onClick={() => setOpen(false)}
              aria-label="Close help"
            >
              ×
            </button>
          </header>

          {context && (
            <div className="helpdoit-context">
              <span className="helpdoit-ctx-label">On this page</span>
              <span className="helpdoit-ctx-title">{context.title || context.url}</span>
              <span className="helpdoit-ctx-url">{context.path}</span>
            </div>
          )}

          {mode === 'faq' ? (
            <>
              <div className="helpdoit-messages">
                {messages.length === 0 ? (
                  <div className="helpdoit-empty">Ask how to do something on this page.</div>
                ) : (
                  messages.map((m, i) => (
                    <div key={i} className={`helpdoit-msg helpdoit-msg-${m.role}`}>
                      {m.text}
                      {m.options && m.options.length > 0 && (
                        <div className="helpdoit-options">
                          {m.options.map((o) => (
                            <button
                              key={o.knowledgeEntryId}
                              type="button"
                              className="helpdoit-option"
                              onClick={() => chooseOption(o)}
                              title={o.snippet}
                            >
                              {o.title}
                              {o.hasWalkthrough && <span className="helpdoit-option-play"> ▶</span>}
                            </button>
                          ))}
                        </div>
                      )}
                      {m.files && m.files.length > 0 && (
                        <div className="helpdoit-msg-files">
                          {m.files.map((name, j) => (
                            <span key={j} className="helpdoit-file-chip">
                              📎 {name}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.playable && (
                        <div className="helpdoit-showme-wrap">
                          <button
                            type="button"
                            className="helpdoit-showme"
                            onClick={() => showMe(m.playable!.knowledgeEntryId)}
                          >
                            ▶ Show me how
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
                {pending && (
                  <div className="helpdoit-msg helpdoit-msg-assistant helpdoit-typing" aria-label="Finding an answer">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                )}
              </div>

              {navPrompt && (
                <div className="helpdoit-navprompt">
                  {navPrompt.parameterized ? (
                    <>
                      <span>
                        This walkthrough was recorded on a specific page (like{' '}
                        <strong>{navPrompt.path}</strong>). Open the relevant item first, then run
                        Show me — or play it here anyway.
                      </span>
                      <div className="helpdoit-navprompt-actions">
                        <button type="button" className="helpdoit-navprompt-no" onClick={() => setNavPrompt(null)}>
                          Got it
                        </button>
                        <button type="button" onClick={playHere}>
                          Play here anyway
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span>
                        This walkthrough starts on <strong>{navPrompt.path}</strong>. Go there to play it?
                      </span>
                      <div className="helpdoit-navprompt-actions">
                        <button type="button" className="helpdoit-navprompt-no" onClick={() => setNavPrompt(null)}>
                          Not now
                        </button>
                        <button type="button" onClick={goToStartAndPlay}>
                          Take me there
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {attachedFiles.length > 0 && (
                <div className="helpdoit-attachments">
                  {attachedFiles.map((f, i) => (
                    <span key={i} className="helpdoit-file-chip">
                      📎 {f.name}
                      <button type="button" onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="helpdoit-input">
                {attachmentsEnabled && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className="helpdoit-attach"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={capturing}
                      aria-label="Attach a file"
                      title="Attach a file"
                    >
                      📎
                    </button>
                  </>
                )}
                <input
                  ref={askInputRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') send();
                  }}
                  placeholder="Help me…"
                  aria-label="Your question"
                />
                <button onClick={send} disabled={capturing}>
                  {capturing ? '…' : 'Ask'}
                </button>
              </div>

              <footer className="helpdoit-footer">
                Answers come from your team's knowledge base — unmatched questions are queued for them.
              </footer>
            </>
          ) : (
            <div className="helpdoit-train">
              {savedItem ? (
                <div className="helpdoit-recorded">
                  <span className="helpdoit-recorded-label">✓ Saved to the knowledge base</span>
                  {recordedAnswer && <div className="helpdoit-recorded-answer">{recordedAnswer}</div>}
                  <div className="helpdoit-train-actions">
                    <button onClick={resetTrain}>+ Train another</button>
                  </div>
                </div>
              ) : (
                <>
                  <label className="helpdoit-field">
                    <span>Help users…</span>
                    <input
                      value={trainQuestion}
                      onChange={(e) => setTrainQuestion(e.target.value)}
                      placeholder="e.g. start a new order"
                      aria-label="Help users with"
                      disabled={recording}
                    />
                  </label>

              <label className="helpdoit-field">
                <span>Tags</span>
                <div className="helpdoit-tags">
                  {tags.map((t) => (
                    <span key={t} className="helpdoit-tag">
                      {t}
                      <button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}>
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagInput.trim()) {
                        e.preventDefault();
                        addTag(tagInput);
                      }
                    }}
                    placeholder={tags.length ? 'Add another…' : 'Add tags…'}
                    aria-label="Add tags"
                  />
                </div>
                {tagSuggestions.length > 0 && (
                  <div className="helpdoit-tag-suggest">
                    {tagSuggestions.map((s) => (
                      <button type="button" key={s} onClick={() => addTag(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </label>

              {!reviewing && (
                <>
                  <div className="helpdoit-record">
                    <label className="helpdoit-check">
                      <input
                        type="checkbox"
                        checked={captureScreens}
                        disabled={recording}
                        onChange={(e) => setCaptureScreens(e.target.checked)}
                      />
                      Capture screenshots
                    </label>
                    {!recording ? (
                      <button
                        className="helpdoit-record-btn"
                        onClick={startRec}
                        disabled={!trainQuestion.trim()}
                        title={!trainQuestion.trim() ? 'Enter the question first' : 'Start recording your clicks'}
                      >
                        ● Record
                      </button>
                    ) : saving ? (
                      <button className="helpdoit-record-btn is-saving" disabled aria-busy="true">
                        Summarizing…
                      </button>
                    ) : (
                      <button className="helpdoit-record-btn is-recording" onClick={stopRec}>
                        ■ Stop · {stepCount} step{stepCount === 1 ? '' : 's'}
                      </button>
                    )}
                  </div>
                  {recording && !saving && (
                    <div className="helpdoit-train-status">
                      Recording — click through the steps on the page. Page changes are tracked
                      automatically.
                    </div>
                  )}
                  {recording && saving && (
                    <div className="helpdoit-train-status" aria-busy="true">
                      Summarizing the steps with AI — this can take up to a minute…
                    </div>
                  )}
                </>
              )}
              {recError && <div className="helpdoit-train-status error">{recError}</div>}

              {reviewing ? (
                <div className="helpdoit-review">
                  <span className="helpdoit-recorded-label">
                    {editing
                      ? reviewSteps.length > 0
                        ? `Editing — adjust the steps (${reviewSteps.length}), tags, or answer`
                        : 'Editing — adjust the tags or answer'
                      : `Review the steps (${reviewSteps.length}) — edit a label, reorder, or remove any`}
                  </span>
                  {reviewSteps.length > 0 && (
                    <ol className="helpdoit-steps">
                      {reviewSteps.map((s, i) => (
                        <li key={i} className={`helpdoit-step${isLikelyDuplicate(i) ? ' is-dup' : ''}`}>
                          <div className="helpdoit-step-row">
                            {isLikelyDuplicate(i) && (
                              <span className="helpdoit-dup" title="Looks like a duplicate of the previous step">⚠</span>
                            )}
                            <input
                              className="helpdoit-step-caption"
                              value={stepCaption(s)}
                              placeholder={stepCaptionHint(s)}
                              onChange={(e) => setStepCaption(i, e.target.value)}
                              aria-label={`Step ${i + 1} label`}
                            />
                            <div className="helpdoit-step-actions">
                              <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                              <button type="button" onClick={() => moveStep(i, 1)} disabled={i === reviewSteps.length - 1} aria-label="Move down">↓</button>
                              {editing && (
                                <button
                                  type="button"
                                  onClick={() => recordFromStep(i)}
                                  title="Play up to here, then record new steps from this point"
                                  aria-label="Record from here"
                                >
                                  ⦿
                                </button>
                              )}
                              <button type="button" onClick={() => deleteStep(i)} aria-label="Remove step">×</button>
                            </div>
                          </div>
                          <div className="helpdoit-step-mode">
                            <select
                              value={stepMode(s)}
                              onChange={(e) => setStepMode(i, e.target.value)}
                              aria-label={`Step ${i + 1} behavior`}
                            >
                              <option value="auto">Do it automatically</option>
                              <option value="input">Ask the user to type</option>
                              <option value="pick">Let the user choose</option>
                            </select>
                            {stepMode(s) !== 'auto' && (
                              <input
                                className="helpdoit-step-prompt"
                                value={typeof s.prompt === 'string' ? s.prompt : ''}
                                onChange={(e) => setStepPrompt(i, e.target.value)}
                                placeholder={stepMode(s) === 'input' ? 'e.g. Type the product you want' : 'e.g. Click Start Order for your item'}
                                aria-label={`Step ${i + 1} prompt`}
                              />
                            )}
                            {stepMode(s) === 'input' && (
                              <input
                                className="helpdoit-step-prompt"
                                value={typeof s.value === 'string' ? s.value : ''}
                                onChange={(e) => setStepValue(i, e.target.value)}
                                placeholder="Default value (optional)"
                                title="Used only if the user clicks Continue without typing. Leave blank to require the user to type before continuing."
                                aria-label={`Step ${i + 1} default value`}
                              />
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  <label className="helpdoit-field">
                    <span className="helpdoit-answer-head">
                      Answer
                      {reviewSteps.length > 0 && (
                        <button
                          type="button"
                          className="helpdoit-regen"
                          onClick={regenerateAnswer}
                          disabled={resummarizing || saving}
                          title="Rewrite the answer from the step labels above"
                        >
                          {resummarizing ? 'Regenerating…' : '↻ Regenerate from steps'}
                        </button>
                      )}
                    </span>
                    <textarea
                      value={trainAnswer}
                      onChange={(e) => setTrainAnswer(e.target.value)}
                      rows={5}
                      aria-label="Answer"
                    />
                  </label>
                  <div className="helpdoit-train-actions">
                    <button
                      className="helpdoit-discard"
                      type="button"
                      onClick={editing ? resetTrain : discardReview}
                      disabled={saving}
                    >
                      {editing ? 'Cancel' : 'Discard'}
                    </button>
                    {editing && reviewSteps.length > 0 && (
                      <button
                        className="helpdoit-preview"
                        type="button"
                        onClick={previewSteps}
                        disabled={saving}
                        title="Watch it play through (with the input/pick pauses), then come back here"
                      >
                        ▶ Preview
                      </button>
                    )}
                    <button onClick={editing ? saveEdit : saveReviewed} disabled={saving || !trainQuestion.trim()}>
                      {saving ? 'Saving…' : editing ? 'Save changes' : 'Save walkthrough'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="helpdoit-or">or write the answer yourself</div>
                  <label className="helpdoit-field">
                    <span>Answer</span>
                    <textarea
                      value={trainAnswer}
                      onChange={(e) => setTrainAnswer(e.target.value)}
                      placeholder="Write the answer the assistant should give…"
                      rows={4}
                      aria-label="Answer"
                      disabled={recording}
                    />
                  </label>
                  <div className="helpdoit-train-actions">
                    <button
                      onClick={saveTraining}
                      disabled={saving || recording || !trainQuestion.trim() || !trainAnswer.trim()}
                    >
                      {saving ? 'Saving…' : 'Save to knowledge base'}
                    </button>
                  </div>
                </>
              )}
                </>
              )}
              {trainStatus && <div className="helpdoit-train-status">{trainStatus}</div>}

              <footer className="helpdoit-footer">
                Training for <strong>{context?.path || 'this page'}</strong>.
              </footer>
            </div>
          )}
        </div>
      )}

      <button
        className={`helpdoit-fab${recording ? ' is-recording' : ''}`}
        onClick={recording ? stopRec : toggle}
        aria-label={recording ? 'Stop recording' : open ? 'Close helpdo.it help' : 'Open helpdo.it help'}
        title={recording ? 'Stop recording' : undefined}
      >
        {recording ? '■' : open ? '×' : '?'}
      </button>
    </div>
  );
}
