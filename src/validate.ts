import type { ChunkValidation } from "./types.js";
import { validateAndAssess } from "./quality.js";

export function validate(text: string): ChunkValidation {
  return validateAndAssess(text, true).validation;
}
