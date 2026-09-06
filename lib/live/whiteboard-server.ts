import "server-only";

import { createHmac } from "node:crypto";
import { requireServerEnvironment } from "../supabase/server";

// The Supabase Realtime broadcast channel is public: anyone who knows its name
// can subscribe. The lesson id is visible to the client, so deriving the name
// from the id alone would let a signed-in learner who lost access keep watching.
// Mixing in the service-role key (server-only) makes the channel name
// unguessable without also holding that secret.
export function whiteboardChannelName(lessonId: string) {
  const secret = requireServerEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const token = createHmac("sha256", secret)
    .update(`adci-live-whiteboard:${lessonId}`)
    .digest("hex")
    .slice(0, 24);
  return `wb-${lessonId}-${token}`;
}
