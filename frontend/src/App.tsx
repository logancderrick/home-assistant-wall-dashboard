import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./components/Layout/MainLayout";
import SimulatedViewport from "./components/dev/SimulatedViewport";
import ViewportIndicator from "./components/dev/ViewportIndicator";
import ErrorBoundary from "./components/Common/ErrorBoundary";
import { useViewportSimulator } from "./contexts/ViewportSimulatorContext";

const AUTO_RESET_MS = 30_000;

function ViewErrorFallback({ onReset }: { onReset?: () => void }) {
  useEffect(() => {
    if (!onReset) return;
    const timer = setTimeout(onReset, AUTO_RESET_MS);
    return () => clearTimeout(timer);
  }, [onReset]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <p className="text-skydark-text">This section failed to load.</p>
      <a href="#/calendar" className="text-skydark-accent font-medium underline">
        Go to Calendar
      </a>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 rounded-xl bg-skydark-surface-muted text-skydark-text font-medium"
        >
          Try again
        </button>
      )}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="px-4 py-2 rounded-xl bg-skydark-accent text-white font-medium"
      >
        Reload page
      </button>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold text-skydark-text">Page not found</h2>
      <a href="#/calendar" className="text-skydark-accent font-medium underline">
        Go to Calendar
      </a>
    </div>
  );
}

const CalendarView = lazy(() => import("./views/CalendarView.tsx"));
const TasksView = lazy(() => import("./views/TasksView.tsx"));
const ListsView = lazy(() => import("./views/ListsView.tsx"));
const PhotosView = lazy(() => import("./views/PhotosView.tsx"));
const CamerasView = lazy(() => import("./views/CamerasView.tsx"));
const RewardsView = lazy(() => import("./views/RewardsView.tsx"));
const SettingsView = lazy(() => import("./views/SettingsView.tsx"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-skydark-text/60">Loading...</div>
    </div>
  );
}

function App() {
  const { developerMode } = useViewportSimulator();

  const content = (
    <MainLayout>
      <ErrorBoundary fallback={(reset) => <ViewErrorFallback onReset={reset} />}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Navigate to="/calendar" replace />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/tasks" element={<TasksView />} />
            <Route path="/lists" element={<ListsView />} />
            <Route path="/photos" element={<PhotosView />} />
            <Route path="/cameras" element={<CamerasView />} />
            <Route path="/rewards" element={<RewardsView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </MainLayout>
  );

  return (
    <>
      {developerMode ? <SimulatedViewport>{content}</SimulatedViewport> : content}
      {developerMode && <ViewportIndicator />}
    </>
  );
}

export default App;
