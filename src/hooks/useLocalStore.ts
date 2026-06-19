import { useEffect, useState } from "react";

function useLocalArray<T>(key: string) {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
  }, [key]);
  const save = (next: T[]) => {
    setItems(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  return [items, save] as const;
}

export function useHistory() {
  const [history, setHistory] = useLocalArray<{ query: string; at: number }>(
    "cat-smart-history",
  );
  const push = (query: string) => {
    const next = [{ query, at: Date.now() }, ...history.filter((h) => h.query !== query)].slice(0, 30);
    setHistory(next);
  };
  const clear = () => setHistory([]);
  return { history, push, clear };
}

export function useFavorites() {
  const [favorites, setFavorites] = useLocalArray<string>("cat-smart-favorites");
  const toggle = (id: string) => {
    setFavorites(favorites.includes(id) ? favorites.filter((x) => x !== id) : [id, ...favorites]);
  };
  return { favorites, toggle };
}
