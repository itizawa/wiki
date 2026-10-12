import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { ThemeBackdrop } from "./components/ThemeBackdrop";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { ApiError } from "./lib/api";
import { staleTimeFor } from "./lib/queryStaleTime";
import { router } from "./router";
import { useAdminThemePreset } from "./lib/adminTheme";
import { adminThemeFor, fixedModeOf } from "./theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
      // ツリーやページの一覧などは、画面を移るたびに取り直さない（どれを、どれだけの間かは `staleTimeFor`）。
      // wiki ごとの QueryClient（WikiLayout）も、この設定を写して使う
      staleTime: (query) => staleTimeFor(query.queryKey),
    },
  },
});

/** 開いている wiki の外観のテーマに合わせた配色（wiki の外の画面は既定） */
function App() {
  const preset = useAdminThemePreset();
  // ライトだけ・ダークだけのテーマは、`<html>` のクラスでそのモードにする（描く前に付ける）
  const fixed = fixedModeOf(preset);
  useLayoutEffect(() => {
    if (!fixed) return;
    document.documentElement.classList.add(fixed);
    return () => document.documentElement.classList.remove(fixed);
  }, [fixed]);
  return (
    <ThemeProvider theme={adminThemeFor(preset)}>
      <CssBaseline />
      <ThemeBackdrop preset={preset} />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
      <UpdatePrompt />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
