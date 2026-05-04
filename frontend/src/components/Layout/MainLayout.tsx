import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import Header from "./Header";
import VoiceButton from "../Voice/VoiceButton";
import VoiceOverlay from "../Voice/VoiceOverlay";
import { useAppContext } from "../../contexts/AppContext";
import { isSkydarkDemo } from "../../lib/demoMode";
import { useIdleDetection } from "../../hooks/useIdleDetection";

interface MainLayoutProps {
  children: ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const { pathname } = useLocation();
  const { settings, isLocked, setIsLocked } = useAppContext();
  const [isPortrait, setIsPortrait] = useState(false);
  const { isIdle } = useIdleDetection(
    settings.autoRelockMinutes,
    !!(settings.lockEnabled && !isLocked && settings.autoRelockEnabled)
  );

  useEffect(() => {
    if (isIdle) setIsLocked(true);
  }, [isIdle, setIsLocked]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(orientation: portrait)");
    const updateOrientation = () => setIsPortrait(mediaQuery.matches);
    updateOrientation();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateOrientation);
      return () => mediaQuery.removeEventListener("change", updateOrientation);
    }
    mediaQuery.addListener(updateOrientation);
    return () => mediaQuery.removeListener(updateOrientation);
  }, []);

  const isCalendar = pathname.includes("calendar");
  /**
   * Calendar manages its own internal scroll (top weather card stays put,
   * the 4-week grid scrolls inside its container). Lock the viewport in
   * every orientation so the wall dashboard never spills the whole page.
   */
  const shouldLockToViewport = isCalendar;
  /** When viewport is locked we want the chrome column to be height-constrained too. */
  const lockShell = shouldLockToViewport || !isPortrait;
  /**
   * Desktop landscape uses a fixed-height shell (`h-screen overflow-hidden`). Putting
   * `overflow-y-auto` only on `<main>` breaks flex shrink (`min-h-0`), so non-calendar views
   * can end up with ~0 usable height while Calendar/Cameras still fill via inner scroll regions.
   * Route scrolling inside an explicit flex child restores layout for Tasks, Lists, etc.
   */
  const scrollMainInFlexChild = lockShell && !shouldLockToViewport;

  return (
    <div
      className={`flex bg-skydark-bg font-sans text-skydark-text max-w-full ${
        lockShell ? "h-screen max-h-screen overflow-hidden" : "min-h-screen flex-col"
      }`}
    >
      {!isPortrait && <Sidebar />}
      <div
        className={`flex flex-1 flex-col min-w-0 ${
          lockShell ? "min-h-0 overflow-hidden" : "min-h-screen"
        }`}
      >
        {!isPortrait && <MobileNav />}
        <div className="shrink-0">
          <Header />
        </div>
        {isSkydarkDemo && (
          <div
            role="status"
            className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950"
          >
            Demo mode — no Home Assistant connection. Sample data for layout review; changes are not saved to HA.
          </div>
        )}
        <main
          className={`flex-1 bg-skydark-bg p-5 sm:p-6 ${
            lockShell ? "min-h-0 flex flex-col overflow-hidden" : ""
          } ${shouldLockToViewport ? "overflow-hidden" : scrollMainInFlexChild ? "" : "overflow-y-auto"} ${
            isPortrait && !shouldLockToViewport ? "pb-24" : ""
          }`}
        >
          {scrollMainInFlexChild ? (
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          ) : (
            children
          )}
        </main>
        {isPortrait && <MobileNav position="bottom" forceVisible iconOnly />}
      </div>
      <VoiceButton />
      <VoiceOverlay />
    </div>
  );
}
