import { serve } from "inngest/next";
import { analyzeBook } from "@/jobs/analyze-book";
import { inngest } from "@/jobs/client";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyzeBook],
});
