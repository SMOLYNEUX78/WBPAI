const HOUR_MS = 60 * 60 * 1000;

export function recentProbableHeatingRun(events, now = Date.now()) {
  return (events || []).find((event) => {
    const end = Date.parse(event.end);
    return event.classification === "probable heating" &&
      Number.isFinite(end) && end <= now && now - end <= 12 * HOUR_MS;
  }) || null;
}

export function shouldAskAboutHeating(run, lastAnswer, now = Date.now()) {
  if (!run) return false;
  if (!lastAnswer) return true;
  if (lastAnswer.eventStart === run.start) return false;
  const answeredAt = Date.parse(lastAnswer.answeredAt);
  if (!Number.isFinite(answeredAt)) return true;
  const quietPeriod = ["one_off", "not_heating"].includes(lastAnswer.answer)
    ? 48 * HOUR_MS : lastAnswer.answer === "intermittent" ? 7 * 24 * HOUR_MS : 90 * 24 * HOUR_MS;
  return now - answeredAt >= quietPeriod;
}
