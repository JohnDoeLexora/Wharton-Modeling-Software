import { useEffect, useState } from "react";
import { SAMPLE_HEADLINES, sampleLexiconScore } from "../core/lexicon";
import type { ResearchNote } from "../core/types";
import { useStore } from "../state";
import { pct } from "./format";

const FINBERT_BASE = import.meta.env.DEV ? "/finbert" : "http://127.0.0.1:8765";

interface Health {
  ready?: boolean;
  transformers_installed?: boolean;
  weights_cached?: boolean;
  model?: string;
  detail?: string;
  error?: string;
}

interface ScoreRow {
  text: string;
  label: string;
  scores: { positive: number; negative: number; neutral: number };
  source: "finbert" | "sample-lexicon";
  modelName: string;
}

export function ResearchPanel() {
  const { notes, setNotes } = useStore();
  const [health, setHealth] = useState<Health | null>(null);
  const [ticker, setTicker] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      const response = await fetch(`${FINBERT_BASE}/health`, { signal: AbortSignal.timeout(2500) });
      const body = (await response.json()) as Health;
      setHealth(body);
    } catch {
      setHealth({
        ready: false,
        error: "The FinBERT service is not running on 127.0.0.1:8765.",
      });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function scoreFinbert() {
    const texts = splitTexts(text);
    if (texts.length === 0) {
      setMessage("Paste at least one headline or short paragraph.");
      return;
    }
    setBusy(true);
    setMessage("Scoring with FinBERT. The first call can take a while if the model is still loading.");
    try {
      const response = await fetch(`${FINBERT_BASE}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(180000),
      });
      const body = (await response.json()) as {
        available?: boolean;
        error?: string;
        model?: string;
        results?: { text: string; label: string; scores: ScoreRow["scores"] }[];
      };
      if (!response.ok || !body.results) {
        setMessage(body.error || "FinBERT did not score the text. You can use the demo lexicon instead.");
        setRows([]);
        return;
      }
      setRows(
        body.results.map((result) => ({
          text: result.text,
          label: result.label,
          scores: result.scores,
          source: "finbert",
          modelName: body.model || "ProsusAI/finbert",
        })),
      );
      setMessage("Scores are from ProsusAI/finbert. They are a research tag, not a trade.");
    } catch {
      setMessage("Could not reach FinBERT. Start the Python service, or score with the demo lexicon.");
    } finally {
      setBusy(false);
    }
  }

  function scoreLexicon() {
    const texts = splitTexts(text);
    if (texts.length === 0) {
      setMessage("Paste at least one headline or short paragraph.");
      return;
    }
    setRows(
      texts.map((line) => {
        const scored = sampleLexiconScore(line);
        return {
          text: line,
          label: scored.label,
          scores: scored.scores,
          source: "sample-lexicon" as const,
          modelName: "demo lexicon (not FinBERT)",
        };
      }),
    );
    setMessage("These scores are a word list in the browser. They are not FinBERT and they are not financial analysis.");
  }

  function saveAll() {
    if (!ticker.trim()) {
      setMessage("Add a ticker or theme before saving. Notes are tags for research, not portfolio weights.");
      return;
    }
    const created = rows.map((row) => toNote(row, ticker.trim()));
    setNotes([...created, ...notes]);
    setMessage(`Saved ${created.length} note${created.length === 1 ? "" : "s"} in this browser.`);
  }

  const status = !health
    ? "Checking the FinBERT service…"
    : health.ready
      ? "FinBERT weights look ready."
      : health.error || health.detail || "FinBERT is not ready. The demo lexicon still works.";

  return (
    <div className="stack">
      <header className="panel-head">
        <h2>Research notes</h2>
        <p className="lede">
          Paste headlines or a short article, score the tone, and keep the result next to a ticker or theme.
          Scores do not change projections, allocations, the reserve, or the facility range. They are optional notes for Trading Notes.
        </p>
      </header>

      <section className="card">
        <div className="section-row">
          <h3>FinBERT status</h3>
          <button type="button" className="ghost" onClick={() => void refresh()}>
            Check again
          </button>
        </div>
        <p className={health?.ready ? "status ok" : "status"}>{status}</p>
        <p className="muted">
          Model: ProsusAI/finbert. Araci, D. (2019), FinBERT: Financial Sentiment Analysis with Pre-trained Language Models,
          arXiv:1908.10063. This app does not quote an accuracy number. See the paper and the model card for the authors’ own evaluation.
          Setup: <code>python3 scripts/setup_finbert.py</code>, then <code>.venv/bin/python services/finbert/server.py</code>.
        </p>
      </section>

      <section className="card">
        <label className="field">
          <span>Ticker or theme</span>
          <input
            value={ticker}
            placeholder="A ticker, sector, or theme the team is reading about"
            onChange={(event) => setTicker(event.target.value)}
          />
        </label>
        <label className="field wide">
          <span>Headlines or short text, one item per line</span>
          <textarea className="note" rows={6} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="row-actions">
          <button type="button" onClick={() => void scoreFinbert()} disabled={busy}>
            {busy ? "Scoring…" : "Score with FinBERT"}
          </button>
          <button type="button" className="ghost" onClick={scoreLexicon} disabled={busy}>
            Score with demo lexicon
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setText(SAMPLE_HEADLINES)}
          >
            Insert fictional sample headlines
          </button>
        </div>
        {message ? <p className="callout">{message}</p> : null}
        {rows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table>
                <caption>Latest scores. Source is shown so a demo lexicon result cannot be mistaken for FinBERT.</caption>
                <thead>
                  <tr>
                    <th>Text</th>
                    <th>Source</th>
                    <th>Label</th>
                    <th>Positive</th>
                    <th>Negative</th>
                    <th>Neutral</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.source}-${index}`}>
                      <td>{row.text}</td>
                      <td>{row.modelName}</td>
                      <td className={`label-${row.label}`}>{row.label}</td>
                      <td className="num">{pct(row.scores.positive, 1)}</td>
                      <td className="num">{pct(row.scores.negative, 1)}</td>
                      <td className="num">{pct(row.scores.neutral, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={saveAll}>
              Save these scores as research notes
            </button>
          </>
        ) : null}
      </section>

      <section className="card">
        <h3>Saved notes</h3>
        {notes.length === 0 ? (
          <p className="muted">No notes yet. They stay in this browser and never feed the projection engine.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>Qualitative tags. Not portfolio weights.</caption>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Ticker or theme</th>
                  <th>Source</th>
                  <th>Label</th>
                  <th>Text</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr key={note.id}>
                    <td>{note.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td>{note.tickerOrTheme}</td>
                    <td>{note.modelName}</td>
                    <td className={`label-${note.label}`}>{note.label}</td>
                    <td>{note.text}</td>
                    <td>
                      <button type="button" className="text" onClick={() => setNotes(notes.filter((item) => item.id !== note.id))}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function splitTexts(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 30);
}

function toNote(row: ScoreRow, tickerOrTheme: string): ResearchNote {
  return {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    tickerOrTheme,
    text: row.text,
    source: row.source,
    modelName: row.modelName,
    label: row.label,
    scores: row.scores,
  };
}
