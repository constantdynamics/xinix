// useMarks: centrale store voor favorieten + gezien markeringen.
// Gebruikt een module-level Set + listeners zodat elke tabel-rij
// optimistisch update wanneer ergens anders op het hartje of de verrekijker
// wordt geklikt. Eén GET per pagina-load, daarna alleen toggles.

import { useEffect, useState } from "react";
import { addMark, fetchMarks, removeMark, getToken, type MarkKind } from "../api";

type Listener = () => void;

const state = {
  loaded: false,
  loading: false,
  favorites: new Set<string>(),
  seen: new Set<string>(),
};
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function setForKind(kind: MarkKind): Set<string> {
  return kind === "favorite" ? state.favorites : state.seen;
}

async function ensureLoaded(): Promise<void> {
  if (state.loaded || state.loading) return;
  if (!getToken()) return; // Geen admin token = niets te laden.
  state.loading = true;
  try {
    const data = await fetchMarks();
    state.favorites = new Set(data.favorites.map((t) => t.toUpperCase()));
    state.seen = new Set(data.seen.map((t) => t.toUpperCase()));
    state.loaded = true;
    emit();
  } catch (err) {
    console.error("fetchMarks failed", err);
  } finally {
    state.loading = false;
  }
}

export interface MarksApi {
  favorites: Set<string>;
  seen: Set<string>;
  isFavorite: (ticker: string) => boolean;
  isSeen: (ticker: string) => boolean;
  toggle: (kind: MarkKind, ticker: string) => Promise<void>;
  loaded: boolean;
}

export function useMarks(): MarksApi {
  const [, setTick] = useState(0);

  useEffect(() => {
    const l: Listener = () => setTick((n) => n + 1);
    listeners.add(l);
    void ensureLoaded();
    return () => {
      listeners.delete(l);
    };
  }, []);

  return {
    favorites: state.favorites,
    seen: state.seen,
    loaded: state.loaded,
    isFavorite: (t) => state.favorites.has(t.toUpperCase()),
    isSeen: (t) => state.seen.has(t.toUpperCase()),
    toggle: async (kind, ticker) => {
      const T = ticker.toUpperCase();
      const set = setForKind(kind);
      const wasOn = set.has(T);
      // optimistic
      if (wasOn) set.delete(T);
      else set.add(T);
      emit();
      try {
        if (wasOn) await removeMark(kind, T);
        else await addMark(kind, T);
      } catch (err) {
        // rollback
        if (wasOn) set.add(T);
        else set.delete(T);
        emit();
        console.error("toggle mark failed", err);
      }
    },
  };
}
