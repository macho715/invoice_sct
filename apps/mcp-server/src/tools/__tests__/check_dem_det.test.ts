import { describe, expect, it } from "vitest";
import { run, TOOL_VERSION, ToolName } from "@invoice-audit/tools/check_dem_det";

describe("check_dem_det", () => {
  it("exposes the expected tool identity", () => {
    expect(ToolName).toBe("check_dem_det");
    expect(TOOL_VERSION).toBe("0.1.0");
  });

  it("returns PASS for non-DEM/DET charge code", async () => {
    const result = await run({ line_id: "L1", charge_code: "TRANSPORT", has_dates: false, has_tariff: false, has_free_time: false, has_invoice: false, is_final_settlement: false });
    expect(result.verdict).toBe("PASS");
    expect(result.missing_inputs).toEqual([]);
    expect(result.reason_code).toBeNull();
  });

  it("returns PASS for STORAGE with all inputs present", async () => {
    const result = await run({ line_id: "L2", charge_code: "STORAGE", has_dates: true, has_tariff: true, has_free_time: true, has_invoice: true, is_final_settlement: false });
    expect(result.verdict).toBe("PASS");
    expect(result.missing_inputs).toEqual([]);
    expect(result.reason_code).toBeNull();
  });

  it("returns AMBER for DEMURRAGE missing dates + tariff (non-final settlement)", async () => {
    const result = await run({ line_id: "L3", charge_code: "DEMURRAGE", has_dates: false, has_tariff: false, has_free_time: true, has_invoice: true, is_final_settlement: false });
    expect(result.verdict).toBe("AMBER");
    expect(result.missing_inputs).toEqual(["DATES", "TARIFF"]);
    expect(result.reason_code).toBe("DEMDET_PARTIAL_INPUTS");
  });

  it("returns ZERO for DETENTION missing free_time (final settlement)", async () => {
    const result = await run({ line_id: "L4", charge_code: "DETENTION", has_dates: true, has_tariff: true, has_free_time: false, has_invoice: true, is_final_settlement: true });
    expect(result.verdict).toBe("ZERO");
    expect(result.missing_inputs).toEqual(["FREE_TIME"]);
    expect(result.reason_code).toBe("DEMDET_FINAL_MISSING_INPUTS");
  });

  it("returns AMBER for STORAGE missing invoice (non-final settlement)", async () => {
    const result = await run({ line_id: "L5", charge_code: "STORAGE", has_dates: true, has_tariff: true, has_free_time: true, has_invoice: false, is_final_settlement: false });
    expect(result.verdict).toBe("AMBER");
    expect(result.missing_inputs).toEqual(["INVOICE"]);
    expect(result.reason_code).toBe("DEMDET_PARTIAL_INPUTS");
  });

  it("returns PASS for DEMURRAGE with all inputs + final settlement", async () => {
    const result = await run({ line_id: "L6", charge_code: "DEMURRAGE", has_dates: true, has_tariff: true, has_free_time: true, has_invoice: true, is_final_settlement: true });
    expect(result.verdict).toBe("PASS");
    expect(result.missing_inputs).toEqual([]);
    expect(result.reason_code).toBeNull();
  });

  it("returns ZERO for DETENTION missing all inputs (final settlement)", async () => {
    const result = await run({ line_id: "L7", charge_code: "DETENTION", has_dates: false, has_tariff: false, has_free_time: false, has_invoice: false, is_final_settlement: true });
    expect(result.verdict).toBe("ZERO");
    expect(result.missing_inputs).toEqual(["DATES", "TARIFF", "FREE_TIME", "INVOICE"]);
    expect(result.reason_code).toBe("DEMDET_FINAL_MISSING_INPUTS");
  });
});
