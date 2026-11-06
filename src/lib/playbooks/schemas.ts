import { z } from "zod";

const nameSchema = z.string().trim().min(1).max(160);
const textList = z.array(z.string().trim().min(1).max(240)).max(30);

export const createPlaybookSchema = z.object({
  name: nameSchema,
});

export const updatePlaybookSchema = z.object({
  name: nameSchema,
});

export const saveDraftSchema = z.object({
  name: nameSchema.optional(),
});

export const publishSchema = z.object({
  replaceActive: z.boolean().optional(),
});

export const phaseBodySchema = z.object({
  name: nameSchema,
  triggerText: z.string().trim().max(500).default(""),
  script: z.string().trim().max(8000).default(""),
  checklistItems: textList.default([]),
});

export const phasePatchSchema = z
  .object({
    name: nameSchema.optional(),
    triggerText: z.string().trim().max(500).optional(),
    script: z.string().trim().max(8000).optional(),
    checklistItems: textList.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No fields to update.",
  });

export const objectionBodySchema = z.object({
  label: nameSchema,
  signals: textList.default([]),
  suggestedResponse: z.string().trim().max(8000).default(""),
});

export const objectionPatchSchema = z
  .object({
    label: nameSchema.optional(),
    signals: textList.optional(),
    suggestedResponse: z.string().trim().max(8000).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No fields to update.",
  });

export const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(100),
});
