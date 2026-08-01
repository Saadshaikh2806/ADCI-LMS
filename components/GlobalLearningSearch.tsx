"use client";

import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FileAudio,
  FileText,
  LoaderCircle,
  Radio,
  Search,
  Video,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { searchLearningContent, type LearningSearchResult } from "../lib/supabase/search";

const typeLabels: Record<LearningSearchResult["content_type"], string> = {
  course: "Course",
  video: "Recorded lecture",
  audio: "Audio lesson",
  pdf: "PDF",
  html: "Article",
  live: "Live class",
  quiz: "Quiz",
  assignment: "Assignment"
};

function ResultIcon({ type }: { type: LearningSearchResult["content_type"] }) {
  if (type === "course") return <BookOpen />;
  if (type === "video") return <Video />;
  if (type === "audio") return <FileAudio />;
  if (type === "pdf" || type === "html") return <FileText />;
  if (type === "live") return <Radio />;
  if (type === "quiz") return <ClipboardCheck />;
  return <ClipboardList />;
}

export default function GlobalLearningSearch({
  openResult
}: {
  openResult: (result: LearningSearchResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LearningSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || normalized.length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }

    let active = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      searchLearningContent(normalized)
        .then((items) => {
          if (active) setResults(items);
        })
        .catch((searchError) => {
          if (active) setError(searchError instanceof Error ? searchError.message : "Search is unavailable");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => { setSelectedIndex(0); }, [results]);

  function selectResult(result: LearningSearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    openResult(result);
  }

  function handleInputKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectResult(results[selectedIndex]);
    }
  }

  return <>
    <button className="search global-search-trigger" onClick={() => setOpen(true)} aria-label="Search learning content">
      <Search size={19} />
      <span>Search courses, lessons, quizzes…</span>
      <kbd>Ctrl K</kbd>
    </button>

    {open && <div className="global-search-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Search learning content">
        <header>
          <Search />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleInputKey} placeholder="Search your learning library…" aria-label="Search your learning library" />
          {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X /></button>}
          <kbd>ESC</kbd>
        </header>

        <div className="global-search-results">
          {query.trim().length < 2 ? <div className="global-search-state"><Search /><strong>Find anything in your LMS</strong><p>Search course names, lesson titles, article text, files, instructors, quizzes and assignments.</p></div>
          : loading ? <div className="global-search-state"><LoaderCircle className="spin" /><strong>Searching your courses…</strong></div>
          : error ? <div className="global-search-state error"><X /><strong>Search could not load</strong><p>{error}</p></div>
          : results.length === 0 ? <div className="global-search-state"><Search /><strong>No matches found</strong><p>Try a course, topic, teacher, lesson or file name.</p></div>
          : <div className="global-search-list">
            <p>{results.length} RESULT{results.length === 1 ? "" : "S"}</p>
            {results.map((result, index) => <button className={selectedIndex === index ? "selected" : ""} key={`${result.result_type}-${result.id}`} onMouseEnter={() => setSelectedIndex(index)} onClick={() => selectResult(result)}>
              <span className={`search-result-icon type-${result.content_type}`}><ResultIcon type={result.content_type} /></span>
              <span><strong>{result.title}</strong><small>{result.subtitle}</small></span>
              <em>{typeLabels[result.content_type]}</em>
              <ArrowRight />
            </button>)}
          </div>}
        </div>

        <footer><span><kbd>↑</kbd><kbd>↓</kbd> Browse</span><span><kbd>Enter</kbd> Open result</span><span>Only content available to your account is shown</span></footer>
      </section>
    </div>}
  </>;
}
