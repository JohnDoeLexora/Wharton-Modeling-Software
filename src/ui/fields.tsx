import { useEffect, useState } from "react";
import { formatNumberInput, formatRateInput } from "./format";

function useDraft(value: string) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  return { text, setText, focused, setFocused };
}

export function PercentField({
  label,
  value,
  onChange,
  hint,
  bare = false,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  hint?: string;
  bare?: boolean;
}) {
  const draft = useDraft(formatRateInput(value));
  return (
    <label className={bare ? "field bare" : "field"}>
      <span className={bare ? "sr-only" : undefined}>{label}</span>
      <span className="entry">
        <input
          inputMode="decimal"
          value={draft.text}
          aria-label={label}
          onFocus={() => draft.setFocused(true)}
          onBlur={() => {
            draft.setFocused(false);
            const parsed = Number(draft.text);
            if (Number.isFinite(parsed)) onChange(parsed / 100);
            else draft.setText(formatRateInput(value));
          }}
          onChange={(event) => {
            draft.setText(event.target.value);
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed / 100);
          }}
        />
        <span className="suffix">%</span>
      </span>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  suffix,
  step = "0.01",
  bare = false,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  hint?: string;
  suffix?: string;
  step?: string;
  bare?: boolean;
}) {
  const draft = useDraft(formatNumberInput(value));
  return (
    <label className={bare ? "field bare" : "field"}>
      <span className={bare ? "sr-only" : undefined}>{label}</span>
      <span className="entry">
        <input
          inputMode="decimal"
          step={step}
          value={draft.text}
          aria-label={label}
          onFocus={() => draft.setFocused(true)}
          onBlur={() => {
            draft.setFocused(false);
            const parsed = Number(draft.text);
            if (Number.isFinite(parsed)) onChange(parsed);
            else draft.setText(formatNumberInput(value));
          }}
          onChange={(event) => {
            draft.setText(event.target.value);
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
        />
        {suffix ? <span className="suffix">{suffix}</span> : null}
      </span>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function DollarField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  hint?: string;
}) {
  const draft = useDraft(formatNumberInput(value));
  return (
    <label className="field">
      <span>{label}</span>
      <span className="entry">
        <span className="prefix">$</span>
        <input
          inputMode="decimal"
          value={draft.text}
          aria-label={label}
          onFocus={() => draft.setFocused(true)}
          onBlur={() => {
            draft.setFocused(false);
            const parsed = Number(draft.text);
            if (Number.isFinite(parsed)) onChange(parsed);
            else draft.setText(formatNumberInput(value));
          }}
          onChange={(event) => {
            draft.setText(event.target.value);
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
        />
      </span>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
