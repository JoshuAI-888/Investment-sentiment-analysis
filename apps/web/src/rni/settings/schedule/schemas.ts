import { z } from 'zod';

// Private coordinator composition schemas. The frozen contract currently names the schedules
// endpoint but does not yet publish a schedule-settings service/DTO.
export const scheduleCadence = z
  .object({
    scheduleType: z.enum(['interval', 'cron']),
    scheduleExpression: z.string().trim().min(1).max(200),
    displayTimezone: z.string().trim().min(1).max(100),
  })
  .strict();

export const scheduleUpdateBody = scheduleCadence
  .extend({
    expectedVersion: z.number().int().positive(),
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const scheduleUpdateRequest = scheduleUpdateBody
  .extend({
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

const instant = z.string().datetime({ offset: true });
export const scheduleSetting = scheduleCadence
  .extend({
    jobId: z.string().uuid(),
    version: z.number().int().positive(),
    enabled: z.boolean(),
    scope: z.object({ kind: z.literal('full_universe') }).strict(),
    nextDueAt: instant,
    nextRuns: z
      .array(z.object({ dueAt: instant, localTime: z.string(), timezone: z.string() }).strict())
      .length(5),
    observedAt: instant,
    updatedAt: instant,
    updatedBy: z.string().min(1),
  })
  .strict();

export const scheduleUpdateResult = z
  .object({
    disposition: z.enum(['accepted', 'duplicate']),
    idempotencyKey: z.string().min(1).max(200),
    setting: scheduleSetting,
  })
  .strict();

export type ScheduleCadence = z.infer<typeof scheduleCadence>;
export type ScheduleSetting = z.infer<typeof scheduleSetting>;
export type ScheduleUpdateRequest = z.infer<typeof scheduleUpdateRequest>;
export type ScheduleUpdateResult = z.infer<typeof scheduleUpdateResult>;

export interface RniScheduleSettingsService {
  getCurrentSchedule(): Promise<ScheduleSetting>;
  updateSchedule(request: ScheduleUpdateRequest): Promise<ScheduleUpdateResult>;
}
