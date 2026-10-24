import {
  isEventCount,
  isLockScreenProfile,
  isPresentation,
  isTimeRange,
} from './preferences';
import type { LivingOverlay, MilestoneRingStyle, UserData } from './userSchema';

export function resolveReadTimeAppearance(
  user: UserData,
  date = new Date(),
): {
  theme: string;
  timeRange: UserData['timeRange'];
  presentation: UserData['presentation'];
  lockScreenProfile: UserData['lockScreenProfile'];
  eventCount: number;
  livingOverlay: LivingOverlay;
  milestoneRingStyle: MilestoneRingStyle;
  slot: 'day' | 'evening' | 'night' | null;
} {
  const base = {
    theme: user.theme,
    timeRange: user.timeRange,
    presentation: user.presentation,
    lockScreenProfile: user.lockScreenProfile,
    eventCount: user.eventCount ?? 2,
    livingOverlay: user.livingOverlay ?? 'none',
    milestoneRingStyle: user.milestoneRingStyle ?? 'single',
    slot: null,
  };
  const profiles = user.automaticProfiles;

  if (!profiles?.enabled) return base;
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: user.timeZone,
    }).format(date),
  );

  const name =
    hour >= 6 && hour < 18 ? 'day' : hour >= 18 && hour < 22 ? 'evening' : 'night';
  const slot = profiles[name];

  if (!slot.enabled) return base;

  return {
    theme: slot.theme ?? base.theme,
    timeRange: isTimeRange(slot.timeRange) ? slot.timeRange : base.timeRange,
    presentation: isPresentation(slot.presentation)
      ? slot.presentation
      : base.presentation,
    lockScreenProfile: isLockScreenProfile(slot.lockScreenProfile)
      ? slot.lockScreenProfile
      : base.lockScreenProfile,
    eventCount: isEventCount(slot.eventCount) ? slot.eventCount : base.eventCount,
    livingOverlay: slot.livingOverlay ?? base.livingOverlay,
    milestoneRingStyle: slot.milestoneRingStyle ?? base.milestoneRingStyle,
    slot: name,
  };
}
