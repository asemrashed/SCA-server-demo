import { ResourceCategory } from './enums.js'

/** Must be placed on a chapter (module). */
export const CHAPTER_REQUIRED_CATEGORIES = new Set<ResourceCategory>([
  ResourceCategory.LECTURE_SHEET,
  ResourceCategory.SOLUTION_PDF,
])

/** May be placed on a chapter; subject/batch still apply for live courses. */
export const CHAPTER_OPTIONAL_CATEGORIES = new Set<ResourceCategory>([
  ResourceCategory.MATH_SUGGESTION,
  ResourceCategory.THEORY_SUGGESTION,
])

export const SUBJECT_REQUIRED_CATEGORIES = new Set<ResourceCategory>([
  ResourceCategory.EXAM,
  ResourceCategory.ASSIGNMENT,
  ResourceCategory.QUESTION_BANK,
])

/** Live courses: subject required unless placement is only course/batch level (e.g. notice). */
export const LIVE_SUBJECT_SCOPED_CATEGORIES = new Set<ResourceCategory>([
  ResourceCategory.LECTURE_SHEET,
  ResourceCategory.SOLUTION_PDF,
  ResourceCategory.MATH_SUGGESTION,
  ResourceCategory.THEORY_SUGGESTION,
  ResourceCategory.EXAM,
  ResourceCategory.ASSIGNMENT,
  ResourceCategory.QUESTION_BANK,
])

export const BATCH_SCOPED_CATEGORIES = new Set<ResourceCategory>([
  ResourceCategory.LECTURE_SHEET,
  ResourceCategory.SOLUTION_PDF,
  ResourceCategory.NOTICE,
  ResourceCategory.RESULT_SHEET,
  ResourceCategory.MATH_SUGGESTION,
  ResourceCategory.THEORY_SUGGESTION,
  ResourceCategory.EXAM,
  ResourceCategory.ASSIGNMENT,
  ResourceCategory.QUESTION_BANK,
])

export function isChapterRequiredCategory(category: ResourceCategory): boolean {
  return CHAPTER_REQUIRED_CATEGORIES.has(category)
}

export function isChapterOptionalCategory(category: ResourceCategory): boolean {
  return CHAPTER_OPTIONAL_CATEGORIES.has(category)
}
