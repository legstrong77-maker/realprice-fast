import { useEffect, useState } from "react";

export type ShortlistItem = {
  county: string;
  countyName: string;
  district: string;
  source?: string;
  addedAt: string;
};

const KEY = "realprice.shortlist.v1";
const EVENT = "realprice-shortlist";

function safeWindow() {
  return typeof window !== "undefined" ? window : null;
}

export function readShortlist(): ShortlistItem[] {
  const w = safeWindow();
  if (!w) return [];
  try {
    const raw = w.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeShortlist(items: ShortlistItem[]) {
  const w = safeWindow();
  if (!w) return;
  w.localStorage.setItem(KEY, JSON.stringify(items.slice(0, 12)));
  w.dispatchEvent(new CustomEvent(EVENT));
}

export function addShortlist(item: Omit<ShortlistItem, "addedAt">) {
  const current = readShortlist();
  const next = [
    { ...item, addedAt: new Date().toISOString() },
    ...current.filter((x) => !(x.county === item.county && x.district === item.district)),
  ];
  writeShortlist(next);
}

export function removeShortlist(county: string, district: string) {
  writeShortlist(readShortlist().filter((x) => !(x.county === county && x.district === district)));
}

export function clearShortlist() {
  writeShortlist([]);
}

export function isShortlisted(county: string, district: string) {
  return readShortlist().some((x) => x.county === county && x.district === district);
}

export function useShortlist() {
  const [items, setItems] = useState<ShortlistItem[]>(() => readShortlist());

  useEffect(() => {
    const sync = () => setItems(readShortlist());
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  return items;
}
