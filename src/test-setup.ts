// Preloaded by `bun test` (bunfig.toml). Hooks here run once around the whole run, not per file.
import { afterAll } from "bun:test";
import { removeSharedTestWallet } from "@lib/test-fixtures";

// Tests write to the shared dev database; the one account they share mustn't outlive the run and
// show up among the farm's real accounts.
afterAll(removeSharedTestWallet);
