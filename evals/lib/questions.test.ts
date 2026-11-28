import assert from "node:assert/strict";
import { test } from "node:test";
import { namesAnotherColor, namesAnotherSize, placeholderNames, showsColor, showsSize, type Group } from "./questions.ts";

test("choices with placeholders for names are questions nobody can answer", () => {
  const groups: Group[] = [
    { name: "Option 4", required: true, options: ["Abyss Bronze", "Oatmilk Champagne"] },
    { name: "Option 11", required: true, options: ["Abyss Bronze", "Licorice Gunmetal"] },
  ];
  assert.equal(placeholderNames(groups).length, 1);
  assert.match(placeholderNames(groups)[0]!, /placeholder for a name/);
  // One choice a store left unnamed, alone, can still be answered from its values.
  assert.deepEqual(placeholderNames([{ name: "Option", required: true, options: ["Red", "Blue"] }]), []);
  assert.deepEqual(placeholderNames([{ name: "Size", required: true, options: ["S", "M"] }, { name: "Color", required: true, options: ["Black"] }]), []);
});

test("a cart line shows the size and the colour asked for", () => {
  const line = "Men's AIRism Cotton T-Shirt (Color: 07 GRAY; Size: M)";
  assert.ok(showsSize(line, "medium"));
  assert.ok(!showsSize("Men's AIRism Cotton T-Shirt", "medium"));
  assert.ok(!showsSize("Men's Tee · Size: S", "medium"));
  assert.ok(showsSize("Tree Runner · 10 · Blizzard", "10"));
  assert.ok(!showsSize("Tree Runner · 10.5 · Blizzard", "10"));
  assert.ok(!showsColor(line, "white"));
  assert.ok(showsColor("Crew Tee · Jet Black / M", "black"));
  assert.ok(showsColor("Crew Tee · Heather Grey", "gray"));
});

test("a card that names another colour is not the colour asked for, and one that names none might be", () => {
  assert.ok(namesAnotherColor("Men's White Crew Neck T-Shirt", "black"));
  assert.ok(!namesAnotherColor("Men's Crew Neck T-Shirt", "black"));
  assert.ok(!namesAnotherColor("Men's Black and White Striped T-Shirt", "black"));
});

test("a card that names another size is not the size asked for, and one that names none might be", () => {
  assert.ok(namesAnotherSize("Hanes Men's Premium 5pk Slim Fit Crew Neck T-Shirt - Black XL: Cotton-Polyester Blend", "medium"));
  assert.ok(!namesAnotherSize("NBA San Antonio Spurs Men's Cotton Crew Neck T-Shirt - M", "medium"));
  assert.ok(!namesAnotherSize("Goodfellow & Co Men's Crew Neck T-shirt", "medium"));
  assert.ok(!namesAnotherSize("Men's V-Neck T-Shirt 3 Pack", "medium"));
  // A numbered size is never read from a name, where a number can be a pack's count.
  assert.ok(!namesAnotherSize("Tree Runner 12 Pack Laces", "10"));
});
