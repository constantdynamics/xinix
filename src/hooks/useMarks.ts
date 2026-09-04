// useMarks: centrale store voor favorieten + gezien markeringen.
// Gebruikt een module-level Set + listeners zodat elke tabel-rij
// optimistisch update wanneer ergens anders op het hartje of de verrekijker
// wordt geklikt. Eén GET per pagina-load, daarna alleen toggles.

import { useEffect, useState } from "react";
import { addMark, addMarksBulk, fetchMarks, removeMark, setFavoriteRating, getToken, type MarkKind } from "../api";

type Listener = () => void;

const state = {
  loaded: false,
  loading: false,
  favorites: new Set<string>(),
  seen: new Set<string>(),
  ratings: new Map<string, number>(),
  favoritedAt: new Map<string, string>(),
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
    state.ratings = new Map();
    for (const [t, r] of Object.entries(data.ratings ?? {})) {
      state.ratings.set(t.toUpperCase(), r);
    }
    state.favoritedAt = new Map();
    for (const [t, at] of Object.entries(data.favorited_at ?? {})) {
      state.favoritedAt.set(t.toUpperCase(), at);
    }
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
  ratings: Map<string, number>;
  /** Wanneer een ticker favoriet werd (ISO-string), voor de "toegevoegd"-kolom. */
  favoritedAt: Map<string, string>;
  isFavorite: (ticker: string) => boolean;
  isSeen: (ticker: string) => boolean;
  getRating: (ticker: string) => number | null;
  toggle: (kind: MarkKind, ticker: string) => Promise<void>;
  setRating: (ticker: string, rating: number | null) => Promise<void>;
  markManySeen: (tickers: string[]) => Promise<number>;
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
    ratings: state.ratings,
    favoritedAt: state.favoritedAt,
    loaded: state.loaded,
    isFavorite: (t) => state.favorites.has(t.toUpperCase()),
    isSeen: (t) => state.seen.has(t.toUpperCase()),
    getRating: (t) => state.ratings.get(t.toUpperCase()) ?? null,
    setRating: async (ticker, rating) => {
      const T = ticker.toUpperCase();
      const prev = state.ratings.get(T) ?? null;
      // optimistic
      if (rating == null) state.ratings.delete(T);
      else state.ratings.set(T, rating);
      // Een rating heeft een favoriet nodig; zorg dat hij in de favorieten-set staat.
      const wasFav = state.favorites.has(T);
      if (!wasFav && rating != null) state.favorites.add(T);
      emit();
      try {
        await setFavoriteRating(T, rating);
      } catch (err) {
        // rollback
        if (prev == null) state.ratings.delete(T);
        else state.ratings.set(T, prev);
        if (!wasFav) state.favorites.delete(T);
        emit();
        console.error("setRating failed", err);
      }
    },
    toggle: async (kind, ticker) => {
      const T = ticker.toUpperCase();
      const set = setForKind(kind);
      const wasOn = set.has(T);
      const prevRating = kind === "favorite" ? (state.ratings.get(T) ?? null) : null;
      const prevAt = kind === "favorite" ? (state.favoritedAt.get(T) ?? null) : null;
      // optimistic
      if (wasOn) set.delete(T);
      else set.add(T);
      if (kind === "favorite") {
        if (wasOn) {
          state.ratings.delete(T);
          state.favoritedAt.delete(T);
        } else {
          state.favoritedAt.set(T, new Date().toISOString());
        }
      }
      emit();
      try {
        if (wasOn) await removeMark(kind, T);
        else await addMark(kind, T);
      } catch (err) {
        // rollback
        if (wasOn) set.add(T);
        else set.delete(T);
        if (kind === "favorite") {
          if (wasOn && prevRating != null) state.ratings.set(T, prevRating);
          if (wasOn && prevAt != null) state.favoritedAt.set(T, prevAt);
          if (!wasOn) state.favoritedAt.delete(T);
        }
        emit();
        console.error("toggle mark failed", err);
      }
    },
    // Bulk markeren als gezien — gebruikt door de "vink alle behalve favorieten"
    // knop bovenin elke ticker-tabel. Favorieten worden hier overgeslagen zodat
    // de gebruiker zijn watch-list niet per ongeluk wegklikt.
    markManySeen: async (tickers) => {
      const toAdd: string[] = [];
      for (const t of tickers) {
        const T = t.toUpperCase();
        if (state.favorites.has(T)) continue;
        if (state.seen.has(T)) continue;
        toAdd.push(T);
      }
      if (toAdd.length === 0) return 0;
      for (const T of toAdd) state.seen.add(T);
      emit();
      try {
        await addMarksBulk("seen", toAdd);
        return toAdd.length;
      } catch (err) {
        for (const T of toAdd) state.seen.delete(T);
        emit();
        console.error("bulk mark seen failed", err);
        throw err;
      }
    },
  };
}
