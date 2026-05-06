import { describe, expect, it } from "vitest";
import {
  parseClockAlarm,
  parseDefaultListAdd,
  parseDurationTimer,
  parseExplicitListAdd,
  matchVoiceDashboardCommand,
} from "./voiceLocalCommands";

describe("parseExplicitListAdd", () => {
  it("parses add … to …", () => {
    expect(parseExplicitListAdd("add eggs to grocery")).toEqual({
      content: "eggs",
      listHint: "grocery",
    });
    expect(parseExplicitListAdd("put milk on the shopping list")).toEqual({
      content: "milk",
      listHint: "shopping",
    });
  });
});

describe("parseDefaultListAdd", () => {
  const lists = [
    { id: "abc", name: "Grocery" },
    { id: "xyz", name: "Chores" },
  ];

  it("requires configured default id present in lists", () => {
    expect(parseDefaultListAdd("add bananas", undefined, lists)).toBeNull();
    expect(parseDefaultListAdd("add bananas", "missing", lists)).toBeNull();
    expect(parseDefaultListAdd("add bananas", "abc", lists)).toBe("bananas");
  });

  it("does not steal explicit to/on phrases", () => {
    expect(parseDefaultListAdd("add x to grocery", "abc", lists)).toBeNull();
  });
});

describe("parseDurationTimer", () => {
  it("parses variants", () => {
    expect(parseDurationTimer("timer 10 minutes")).toEqual({ seconds: 600 });
    expect(parseDurationTimer("please set timer for 1 hour")).toEqual({ seconds: 3600 });
    expect(parseDurationTimer("in 30 seconds")).toEqual({ seconds: 30 });
    expect(parseDurationTimer("set alarm for 5 minutes")).toEqual({ seconds: 300 });
  });
});

describe("parseClockAlarm", () => {
  it("extracts descriptive title after time phrase", () => {
    const r = parseClockAlarm("set alarm for 7 pm take chicken out", new Date());
    expect(r).not.toBeNull();
    expect(r!.title.toLowerCase()).toContain("chicken");
  });

  it("parses wake me utterance", () => {
    const r = parseClockAlarm("wake me up at 6:45 am", new Date());
    expect(r).not.toBeNull();
    expect(r!.at.getHours()).toBe(6);
    expect(r!.at.getMinutes()).toBe(45);
  });
});

describe("matchVoiceDashboardCommand", () => {
  it("returns list match when list resolved", () => {
    const r = matchVoiceDashboardCommand(
      "add paper towels to grocery",
      {
        lists: [{ id: "L1", name: "Grocery" }],
        listAddLocked: false,
        addEventsLocked: false,
      },
      { conn: {} as never, refetchLists: async () => {}, refetchEvents: async () => {} },
    );
    expect(r?.speakSummary).toContain("paper towels");
    expect(r?.speakSummary).toContain("Grocery");
    expect(typeof r?.apply).toBe("function");
  });
});
