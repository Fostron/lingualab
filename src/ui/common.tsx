import { marked } from 'marked';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { displayWord, genderTag } from '../content';
import { t } from '../i18n';
import { getState } from '../store';
import { say, sayWord, speak } from '../tts';
import type { Sentence, Word } from '../types';

/** Attributes for text in the language being learned: its own lang, never machine-translated. */
export function tl() {
  return { lang: getState().course?.meta.target, translate: false };
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const p: Record<string, JSX.Element> = {
    speaker: (
      <path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" fill="currentColor" />
    ),
    turtle: (
      <path d="M4 14c0-3.9 3.6-7 8-7s8 3.1 8 7H4zm-1 1h18v1.5a1.5 1.5 0 0 1-1.5 1.5H18l-1 2h-2l1-2H8l1 2H7l-1-2H4.5A1.5 1.5 0 0 1 3 16.5V15zm18-4h1.5a1.5 1.5 0 0 1 0 3H21z" fill="currentColor" />
    ),
    mic: <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z" fill="currentColor" />,
    home: <path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3z" fill="currentColor" />,
    path: <path d="M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z" fill="currentColor" />,
    review: <path d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" fill="currentColor" />,
    book: <path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v16h12V4H6zm2 2h8v2H8zm0 4h8v2H8z" fill="currentColor" />,
    search: <path d="M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12z" fill="currentColor" />,
    chart: <path d="M4 20V10h3v10H4zm6 0V4h3v16h-3zm6 0v-7h3v7h-3z" fill="currentColor" />,
    gear: (
      <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.7 7.7 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.7a7.7 7.7 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.7 7.7 0 0 0 1.7 1l.4 2.6h4l.4-2.7a7.7 7.7 0 0 0 1.7-1l2.5 1 2-3.4L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" fill="currentColor" />
    ),
    close: <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z" fill="currentColor" />,
    dumbbell: <path d="M2 10h2V7h3v10H4v-3H2v-4zm20 0h-2V7h-3v10h3v-3h2v-4zM8 11h8v2H8z" fill="currentColor" />,
    check: <path d="m9 16.2-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z" fill="currentColor" />,
    lock: <path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z" fill="currentColor" />,
    globe: (
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4a14 14 0 0 1 1.9 4h-3.8A14 14 0 0 1 12 4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6A15.7 15.7 0 0 0 8.1 8zM12 20a14 14 0 0 1-1.9-4h3.8A14 14 0 0 1 12 20zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6a15.7 15.7 0 0 0 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z" fill="currentColor" />
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" class="icon">
      {p[name]}
    </svg>
  );
}

export function SpeakBtn({ text, audio, wa, slow, small }: { text: string; audio?: number; wa?: string; slow?: boolean; small?: boolean }) {
  const c = getState().course;
  if (!c) return null;
  return (
    <button
      type="button"
      class={`icon-btn ${small ? 'small' : ''}`}
      title={slow ? t().playSlow : 'Play'}
      onClick={(e) => {
        e.stopPropagation();
        if (wa) void sayWord(text, c.meta.tts, wa, { slow });
        else void say(text, c.meta.tts, audio, { slow });
      }}
    >
      <Icon name={slow ? 'turtle' : 'speaker'} size={small ? 16 : 22} />
    </button>
  );
}

/** Text input with a row of special characters for the target language. */
export function TargetInput(props: {
  value: string;
  onInput: (v: string) => void;
  onEnter: () => void;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  autoFocus?: boolean;
  lang?: string;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const c = getState().course;
  useEffect(() => {
    if (props.autoFocus !== false && !props.disabled) ref.current?.focus({ preventScroll: true });
  }, [props.disabled]);
  const insert = (ch: string) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart ?? props.value.length;
    const e = el.selectionEnd ?? props.value.length;
    const v = props.value.slice(0, s) + ch + props.value.slice(e);
    props.onInput(v);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + ch.length, s + ch.length);
    });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      props.onEnter();
    }
  };
  const common = {
    ref,
    value: props.value,
    disabled: props.disabled,
    placeholder: props.placeholder,
    lang: props.lang,
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    spellcheck: false,
    onInput: (e: Event) => props.onInput((e.target as HTMLInputElement).value),
    onKeyDown: onKey,
  };
  return (
    <div class="target-input">
      {props.multiline ? <textarea rows={2} {...(common as any)} /> : <input type="text" {...(common as any)} />}
      {!props.disabled && c && props.lang !== c.meta.ui && (
        <div class="chars">
          {c.meta.chars.map((ch) => (
            <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(ch)}>
              {ch}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sentence with tap-to-gloss words and optional highlight/blank. */
export function SentenceView({
  s,
  highlight,
  blank,
  blankContent,
  big,
}: {
  s: Sentence;
  highlight?: number;
  blank?: [number, number];
  blankContent?: ComponentChildren;
  big?: boolean;
}) {
  const c = getState().course!;
  const [open, setOpen] = useState<number | null>(null);
  const parts: JSX.Element[] = [];
  s.tk.forEach(([w, wid, sp], i) => {
    if (blank && i >= blank[0] && i < blank[0] + blank[1]) {
      if (i === blank[0]) parts.push(<span class="blank">{blankContent ?? '_____'}</span>);
      if (sp) parts.push(<span> </span>);
      return;
    }
    const word = wid ? c.wordById.get(wid) : undefined;
    parts.push(
      <span
        class={`tok ${word ? 'has' : ''} ${highlight === i ? 'hl' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (word) setOpen(open === i ? null : i);
        }}
      >
        {w}
        {open === i && word && (
          <span class="gloss-pop" onClick={(e) => e.stopPropagation()}>
            <b>{displayWord(word, c.meta.target)}</b> {genderTag(word) && <i>{genderTag(word)}</i>}
            <br />
            {word.tr}
          </span>
        )}
      </span>,
    );
    if (sp) parts.push(<span> </span>);
  });
  return (
    <span class={`sentence ${big ? 'big' : ''}`} lang={c.meta.target} translate={false}>
      {parts}
    </span>
  );
}

/** Grammar markdown with [[target phrases]] that can be clicked to hear them. */
export function Markdown({ md }: { md: string }) {
  const html = useMemo(() => {
    const lang = getState().course?.meta.target || '';
    const pre = md.replace(/\[\[([^\]]+)\]\]/g, (_, x) => `<span class="tl" tabindex="0" lang="${lang}" translate="no">${x}</span>`);
    return marked.parse(pre, { async: false, gfm: true }) as string;
  }, [md]);
  const c = getState().course;
  return (
    <div
      class="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest('.tl') as HTMLElement | null;
        if (el && c) void speak(el.textContent || '', c.meta.tts);
      }}
    />
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max ? Math.min(100, (100 * value) / max) : 0;
  return (
    <div class="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function WordLine({ w, onClick }: { w: Word; onClick?: () => void }) {
  const c = getState().course!;
  return (
    <div class={`word-line ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <SpeakBtn text={w.w} wa={w.wa} small />
      <span class="wl-target">{displayWord(w, c.meta.target)}</span>
      <span class="wl-tr">{w.tr}</span>
    </div>
  );
}

/** A small modal asking to confirm a decision (Esc or the backdrop cancels). */
export function ConfirmDialog({
  title,
  text,
  ok,
  cancel,
  danger,
  onOk,
  onCancel,
}: {
  title: string;
  text?: ComponentChildren;
  ok: string;
  cancel: string;
  danger?: boolean;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="modal-back" onClick={onCancel}>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // keep exercise shortcuts (Enter, 1–4) from reacting behind the dialog
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        <div class="ex-actions wrap">
          <button class="btn" onClick={onCancel} autoFocus>
            {cancel}
          </button>
          <button class={`btn ${danger ? 'danger' : 'primary'}`} onClick={onOk}>
            {ok}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Loading() {
  return <div class="loading">…</div>;
}
