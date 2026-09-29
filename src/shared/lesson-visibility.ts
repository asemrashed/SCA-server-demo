import type { Lesson } from '@prisma/client'
import { LessonType } from './enums.js'

type LessonLike = Pick<Lesson, 'type' | 'videoUrl' | 'content' | 'isPreview'>

export interface LessonVisibilityFields {
  hasVideo: boolean
  hasDocument: boolean
  content: string | null
  /** Zoom/Meet link for LIVE lessons (stored in `videoUrl`). */
  joinUrl: string | null
}

/** Maps lesson type + access flags to student-facing visibility fields. */
export function lessonVisibilityFields(
  lesson: LessonLike,
  canAccessContent: boolean,
): LessonVisibilityFields {
  const type = lesson.type as LessonType
  const hasVideoUrl = !!lesson.videoUrl
  const textContent = lesson.content?.trim() ?? ''

  return {
    hasVideo: canAccessContent && type === LessonType.RECORDED && hasVideoUrl,
    hasDocument: canAccessContent && type === LessonType.DOCUMENT && hasVideoUrl,
    content:
      canAccessContent && type === LessonType.TEXT && textContent ? lesson.content : null,
    joinUrl:
      canAccessContent && type === LessonType.LIVE && hasVideoUrl ? lesson.videoUrl : null,
  }
}
