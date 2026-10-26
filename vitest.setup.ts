import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Components rendered by one test must not leak into the next.
afterEach(() => cleanup());
