import assert from "node:assert/strict";
import { test } from "node:test";
import { asksWhetherToAdd, inlineChoice, namesAnotherColor, namesAnotherSize, pickValue, saidValue, showsColor, showsSize, unfairQuestions, type Group } from "./questions.ts";

const sizes: Group = { name: "Size", required: true, options: ["XS", "S", "M", "L", "XL"] };
const colors: Group = { name: "Color", required: true, options: ["Black", "White", "Navy (+$2.00)"] };

test("a question about a size the shopper has not given is fair", () => {
  assert.deepEqual(unfairQuestions([{ name: "Size", required: true, options: ['68" Length', '74" Length', 'XW/XL (28" x 80")'] }], "a Jade Harmony yoga mat from jadeyoga.com\nI want number 1: Jade Harmony Yoga Mat - JadeYoga, $99.95"), []);
  assert.deepEqual(unfairQuestions([sizes], "a black t-shirt for men from Gap"), []);
});

test("a question about something the shopper already said is not fair", () => {
  const said = "a black cotton crewneck t-shirt for men in size medium from Gap";
  assert.equal(unfairQuestions([sizes], said).length, 1);
  assert.match(unfairQuestions([sizes], said)[0]!, /already said "M"/);
  assert.equal(unfairQuestions([colors], said).length, 1);
  assert.equal(unfairQuestions([sizes, colors], "a t-shirt from Gap").length, 0);
});

test("a question the shopper already answered is not asked again", () => {
  assert.equal(unfairQuestions([sizes], "a t-shirt from Gap\nM").length, 1);
  assert.equal(unfairQuestions([sizes, colors], "a t-shirt from Gap\nM, Black").length, 2);
});

test("the s of men's is not a small, and extra large is not a large", () => {
  assert.ok(!saidValue("S", "a black t-shirt for men's wear"));
  assert.ok(saidValue("XL", "an extra large hoodie"));
  assert.ok(!saidValue("L", "an extra large hoodie"));
  assert.ok(saidValue("Medium", "in size m please"));
});

test("a number is a size only when the shopper called it one", () => {
  assert.ok(saidValue("10", "Allbirds Tree Runners, men's size 10, from allbirds.com"));
  assert.ok(!saidValue("1", "1 Ferry Building, San Francisco, CA 94111"));
  assert.ok(!saidValue("10", "men's size 10.5"));
});

test("choices with placeholders for names are questions nobody can answer", () => {
  const groups: Group[] = [
    { name: "Option 4", required: true, options: ["Abyss Bronze", "Oatmilk Champagne"] },
    { name: "Option 11", required: true, options: ["Abyss Bronze", "Licorice Gunmetal"] },
  ];
  assert.equal(unfairQuestions(groups, "a stainless steel water bottle from Kohl's").length, 1);
  assert.match(unfairQuestions(groups, "a water bottle")[0]!, /placeholder for a name/);
  // One choice a store left unnamed, alone, can still be answered from its values.
  assert.deepEqual(unfairQuestions([{ name: "Option", required: true, options: ["Red", "Blue"] }], "a water bottle"), []);
});

test("a shopper takes the value they named, else the first the store lists", () => {
  assert.equal(pickValue(sizes, "a white t-shirt in size medium"), "M");
  assert.equal(pickValue(colors, "a white t-shirt in size medium"), "White");
  assert.equal(pickValue(colors, "a t-shirt"), "Black");
  assert.equal(pickValue(colors, "a navy t-shirt"), "Navy");
  assert.equal(pickValue(colors, "a t-shirt", new Set(["Black"])), "White");
});

test("which size should I add is a size question, never asking whether to add", () => {
  assert.ok(!asksWhetherToAdd("Which size should I add for the Jade Harmony Yoga Mat at JadeYoga?\n\n• 68\" Length\n• 74\" Length"));
  assert.ok(!asksWhetherToAdd("Should I add it?", [sizes]));
  assert.ok(asksWhetherToAdd("I found the Standard Mouth Stainless Steel Water Bottle at Hydro Flask for $29.99. Do you want me to add it to your cart?"));
  assert.ok(asksWhetherToAdd("Want me to add that one?"));
  assert.ok(!asksWhetherToAdd("Added it. Your total is $31.50."));
});

test("a choice written on one line is read with its values", () => {
  assert.deepEqual(inlineChoice("Which size? Size: XS, S, M, L")?.options, ["XS", "S", "M", "L"]);
  assert.equal(inlineChoice("Added it to your cart."), null);
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
