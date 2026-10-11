import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { ApiError } from "./lib/api";
import { staleTimeFor } from "./lib/queryStaleTime";
import { router } from "./router";
import { theme } from "./theme";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
      <UpdatePrompt />
    </ThemeProvider>
  </StrictMode>,
);
