// This preload is invoked only by tests/e2e/server.mjs, never by the application.
import { installGeminiFixture } from "./integration-fixtures.mjs";
installGeminiFixture();
