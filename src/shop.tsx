import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getShop, saveShop, type ShopInfo } from "./data/shop";

// The shop's phone numbers and whether the first-start screen was done, loaded once and shared by
// the first-start screen, the "shop info" dialog and every printed sheet (footer).

type ShopCtx = ShopInfo & { loaded: boolean; save: (phones: string[]) => Promise<void> };
const Ctx = createContext<ShopCtx | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<ShopInfo>({ phones: [], setupDone: true });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getShop()
      .then(setInfo)
      .catch(() => {
        /* no database (dev preview) or a read error: never trap the owner on the first-start screen */
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (phones: string[]) => {
    const clean = await saveShop(phones);
    setInfo({ phones: clean, setupDone: true });
  }, []);

  return <Ctx.Provider value={{ ...info, loaded, save }}>{children}</Ctx.Provider>;
}

export function useShop(): ShopCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShop must be used inside ShopProvider");
  return c;
}
