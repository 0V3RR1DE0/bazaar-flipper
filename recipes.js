"use strict";

/* ============================================================
 * Curated bazaar craft-flip recipes.
 *
 * The Hypixel API does NOT expose crafting recipes, so this is a hand-curated
 * table. Every entry below was validated against the live bazaar (all input and
 * output IDs exist and trade). Each recipe yields ONE output unit.
 *
 * The "enchanted" ladder is a stable 160:1 game mechanic:
 *   160 base resource        -> 1 Enchanted resource      (tier 1)
 *   160 Enchanted resource   -> 1 Enchanted block/tier 2  (tier 2)
 *
 * Recipes whose ratio is NOT a clean 160 (e.g. Blaze Rod -> Enchanted Blaze
 * Powder) are deliberately excluded to avoid inaccurate margins.
 *
 * To add a recipe, push { output, inputs: [{ id, qty }, ...] }. Any recipe
 * referencing an ID not on the bazaar is skipped automatically at runtime.
 * ============================================================ */

// base bazaar id -> enchanted output (160 of base = 1 output)
const ENCHANTED_T1 = [
  ["COAL", "ENCHANTED_COAL"],
  ["IRON_INGOT", "ENCHANTED_IRON"],
  ["GOLD_INGOT", "ENCHANTED_GOLD"],
  ["DIAMOND", "ENCHANTED_DIAMOND"],
  ["EMERALD", "ENCHANTED_EMERALD"],
  ["REDSTONE", "ENCHANTED_REDSTONE"],
  ["INK_SACK:4", "ENCHANTED_LAPIS_LAZULI"],
  ["COBBLESTONE", "ENCHANTED_COBBLESTONE"],
  ["GLOWSTONE_DUST", "ENCHANTED_GLOWSTONE"],
  ["QUARTZ", "ENCHANTED_QUARTZ"],
  ["STRING", "ENCHANTED_STRING"],
  ["SLIME_BALL", "ENCHANTED_SLIME_BALL"],
  ["LEATHER", "ENCHANTED_LEATHER"],
  ["BONE", "ENCHANTED_BONE"],
  ["SULPHUR", "ENCHANTED_SULPHUR"],
  ["ENDER_PEARL", "ENCHANTED_ENDER_PEARL"],
  ["GHAST_TEAR", "ENCHANTED_GHAST_TEAR"],
  ["MAGMA_CREAM", "ENCHANTED_MAGMA_CREAM"],
  ["ROTTEN_FLESH", "ENCHANTED_ROTTEN_FLESH"],
  ["SPIDER_EYE", "ENCHANTED_SPIDER_EYE"],
  ["CACTUS", "ENCHANTED_CACTUS"],
  ["PUMPKIN", "ENCHANTED_PUMPKIN"],
  ["MELON", "ENCHANTED_MELON"],
  ["SEEDS", "ENCHANTED_SEEDS"],
  ["POTATO_ITEM", "ENCHANTED_POTATO"],
  ["CARROT_ITEM", "ENCHANTED_CARROT"],
  ["NETHERRACK", "ENCHANTED_NETHERRACK"],
  ["SAND", "ENCHANTED_SAND"],
  ["FLINT", "ENCHANTED_FLINT"],
  ["RABBIT_HIDE", "ENCHANTED_RABBIT_HIDE"],
  ["FEATHER", "ENCHANTED_FEATHER"],
  ["ICE", "ENCHANTED_ICE"],
  ["CLAY_BALL", "ENCHANTED_CLAY_BALL"],
  ["MYCEL", "ENCHANTED_MYCELIUM"],
  ["SUGAR_CANE", "ENCHANTED_SUGAR_CANE"],
  ["MUTTON", "ENCHANTED_MUTTON"],
  ["RAW_BEEF", "ENCHANTED_RAW_BEEF"],
  ["PORK", "ENCHANTED_PORK"],
  ["RAW_CHICKEN", "ENCHANTED_RAW_CHICKEN"],
  ["RAW_FISH", "ENCHANTED_RAW_FISH"],
  ["PRISMARINE_SHARD", "ENCHANTED_PRISMARINE_SHARD"],
  ["INK_SACK", "ENCHANTED_INK_SACK"],
  ["WATER_LILY", "ENCHANTED_WATER_LILY"],
  ["OBSIDIAN", "ENCHANTED_OBSIDIAN"],
];

// enchanted input -> tier-2 output (160 of input = 1 output)
const ENCHANTED_T2 = [
  ["ENCHANTED_DIAMOND", "ENCHANTED_DIAMOND_BLOCK"],
  ["ENCHANTED_GOLD", "ENCHANTED_GOLD_BLOCK"],
  ["ENCHANTED_IRON", "ENCHANTED_IRON_BLOCK"],
  ["ENCHANTED_REDSTONE", "ENCHANTED_REDSTONE_BLOCK"],
  ["ENCHANTED_COAL", "ENCHANTED_COAL_BLOCK"],
  ["ENCHANTED_EMERALD", "ENCHANTED_EMERALD_BLOCK"],
  ["ENCHANTED_QUARTZ", "ENCHANTED_QUARTZ_BLOCK"],
];

const RECIPES = [];
for (const [base, out] of ENCHANTED_T1) RECIPES.push({ output: out, inputs: [{ id: base, qty: 160 }] });
for (const [base, out] of ENCHANTED_T2) RECIPES.push({ output: out, inputs: [{ id: base, qty: 160 }] });

window.BAZAAR_RECIPES = RECIPES;
