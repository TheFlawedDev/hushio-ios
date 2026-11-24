import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence } from "motion/react";
import { X, MagnifyingGlass } from "@phosphor-icons/react";
import { PhoneIcon } from "./PhoneIcon";
import { SearchSuggestions, optionId, useTypeAhead } from "../SearchSuggestions";
import { openSuggestion, submitSearch } from "../../lib/searchActions";
import { INSET_TOP } from "../../lib/phoneNav";
import type { SuggestionRow } from "../../lib/searchParse";
import { useUI } from "../../stores/ui";

const ICON_BUTTON =
  "absolute inset-y-0 right-0 z-10 grid h-11 w-12 place-items-center rounded-full text-ink-2 motion-safe:transition-colors hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-[var(--disabled-opacity)]";

export function PhoneSearchField({ suggest = true }: { suggest?: boolean }) {
  const query = useUI((state) => state.searchQuery);
  const setSearchQuery = useUI((state) => state.setSearchQuery);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const interactingRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rows = useTypeAhead(query, focused && suggest);
  const open = focused && rows.length > 0;

  const close = () => {
    interactingRef.current = false;
    setFocused(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  const pick = (row: SuggestionRow) => {
    interactingRef.current = false;
    openSuggestion(row, query);
    close();
  };

  const submitTyped = () => {
    interactingRef.current = false;
    if (query.trim()) submitSearch(query);
    close();
  };

  const clear = () => {
    setSearchQuery("");
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  useEffect(() => {
    const handleOutside = (event: Event) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        interactingRef.current = false;
        setFocused(false);
        setActiveIndex(-1);
      }
    };
    window.addEventListener("pointerdown", handleOutside);
    window.addEventListener("touchstart", handleOutside);
    return () => {
      window.removeEventListener("pointerdown", handleOutside);
      window.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" && open) {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, rows.length));
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(-1, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = open && activeIndex >= 1 ? rows[activeIndex - 1] : undefined;
      if (picked) pick(picked);
      else submitTyped();
    }
  };

  return (
    <div
      ref={containerRef}
      className="sticky z-20 -mx-4 bg-base px-4 py-2"
      style={{ top: INSET_TOP }}
    >
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 grid w-12 place-items-center text-ink-2">
          <PhoneIcon icon={MagnifyingGlass} />
        </span>
        <input
          ref={inputRef}
          id="phone-search"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-label="Search"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(listId, activeIndex) : undefined}
          aria-autocomplete="list"
          inputMode="search"
          enterKeyHint="search"
          placeholder="What do you want to play?"
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          value={query}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            if (interactingRef.current) return;
            setFocused(false);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          className={`h-11 min-h-[var(--hit-min,44px)] w-full rounded-field border-0 bg-wash pl-12 text-body text-ink-1 placeholder:text-ink-3 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-search-cancel-button]:appearance-none ${query ? "pr-24" : "pr-12"}`}
        />
        {query && (
          <button type="button" aria-label="Clear search" title="Clear search" onClick={clear} className={ICON_BUTTON}>
            <PhoneIcon icon={X} />
          </button>
        )}
        <div
          data-suggestions-layer
          onMouseDown={() => {
            interactingRef.current = true;
          }}
          onTouchStart={() => {
            interactingRef.current = true;
          }}
        >
          <AnimatePresence>
            {open && (
              <SearchSuggestions
                listId={listId}
                query={query}
                rows={rows}
                activeIndex={activeIndex}
                onPick={pick}
                onFill={(text) => {
                  interactingRef.current = false;
                  setSearchQuery(text);
                  setActiveIndex(-1);
                  inputRef.current?.focus();
                }}
                onSubmitTyped={submitTyped}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
