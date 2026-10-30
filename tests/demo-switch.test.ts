import { describe, expect, it } from "vitest";
import { demoErlaubt } from "../lib/demo-switch";

describe("Demo-Schalter", () => {
  it("zeigt Demo-Daten nur mit ?demo in der Adresse", () => {
    expect(demoErlaubt("")).toBe(false);
    expect(demoErlaubt("?projekt=26.0560")).toBe(false);
    expect(demoErlaubt("?demo=1")).toBe(true);
    expect(demoErlaubt("?demo")).toBe(true);
    expect(demoErlaubt("?x=1&demo=1")).toBe(true);
  });
});
