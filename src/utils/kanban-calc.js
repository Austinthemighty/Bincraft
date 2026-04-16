export function calculateKanbanCards({ dailyDemand, leadTimeDays, safetyFactor = 1.5, containerQuantity = 1 }) {
  if (!dailyDemand || !leadTimeDays || !containerQuantity) return 1;
  return Math.ceil((dailyDemand * leadTimeDays * safetyFactor) / containerQuantity);
}
